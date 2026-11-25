// Importação do demonstrativo da operadora no banco do estabelecimento (06-FAT linha 33, F3.7), dentro da gravação
// direta da porta TISS (trilha, outbox e idempotência na mesma transação; sem gatilho).
// - Análise de conta: grava demonstrativo_analise_conta e uma linha por item em demonstrativo_analise_conta_item,
//   casada item a item com conta_hospitalar_item do lote pela regra do domínio (casarItensDemonstrativo): o item
//   casado, a glosa (informado menos liberado), o motivo pela terminologia (código TUSS) e a situação (pendente,
//   divergente ou sem correspondência). A baixa por item (faturamento.registrarGlosa com o demonstrativo) grava o pago
//   e a glosa no item da conta e marca a linha como conciliada, ligada ao item glosado.
// - Pagamento: grava demonstrativo_pagamento (data do pagamento, informado, liberado, glosa, débitos, créditos e o
//   líquido), as linhas por protocolo ou guia em demonstrativo_pagamento_item e os débitos e créditos em
//   demonstrativo_deducao. Um pagamento cobre vários lotes da operadora: cada linha casa com QUALQUER lote do
//   estabelecimento da mesma fonte pagadora (número do lote ou do protocolo) ou com a conta pela guia. A linha casada
//   fica pendente (divergente, com glosa) até a baixa do recebimento (financeiro.baixar_pagamento_tiss), que a
//   concilia. Líquido negativo é recusado (conferirPagamento).
// O mesmo número do demonstrativo para a mesma fonte pagadora não entra duas vezes (repetido). Nada é apagado.
import type { DemonstrativoLido, ItemDemonstrativoLido } from '@sgh/contratos';
import {
  type CandidatoConciliacao,
  casarItensDemonstrativo,
  conferirPagamento,
  type DeducaoPagamento,
  type LinhaPagamento,
  situacaoDoDemonstrativo,
  situacaoLinhaPagamento,
  totaisDoPagamento,
} from '@sgh/dominio-faturamento';
import { type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import type { ImportacaoPorta } from './porta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const limpo = (s: string) => s.trim().replace(/^0+(?=\d)/, '');
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';

export const TABELAS_DEMONSTRATIVO = [
  'demonstrativo_analise_conta',
  'demonstrativo_analise_conta_item',
  'demonstrativo_pagamento',
  'demonstrativo_pagamento_item',
  'demonstrativo_deducao',
];

/** O pagamento que a porta recebe além dos itens (XML do demonstrativo de pagamento ou digitação agrupada). */
export interface PagamentoPorta {
  readonly dataPagamento: string | null;
  readonly linhas: readonly LinhaPagamento[];
  readonly deducoes: readonly DeducaoPagamento[];
}

/** O cabeçalho do pagamento para a tela: totais, situação da baixa, deduções e o lote de cada linha. */
export interface ResumoPagamento {
  readonly situacao: string;
  readonly dataPagamento: string;
  readonly informado: number;
  readonly liberado: number;
  readonly glosa: number;
  readonly debitos: number;
  readonly creditos: number;
  readonly liquido: number;
  readonly titulo: number | null;
  readonly deducoes: readonly {
    readonly sequencia: number;
    readonly natureza: 'debito' | 'credito';
    readonly codigo: string;
    readonly descricao: string;
    readonly valor: number;
  }[];
  /** O lote de cada linha (id da linha → id do lote; 0 sem casamento). */
  readonly lotes: Readonly<Record<number, number>>;
}

export interface ResultadoImportacao {
  readonly id: number;
  readonly repetido: boolean;
  readonly casados: number;
  readonly semCasamento: number;
}

/** As contas dos lotes do estabelecimento da mesma operadora, com a guia do prestador (casamento pela guia). */
const SQL_CONTAS_DA_FONTE = `
  SELECT ltc.lote_tiss_id AS lote, ch.id AS conta, ch.numero,
         (SELECT MAX(g.numero_guia_prestador) FROM guia_tiss g
           WHERE g.conta_hospitalar_id = ch.id AND g.excluido_em IS NULL) AS guia
    FROM lote_tiss lt
    JOIN lote_tiss_conta ltc ON ltc.lote_tiss_id = lt.id AND ltc.excluido_em IS NULL
    JOIN conta_hospitalar ch ON ch.id = ltc.conta_hospitalar_id AND ch.excluido_em IS NULL
   WHERE lt.estabelecimento_id = ? AND lt.fonte_pagadora_id = ? AND lt.excluido_em IS NULL
   ORDER BY lt.id DESC, ch.id
   LIMIT 200000`;

const SQL_ITENS_DO_LOTE = `
  SELECT ci.id AS item, ci.sequencia, ci.valor_total, ch.id AS conta, ch.numero, f.codigo,
         (SELECT MAX(g.numero_guia_prestador) FROM guia_tiss g
           WHERE g.conta_hospitalar_id = ch.id AND g.excluido_em IS NULL) AS guia
    FROM lote_tiss_conta ltc
    JOIN conta_hospitalar ch ON ch.id = ltc.conta_hospitalar_id AND ch.excluido_em IS NULL
    JOIN conta_hospitalar_item ci ON ci.conta_hospitalar_id = ch.id AND ci.excluido_em IS NULL
    LEFT JOIN item_faturavel f ON f.id = ci.item_faturavel_id
   WHERE ltc.lote_tiss_id = ? AND ltc.excluido_em IS NULL
   ORDER BY ch.id, ci.sequencia`;

async function motivoPorCodigo(tx: TxOperacao, codigo: number): Promise<number | null> {
  if (!codigo) return null;
  const m = await tx.uma<Linha>(
    `SELECT id FROM motivo_glosa WHERE codigo_tuss = ? OR CAST(codigo_tuss AS UNSIGNED) = ?
      ORDER BY codigo_tuss = ? DESC, id LIMIT 1`,
    [String(codigo), codigo, String(codigo)],
  );
  return m ? n(m['id']) : null;
}

export async function importarDemonstrativoNoBanco(
  tx: TxOperacao,
  est: number,
  d: ImportacaoPorta & { readonly pagamento?: PagamentoPorta | null },
): Promise<ResultadoImportacao> {
  const lote = await tx.uma<Linha>(
    `SELECT id, fonte_pagadora_id FROM lote_tiss
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [d.lote, est],
  );
  if (!lote) throw recusa('lote-inexistente', 'O lote não existe neste estabelecimento.');
  const fonte = n(lote['fonte_pagadora_id']);
  const linhasLote = await tx.consultar<Linha>(SQL_ITENS_DO_LOTE, [d.lote]);
  const candidatos: CandidatoConciliacao[] = linhasLote.map((r) => ({
    item: n(r['item']),
    conta: n(r['conta']),
    guias: [texto(r['guia']), texto(r['numero']), String(n(r['conta']))].filter((g) => g !== ''),
    sequencial: n(r['sequencia']),
    codigo: texto(r['codigo']),
    valorCobrado: n(r['valor_total']),
  }));
  const observacao = d.chaveObjeto ? `Arquivo guardado: ${d.chaveObjeto}`.slice(0, 500) : null;
  return d.tipo === 'pagamento'
    ? gravarPagamento(tx, est, d, { fonte, observacao })
    : gravarAnalise(tx, est, d, { fonte, candidatos, observacao });
}

async function gravarAnalise(
  tx: TxOperacao,
  est: number,
  d: ImportacaoPorta,
  x: { fonte: number; candidatos: CandidatoConciliacao[]; observacao: string | null },
): Promise<ResultadoImportacao> {
  const ja = await tx.uma<Linha>(
    `SELECT d.id,
            (SELECT COUNT(*) FROM demonstrativo_analise_conta_item i WHERE i.demonstrativo_analise_conta_id = d.id
               AND i.excluido_em IS NULL) AS itens,
            (SELECT COUNT(*) FROM demonstrativo_analise_conta_item i WHERE i.demonstrativo_analise_conta_id = d.id
               AND i.excluido_em IS NULL AND i.conta_hospitalar_item_id IS NOT NULL) AS casados
       FROM demonstrativo_analise_conta d
      WHERE d.estabelecimento_id = ? AND d.fonte_pagadora_id = ? AND d.numero_demonstrativo = ?
        AND d.excluido_em IS NULL`,
    [est, x.fonte, d.numero],
  );
  if (ja)
    return {
      id: n(ja['id']),
      repetido: true,
      casados: n(ja['casados']),
      semCasamento: n(ja['itens']) - n(ja['casados']),
    };
  const casamento = casarItensDemonstrativo(d.itens, x.candidatos);
  const soma = (f: (i: (typeof d.itens)[number]) => number) => r2(d.itens.reduce((t, i) => t + f(i), 0));
  const id = await tx.incluir('demonstrativo_analise_conta', {
    estabelecimento_id: est,
    fonte_pagadora_id: x.fonte,
    lote_tiss_id: d.lote,
    numero_demonstrativo: d.numero,
    data_emissao: d.dataEmissao,
    valor_informado: soma((i) => i.valorInformado),
    valor_processado: soma((i) => i.valorInformado),
    valor_liberado: soma((i) => i.valorPago),
    valor_glosa: r2(casamento.reduce((t, c) => t + c.valorGlosa, 0)),
    forma_entrada: d.origem,
    situacao: situacaoDoDemonstrativo(casamento),
    observacao: x.observacao,
  });
  for (const [k, it] of d.itens.entries()) {
    const c = casamento[k]!;
    await tx.incluir('demonstrativo_analise_conta_item', {
      demonstrativo_analise_conta_id: id,
      sequencia: k + 1,
      conta_hospitalar_item_id: c.item,
      numero_guia_prestador: it.numeroGuia.trim() || '0',
      codigo_procedimento: it.codigoProcedimento.trim() || '0',
      sequencia_item_guia: it.sequencial,
      quantidade_executada: it.quantidadePaga,
      valor_informado: r2(it.valorInformado),
      valor_processado: r2(it.valorInformado),
      valor_liberado: r2(it.valorPago),
      valor_glosa: c.valorGlosa,
      motivo_glosa_id: await motivoPorCodigo(tx, it.motivo),
      situacao_conciliacao: c.situacao,
    });
  }
  const casados = casamento.filter((c) => c.item !== null).length;
  return { id, repetido: false, casados, semCasamento: d.itens.length - casados };
}

async function gravarPagamento(
  tx: TxOperacao,
  est: number,
  d: ImportacaoPorta & { readonly pagamento?: PagamentoPorta | null },
  x: { fonte: number; observacao: string | null },
): Promise<ResultadoImportacao> {
  const p = d.pagamento;
  if (!p || p.linhas.length === 0)
    throw recusa('entrada-invalida', 'O demonstrativo de pagamento não tem protocolos nem guias.');
  const ja = await tx.uma<Linha>(
    `SELECT d.id,
            (SELECT COUNT(*) FROM demonstrativo_pagamento_item i WHERE i.demonstrativo_pagamento_id = d.id
               AND i.excluido_em IS NULL) AS itens,
            (SELECT COUNT(*) FROM demonstrativo_pagamento_item i WHERE i.demonstrativo_pagamento_id = d.id
               AND i.excluido_em IS NULL AND (i.lote_tiss_id IS NOT NULL OR i.conta_hospitalar_id IS NOT NULL))
              AS casados
       FROM demonstrativo_pagamento d
      WHERE d.estabelecimento_id = ? AND d.fonte_pagadora_id = ? AND d.numero_demonstrativo = ?
        AND d.excluido_em IS NULL`,
    [est, x.fonte, d.numero],
  );
  if (ja)
    return {
      id: n(ja['id']),
      repetido: true,
      casados: n(ja['casados']),
      semCasamento: n(ja['itens']) - n(ja['casados']),
    };
  const t = totaisDoPagamento(p.linhas, p.deducoes);
  const erro = conferirPagamento(t);
  if (erro) throw recusa('pagamento-inconsistente', erro);
  const id = await tx.incluir('demonstrativo_pagamento', {
    estabelecimento_id: est,
    fonte_pagadora_id: x.fonte,
    numero_demonstrativo: d.numero,
    data_emissao: d.dataEmissao,
    data_pagamento: p.dataPagamento,
    valor_informado: t.informado,
    valor_processado: t.processado,
    valor_liberado: t.liberado,
    valor_glosa: t.glosa,
    valor_debitos: t.debitos,
    valor_creditos: t.creditos,
    valor_liquido: t.liquido,
    forma_entrada: d.origem,
    situacao: 'importado',
    observacao: x.observacao,
  });
  // Os lotes e as contas do estabelecimento da mesma operadora: o pagamento cobre vários lotes, não só o escolhido.
  const lotes = await tx.consultar<Linha>(
    `SELECT id, numero_lote, numero_protocolo FROM lote_tiss
      WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 50000`,
    [est, x.fonte],
  );
  const porNumero = new Map<string, number>();
  const porProtocolo = new Map<string, number>();
  for (const r of lotes) {
    const nl = limpo(texto(r['numero_lote']));
    const np = limpo(texto(r['numero_protocolo']));
    if (nl !== '' && !porNumero.has(nl)) porNumero.set(nl, n(r['id']));
    if (np !== '' && !porProtocolo.has(np)) porProtocolo.set(np, n(r['id']));
  }
  const guias = [...new Set(p.linhas.map((l) => (l.numeroGuia !== null ? limpo(l.numeroGuia) : '')))].filter(
    (g) => g !== '',
  );
  const porGuia = new Map<string, { conta: number; lote: number }>();
  if (guias.length > 0)
    for (const r of await tx.consultar<Linha>(SQL_CONTAS_DA_FONTE, [est, x.fonte])) {
      const alvo = { conta: n(r['conta']), lote: n(r['lote']) };
      for (const g of [texto(r['guia']), texto(r['numero']), String(n(r['conta']))].map(limpo))
        if (g !== '' && !porGuia.has(g)) porGuia.set(g, alvo);
    }
  let casados = 0;
  for (const [k, l] of p.linhas.entries()) {
    const porConta = l.numeroGuia !== null ? porGuia.get(limpo(l.numeroGuia)) : undefined;
    const loteCasado =
      porConta?.lote ??
      (l.numeroLote !== null ? porNumero.get(limpo(l.numeroLote)) : undefined) ??
      (l.protocolo !== null ? porProtocolo.get(limpo(l.protocolo)) : undefined) ??
      null;
    const conta = porConta?.conta ?? null;
    const casada = loteCasado !== null || conta !== null;
    if (casada) casados += 1;
    await tx.incluir('demonstrativo_pagamento_item', {
      demonstrativo_pagamento_id: id,
      sequencia: k + 1,
      lote_tiss_id: loteCasado,
      conta_hospitalar_id: conta,
      numero_lote_prestador: l.numeroLote,
      numero_protocolo: l.protocolo,
      numero_guia_prestador: l.numeroGuia,
      data_pagamento: p.dataPagamento,
      valor_informado: l.valorInformado,
      valor_processado: l.valorProcessado,
      valor_liberado: l.valorLiberado,
      valor_glosa: l.valorGlosa,
      situacao_conciliacao: situacaoLinhaPagamento({ casada, valorGlosa: l.valorGlosa }),
    });
  }
  for (const [k, ded] of p.deducoes.entries())
    await tx.incluir('demonstrativo_deducao', {
      demonstrativo_pagamento_id: id,
      sequencia: k + 1,
      natureza: ded.natureza,
      codigo_detalhamento: ded.codigo,
      descricao: ded.descricao,
      data_pagamento: ded.dataPagamento,
      valor: r2(ded.valor),
    });
  return { id, repetido: false, casados, semCasamento: p.linhas.length - casados };
}

// ── Leituras do demonstrativo de pagamento (a tela lista os dois tipos) ────────────────────────────────

export async function listarPagamentos(
  l: Leitor,
  est: number,
  f: { lote: number | null; convenios: readonly number[] | null },
): Promise<DemonstrativoLido[]> {
  const p: unknown[] = [est];
  let where = '';
  if (f.lote !== null) {
    // O pagamento cobre vários lotes da operadora: no lote aberto aparecem os pagamentos da mesma operadora, inclusive
    // o que ainda não casou nenhuma linha.
    where += ` AND d.fonte_pagadora_id = (SELECT lt.fonte_pagadora_id FROM lote_tiss lt WHERE lt.id = ?
                 AND lt.estabelecimento_id = d.estabelecimento_id)`;
    p.push(f.lote);
  }
  if (f.convenios !== null) {
    if (f.convenios.length === 0) return [];
    where += ` AND d.fonte_pagadora_id IN (${f.convenios.map(() => '?').join(',')})`;
    p.push(...f.convenios);
  }
  const linhas = await l.consultar<Linha>(
    `SELECT d.id, d.fonte_pagadora_id, d.numero_demonstrativo, d.data_emissao, d.forma_entrada, d.valor_informado,
            d.valor_liquido, d.criado_em, u.login,
            (SELECT MIN(i.lote_tiss_id) FROM demonstrativo_pagamento_item i WHERE i.demonstrativo_pagamento_id = d.id
               AND i.excluido_em IS NULL) AS lote,
            (SELECT COUNT(*) FROM demonstrativo_pagamento_item i WHERE i.demonstrativo_pagamento_id = d.id
               AND i.excluido_em IS NULL) AS itens,
            (SELECT COUNT(*) FROM demonstrativo_pagamento_item i WHERE i.demonstrativo_pagamento_id = d.id
               AND i.excluido_em IS NULL AND i.situacao_conciliacao <> 'sem_correspondencia') AS casados,
            (SELECT COUNT(*) FROM demonstrativo_pagamento_item i WHERE i.demonstrativo_pagamento_id = d.id
               AND i.excluido_em IS NULL AND i.situacao_conciliacao = 'conciliado') AS baixados
       FROM demonstrativo_pagamento d LEFT JOIN usuario u ON u.id = d.criado_por
      WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL${where}
      ORDER BY d.data_emissao DESC, d.id DESC LIMIT 500`,
    p,
  );
  return linhas.map((r) => ({
    id: n(r['id']),
    lote: n(r['lote']),
    convenio: n(r['fonte_pagadora_id']),
    tipo: 'pagamento' as const,
    origem: texto(r['forma_entrada']) === 'digitacao' ? ('digitacao' as const) : ('xml' as const),
    numero: texto(r['numero_demonstrativo']),
    dataEmissao: dataIso(r['data_emissao']),
    itens: n(r['itens']),
    casados: n(r['casados']),
    semCasamento: n(r['itens']) - n(r['casados']),
    baixados: n(r['baixados']),
    valorInformado: n(r['valor_informado']),
    valorPago: n(r['valor_liquido']),
    importadoPor: texto(r['login']),
    importadoEm: r['criado_em'] instanceof Date ? r['criado_em'].toISOString() : texto(r['criado_em']),
  }));
}

/** O demonstrativo de pagamento: totais, deduções e as linhas por protocolo ou guia (a baixa é no título). */
export async function lerPagamento(
  l: Leitor,
  est: number,
  id: number,
): Promise<{
  lote: number;
  convenio: number;
  itens: ItemDemonstrativoLido[];
  pagamento: ResumoPagamento;
} | null> {
  const d = await l.uma<Linha>(
    `SELECT fonte_pagadora_id, situacao, data_pagamento, valor_informado, valor_liberado, valor_glosa, valor_debitos,
            valor_creditos, valor_liquido, titulo_receber_id FROM demonstrativo_pagamento
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!d) return null;
  const itens = await l.consultar<Linha>(
    `SELECT id, sequencia, lote_tiss_id, conta_hospitalar_id, numero_guia_prestador, numero_protocolo,
            numero_lote_prestador, valor_informado, valor_liberado, situacao_conciliacao
       FROM demonstrativo_pagamento_item
      WHERE demonstrativo_pagamento_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [id],
  );
  const deducoes = await l.consultar<Linha>(
    `SELECT sequencia, natureza, codigo_detalhamento, descricao, valor FROM demonstrativo_deducao
      WHERE demonstrativo_pagamento_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [id],
  );
  return {
    lote: n(itens.find((i) => i['lote_tiss_id'] !== null)?.['lote_tiss_id']),
    convenio: n(d['fonte_pagadora_id']),
    pagamento: {
      situacao: texto(d['situacao']),
      dataPagamento: dataIso(d['data_pagamento']),
      informado: n(d['valor_informado']),
      liberado: n(d['valor_liberado']),
      glosa: n(d['valor_glosa']),
      debitos: n(d['valor_debitos']),
      creditos: n(d['valor_creditos']),
      liquido: n(d['valor_liquido']),
      titulo: d['titulo_receber_id'] === null ? null : n(d['titulo_receber_id']),
      deducoes: deducoes.map((x) => ({
        sequencia: n(x['sequencia']),
        natureza: texto(x['natureza']) === 'credito' ? ('credito' as const) : ('debito' as const),
        codigo: texto(x['codigo_detalhamento']),
        descricao: texto(x['descricao']),
        valor: n(x['valor']),
      })),
      lotes: Object.fromEntries(itens.map((r) => [n(r['id']), n(r['lote_tiss_id'])])),
    },
    itens: itens.map((r) => {
      const s = texto(r['situacao_conciliacao']);
      return {
        id: n(r['id']),
        item: null,
        versaoItem: null,
        conta: r['conta_hospitalar_id'] === null ? null : n(r['conta_hospitalar_id']),
        numeroGuia:
          texto(r['numero_guia_prestador']) ||
          texto(r['numero_protocolo']) ||
          texto(r['numero_lote_prestador']),
        sequencial: n(r['sequencia']),
        codigoProcedimento: '',
        valorCobrado: null,
        valorInformado: n(r['valor_informado']),
        valorPago: n(r['valor_liberado']),
        quantidadePaga: 0,
        motivo: 0,
        motivoNome: '',
        situacao:
          s === 'conciliado'
            ? ('baixado' as const)
            : s === 'sem_correspondencia'
              ? ('sem-casamento' as const)
              : ('casado' as const),
      };
    }),
  };
}
