// Receita contábil do faturamento (F3.7, 06-FAT linha 37), no banco do cliente. A regra é do @sgh/dominio-faturamento
// (conta/receita-contabil.ts); aqui só se leem os fatos da conta e se grava o resultado da apuração.
// Apuração idempotente POR CONTA, a partir do estado do banco (nunca de um contador em memória):
//   - previsão de cada item lançado (só com a conta de receita prevista na regra);
//   - fechamento do ciclo vigente (o ciclo é a ordem do fechamento nas etapas da conta) e o desconto do item;
//   - reabertura de cada ciclo encerrado: o estorno espelha o que o fechamento daquele ciclo contabilizou;
//   - glosa em disputa, glosa aceita e recurso acatado de cada item glosado;
//   - recebido na baixa (pela conta contábil da conta bancária ou do caixa de entrada) e o estorno da baixa.
// Chamada no fechamento e na reabertura da conta, no registro da glosa, do recurso (aceite) e do retorno do recurso, e
// na baixa pelo demonstrativo, na mesma transação; e à mão pela tela de receita contábil.
// Contrato de efeito (receita-contabil-propria.int.spec.ts): lancamento_contabil_receita (chave_fato, data_referencia,
// data_lancamento, contas, valor, situação pendente), o pendente que deixou de ser apurado vira cancelado, o
// contabilizado nunca é alterado; ocorrencia_contabil_receita com a pendência (motivo) e a divergência, resolvida quando
// o fato volta a casar. O estabelecimento sem nenhuma regra de receita contábil ativa não apura (não usa a integração).
import {
  diferencaEventosReceita,
  type EventoGravado,
  type EventoReceita,
  eventoDoFato,
  estornosDaReabertura,
  type FatoFaturamento,
  type FatoReceita,
  type RegraContaReceita,
} from '@sgh/dominio-faturamento';
import { definirOperacao, ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';

type Linha = Record<string, unknown>;
type Consulta = Pick<TxOperacao, 'consultar'>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const p2 = (x: number) => String(x).padStart(2, '0');
function dia(v: unknown): string {
  if (v instanceof Date) return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  return txt(v).slice(0, 10);
}
const hoje = () => dia(new Date());
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

/** Tabelas que a apuração grava: entram no `tabelas` de toda operação que a chama. */
export const TABELAS_RECEITA_CONTABIL = [
  'lancamento_contabil_receita',
  'ocorrencia_contabil_receita',
] as const;

const SITUACOES_FECHADAS = ['fechada', 'faturada', 'enviada', 'paga'];

async function regrasDo(tx: Consulta, est: number): Promise<RegraContaReceita[]> {
  const rs = await tx.consultar<Linha>(
    `SELECT id, ativo, prioridade, fonte_pagadora_id, tipo_conta_id, tipo_lancamento_id, grupo_faturamento_id,
            subgrupo_faturamento_id, item_faturavel_id, setor_funcional_id, componente, conta_receita_id,
            conta_receita_prevista_id, conta_glosa_id, conta_glosa_aceita_id, conta_recuperacao_glosa_id,
            conta_deducao_id, conta_transitoria_cliente_id
       FROM regra_contabil_receita WHERE estabelecimento_id = ? AND ativo = 1`,
    [est],
  );
  return rs.map((r) => ({
    id: n(r['id']),
    ativo: true,
    prioridade: n(r['prioridade']),
    fontePagadoraId: nn(r['fonte_pagadora_id']),
    tipoContaId: nn(r['tipo_conta_id']),
    tipoLancamentoId: nn(r['tipo_lancamento_id']),
    grupoFaturamentoId: nn(r['grupo_faturamento_id']),
    subgrupoFaturamentoId: nn(r['subgrupo_faturamento_id']),
    itemFaturavelId: nn(r['item_faturavel_id']),
    setorFuncionalId: nn(r['setor_funcional_id']),
    componente: txt(r['componente']) || 'todos',
    contaReceitaId: n(r['conta_receita_id']),
    contaReceitaPrevistaId: nn(r['conta_receita_prevista_id']),
    contaGlosaId: nn(r['conta_glosa_id']),
    contaGlosaAceitaId: nn(r['conta_glosa_aceita_id']),
    contaRecuperacaoGlosaId: nn(r['conta_recuperacao_glosa_id']),
    contaDeducaoId: nn(r['conta_deducao_id']),
    contaTransitoriaClienteId: nn(r['conta_transitoria_cliente_id']),
  }));
}

interface FatoDaConta extends FatoFaturamento {
  readonly itemId: number | null;
}

/** Os fatos da conta hoje, lidos do banco, e as datas das reaberturas de cada ciclo encerrado. */
async function fatosDaConta(
  tx: Consulta,
  conta: Linha,
): Promise<{ fatos: FatoDaConta[]; reaberturas: Map<number, string> }> {
  const id = n(conta['id']);
  const etapas = await tx.consultar<Linha>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(dados, '$.etapa')) AS etapa, ocorrido_em FROM conta_hospitalar_etapa
      WHERE conta_hospitalar_id = ? ORDER BY ocorrido_em, id`,
    [id],
  );
  let ciclo = 0;
  const reaberturas = new Map<number, string>();
  for (const e of etapas) {
    if (e['etapa'] === 'fechamento') ciclo += 1;
    else if (e['etapa'] === 'reabertura' && ciclo > 0 && !reaberturas.has(ciclo))
      reaberturas.set(ciclo, dia(e['ocorrido_em']));
  }
  const fechada = SITUACOES_FECHADAS.includes(txt(conta['situacao']));
  if (fechada && ciclo === 0) ciclo = 1; // conta fechada sem etapa registrada (veio da importação)
  const cicloVivo = fechada && !reaberturas.has(ciclo) ? ciclo : null;

  const itens = await tx.consultar<Linha>(
    `SELECT i.id, i.item_faturavel_id, COALESCE(i.grupo_faturamento_id, f.grupo_faturamento_id) AS grupo,
            f.subgrupo_faturamento_id AS subgrupo, i.tipo_lancamento_id, i.setor_funcional_id, i.realizado_em,
            i.valor_total, i.valor_desconto, i.situacao
       FROM conta_hospitalar_item i JOIN item_faturavel f ON f.id = i.item_faturavel_id
      WHERE i.conta_hospitalar_id = ? AND i.excluido_em IS NULL ORDER BY i.id`,
    [id],
  );
  const porItem = new Map(itens.map((i) => [n(i['id']), i]));
  const base = (i: Linha) => ({
    fontePagadoraId: n(conta['fonte_pagadora_id']),
    tipoContaId: nn(conta['tipo_conta_id']),
    tipoLancamentoId: nn(i['tipo_lancamento_id']),
    grupoFaturamentoId: nn(i['grupo']),
    subgrupoFaturamentoId: nn(i['subgrupo']),
    itemFaturavelId: nn(i['item_faturavel_id']),
    setorFuncionalId: nn(i['setor_funcional_id']),
    componente: null,
    itemId: n(i['id']),
  });
  const fatos: FatoDaConta[] = [];
  const add = (i: Linha, fato: FatoReceita, chave: string, data: string, valor: number, extra = {}) =>
    fatos.push({ ...base(i), fato, chave, dataReferencia: data, valor, ...extra });
  const competencia = dia(conta['competencia']);
  for (const i of itens) {
    if (['sem_cobranca', 'transferido', 'estornado'].includes(txt(i['situacao']))) continue;
    const bruto = Math.round((n(i['valor_total']) + n(i['valor_desconto'])) * 100) / 100;
    if (bruto <= 0) continue;
    const itemId = n(i['id']);
    add(i, 'previsao', `conta:${id}:item:${itemId}:previsao`, dia(i['realizado_em']), bruto);
    if (cicloVivo === null) continue;
    const pre = `conta:${id}:ciclo:${cicloVivo}:item:${itemId}`;
    add(i, 'fechamento', `${pre}:fechamento`, competencia, bruto, { previsto: true });
    if (n(i['valor_desconto']) > 0)
      add(i, 'desconto', `${pre}:desconto`, competencia, n(i['valor_desconto']));
  }
  const ids = [...porItem.keys()];
  if (ids.length) {
    const glosas = await tx.consultar<Linha>(
      `SELECT gi.id, gi.conta_hospitalar_item_id, gi.valor_glosado, gi.valor_aceito, gi.valor_recuperado,
              gi.decidido_em, gi.data_recuperacao, g.data_glosa
         FROM glosa_item gi JOIN glosa g ON g.id = gi.glosa_id
        WHERE gi.conta_hospitalar_item_id IN (${lista(ids.length)}) AND gi.excluido_em IS NULL
          AND g.excluido_em IS NULL AND g.situacao <> 'cancelada' ORDER BY gi.id`,
      ids,
    );
    for (const g of glosas) {
      const i = porItem.get(n(g['conta_hospitalar_item_id']))!;
      const k = `glosa_item:${n(g['id'])}`;
      const data = dia(g['data_glosa']);
      const disputa = Math.round((n(g['valor_glosado']) - n(g['valor_aceito'])) * 100) / 100;
      if (disputa > 0) add(i, 'glosa', `${k}:glosa`, data, disputa);
      if (n(g['valor_aceito']) > 0)
        add(
          i,
          'glosa_aceita',
          `${k}:aceita`,
          g['decidido_em'] ? dia(g['decidido_em']) : data,
          n(g['valor_aceito']),
        );
      if (n(g['valor_recuperado']) > 0)
        add(
          i,
          'recurso_acatado',
          `${k}:recuperado`,
          g['data_recuperacao'] ? dia(g['data_recuperacao']) : data,
          n(g['valor_recuperado']),
        );
    }
    const recebidos = await tx.consultar<Linha>(
      `SELECT ric.id, ric.conta_hospitalar_item_id, ric.valor_recebido, r.data_recebimento, r.situacao, r.estornado_em,
              COALESCE(cb.conta_contabil_id, cx.conta_contabil_id) AS conta_entrada
         FROM recebimento_item_conta ric JOIN recebimento r ON r.id = ric.recebimento_id
         LEFT JOIN conta_bancaria cb ON cb.id = r.conta_bancaria_id
         LEFT JOIN caixa cx ON cx.id = r.caixa_id
        WHERE ric.conta_hospitalar_item_id IN (${lista(ids.length)}) AND ric.excluido_em IS NULL
          AND r.excluido_em IS NULL AND ric.valor_recebido > 0 ORDER BY ric.id`,
      ids,
    );
    for (const r of recebidos) {
      const i = porItem.get(n(r['conta_hospitalar_item_id']))!;
      const k = `recebimento_item:${n(r['id'])}`;
      const extra = { contaEntradaId: nn(r['conta_entrada']) };
      add(i, 'recebimento', `${k}:recebimento`, dia(r['data_recebimento']), n(r['valor_recebido']), extra);
      if (txt(r['situacao']) === 'estornado')
        add(
          i,
          'recebimento_estornado',
          `${k}:estorno`,
          dia(r['estornado_em']),
          n(r['valor_recebido']),
          extra,
        );
    }
  }
  return { fatos, reaberturas };
}

export interface ResultadoApuracaoReceita {
  readonly incluidos: number;
  readonly cancelados: number;
  readonly pendencias: number;
  readonly divergencias: number;
}

/** Apura a receita contábil da conta e grava o resultado (chamada dentro da transação da operação). */
export async function apurarReceitaContabilDaConta(
  tx: TxOperacao,
  est: number,
  contaId: number,
): Promise<ResultadoApuracaoReceita> {
  const nada = { incluidos: 0, cancelados: 0, pendencias: 0, divergencias: 0 };
  const regras = await regrasDo(tx, est);
  if (!regras.length) return nada;
  const [conta] = await tx.consultar<Linha>(
    `SELECT id, fonte_pagadora_id, tipo_conta_id, competencia, situacao FROM conta_hospitalar
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [contaId, est],
  );
  if (!conta) return nada;
  const { fatos, reaberturas } = await fatosDaConta(tx, conta);
  const gravadosL = await tx.consultar<Linha>(
    `SELECT id, versao, chave_fato, situacao, data_referencia, tipo_acao, debito_conta_contabil_id,
            credito_conta_contabil_id, valor
       FROM lancamento_contabil_receita
      WHERE estabelecimento_id = ? AND conta_hospitalar_id = ? AND chave_fato IS NOT NULL AND excluido_em IS NULL`,
    [est, contaId],
  );
  const gravados: EventoGravado[] = gravadosL.map((g) => ({
    id: n(g['id']),
    chave: txt(g['chave_fato']),
    situacao: txt(g['situacao']) as EventoGravado['situacao'],
    dataReferencia: dia(g['data_referencia']),
    tipoAcao: txt(g['tipo_acao']) as EventoGravado['tipoAcao'],
    debitoContaContabilId: n(g['debito_conta_contabil_id']),
    creditoContaContabilId: n(g['credito_conta_contabil_id']),
    valor: n(g['valor']),
    regraId: 0,
  }));
  const versaoDe = new Map(gravadosL.map((g) => [n(g['id']), n(g['versao'])]));
  const apurados: EventoReceita[] = [];
  const pendencias: { fato: FatoDaConta; motivo: string }[] = [];
  const itemDaChave = new Map<string, number | null>();
  const fatoDaChave = new Map<string, FatoReceita>();
  for (const f of fatos) {
    itemDaChave.set(f.chave, f.itemId);
    fatoDaChave.set(f.chave, f.fato);
    const e = eventoDoFato(regras, f);
    if (e === null) continue;
    if ('tipoAcao' in e) apurados.push(e);
    else pendencias.push({ fato: f, motivo: e.motivo });
  }
  for (const e of estornosDaReabertura(gravados, reaberturas)) {
    apurados.push(e);
    const m = /item:(\d+):/.exec(e.chave);
    itemDaChave.set(e.chave, m ? Number(m[1]) : null);
    fatoDaChave.set(e.chave, 'reabertura');
  }
  const d = diferencaEventosReceita(gravados, apurados);
  for (const id of d.cancelar)
    await tx.alterar('lancamento_contabil_receita', id, versaoDe.get(id)!, { situacao: 'cancelado' });
  for (const a of d.incluir)
    await tx.incluir('lancamento_contabil_receita', {
      estabelecimento_id: est,
      data_referencia: a.dataReferencia,
      data_lancamento: hoje(),
      tipo_acao: a.tipoAcao,
      chave_fato: a.chave,
      conta_hospitalar_id: contaId,
      conta_hospitalar_item_id: itemDaChave.get(a.chave) ?? null,
      debito_conta_contabil_id: a.debitoContaContabilId,
      credito_conta_contabil_id: a.creditoContaContabilId,
      valor: a.valor,
      situacao: 'pendente',
      origem: 'sistema',
    });

  // Ocorrências: abre (ou atualiza o motivo) o que pende ou diverge agora; resolve o aberto que deixou de pender.
  const abertas = await tx.consultar<Linha>(
    `SELECT id, versao, tipo, chave_fato, motivo FROM ocorrencia_contabil_receita
      WHERE estabelecimento_id = ? AND conta_hospitalar_id = ? AND situacao = 'aberta'`,
    [est, contaId],
  );
  const agora: {
    tipo: 'pendencia' | 'divergencia';
    chave: string;
    motivo: string;
    valor: number;
    data: string;
    lanc: number | null;
  }[] = [
    ...pendencias.map((p) => ({
      tipo: 'pendencia' as const,
      chave: p.fato.chave,
      motivo: p.motivo,
      valor: p.fato.valor,
      data: p.fato.dataReferencia,
      lanc: null,
    })),
    ...d.divergentes.map((x) => ({
      tipo: 'divergencia' as const,
      chave: x.gravado.chave,
      motivo:
        `o contabilizado (${x.gravado.debitoContaContabilId}/${x.gravado.creditoContaContabilId}, ${x.gravado.valor.toFixed(2)}) ` +
        `difere do apurado agora (${x.apurado.debitoContaContabilId}/${x.apurado.creditoContaContabilId}, ` +
        `${x.apurado.valor.toFixed(2)}): corrija pela reabertura da conta`,
      valor: x.apurado.valor,
      data: x.apurado.dataReferencia,
      lanc: x.gravado.id,
    })),
  ];
  const chaveOc = (tipo: string, chave: string) => `${tipo}|${chave}`;
  const vivas = new Map(abertas.map((o) => [chaveOc(txt(o['tipo']), txt(o['chave_fato'])), o]));
  for (const o of agora) {
    const ja = vivas.get(chaveOc(o.tipo, o.chave));
    if (ja) {
      vivas.delete(chaveOc(o.tipo, o.chave));
      if (txt(ja['motivo']) !== o.motivo)
        await tx.alterar('ocorrencia_contabil_receita', n(ja['id']), n(ja['versao']), { motivo: o.motivo });
      continue;
    }
    await tx.incluir('ocorrencia_contabil_receita', {
      estabelecimento_id: est,
      tipo: o.tipo,
      chave_fato: o.chave,
      fato: fatoDaChave.get(o.chave) ?? 'fechamento',
      conta_hospitalar_id: contaId,
      conta_hospitalar_item_id: itemDaChave.get(o.chave) ?? null,
      lancamento_contabil_receita_id: o.lanc,
      data_referencia: o.data,
      valor: o.valor,
      motivo: o.motivo.slice(0, 500),
      situacao: 'aberta',
    });
  }
  for (const o of vivas.values())
    await tx.alterar('ocorrencia_contabil_receita', n(o['id']), n(o['versao']), {
      situacao: 'resolvida',
      resolvida_em: new Date(),
    });
  return {
    incluidos: d.incluir.length,
    cancelados: d.cancelar.length,
    pendencias: pendencias.length,
    divergencias: d.divergentes.length,
  };
}

/** As contas dos itens de conta informados (glosa, recurso, baixa): cada uma é apurada uma vez. */
export async function apurarReceitaContabilDosItens(
  tx: TxOperacao,
  est: number,
  itens: readonly number[],
): Promise<void> {
  const ids = [...new Set(itens.filter((x) => Number.isInteger(x) && x > 0))];
  if (!ids.length) return;
  const contas = await tx.consultar<Linha>(
    `SELECT DISTINCT conta_hospitalar_id FROM conta_hospitalar_item WHERE id IN (${lista(ids.length)})`,
    ids,
  );
  for (const c of contas) await apurarReceitaContabilDaConta(tx, est, n(c['conta_hospitalar_id']));
}

/** Apuração à mão de uma conta (tela de receita contábil): refaz pelos fatos de hoje, sem duplicar. */
export const apurarReceitaContabil = definirOperacao<{ conta: number }, Record<string, unknown>>({
  nome: 'faturamento.apurar-receita-contabil',
  tabelas: [...TABELAS_RECEITA_CONTABIL],
  entrada: z.object({ conta: z.number().int().positive() }).strict(),
  async gravar(tx, e, ctx) {
    const est = ctx.estabelecimento;
    if (est === null)
      throw new ErroOperacao(422, 'sem-estabelecimento', 'Sem estabelecimento', 'Escolha o estabelecimento.');
    const [c] = await tx.consultar<Linha>(
      'SELECT id FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.conta, est],
    );
    if (!c) throw new ErroOperacao(404, 'registro-inexistente', 'Conta inexistente', 'A conta não existe.');
    const r = await apurarReceitaContabilDaConta(tx, est, e.conta);
    return { conta: e.conta, ...r };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.conta }),
});

export interface FiltroReceitaContabil {
  readonly conta?: number | null;
  readonly situacao?: string | null;
}

/** Eventos, pendências e divergências (as abertas e as últimas resolvidas), com a conta e o item, sem dado pessoal. */
export async function painelReceitaContabilPropria(l: Leitor, est: number, f: FiltroReceitaContabil) {
  const conta = f.conta ?? null;
  const situacao =
    f.situacao && ['pendente', 'contabilizado', 'cancelado'].includes(f.situacao) ? f.situacao : null;
  const eventos = await l.consultar<Linha>(
    `SELECT e.id, e.chave_fato, e.tipo_acao, e.data_referencia, e.data_lancamento, e.valor, e.situacao,
            e.conta_hospitalar_id, ch.numero AS conta_numero, e.conta_hospitalar_item_id,
            d.classificacao AS debito, d.descricao AS debito_descricao,
            c.classificacao AS credito, c.descricao AS credito_descricao
       FROM lancamento_contabil_receita e
       LEFT JOIN conta_hospitalar ch ON ch.id = e.conta_hospitalar_id
       JOIN conta_contabil d ON d.id = e.debito_conta_contabil_id
       JOIN conta_contabil c ON c.id = e.credito_conta_contabil_id
      WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL AND e.chave_fato IS NOT NULL
        AND (? IS NULL OR e.conta_hospitalar_id = ?) AND (? IS NULL OR e.situacao = ?)
      ORDER BY e.id DESC LIMIT 300`,
    [est, conta, conta, situacao, situacao],
  );
  const ocorrencias = await l.consultar<Linha>(
    `SELECT o.id, o.tipo, o.chave_fato, o.fato, o.motivo, o.valor, o.data_referencia, o.situacao, o.resolvida_em,
            o.conta_hospitalar_id, ch.numero AS conta_numero, o.conta_hospitalar_item_id
       FROM ocorrencia_contabil_receita o LEFT JOIN conta_hospitalar ch ON ch.id = o.conta_hospitalar_id
      WHERE o.estabelecimento_id = ? AND (? IS NULL OR o.conta_hospitalar_id = ?)
      ORDER BY o.situacao = 'aberta' DESC, o.id DESC LIMIT 300`,
    [est, conta, conta],
  );
  const regras = await l.consultar<Linha>(
    'SELECT COUNT(*) AS n FROM regra_contabil_receita WHERE estabelecimento_id = ? AND ativo = 1',
    [est],
  );
  return {
    regrasAtivas: n(regras[0]?.['n']),
    eventos: eventos.map((e) => ({
      id: n(e['id']),
      chave: txt(e['chave_fato']),
      tipoAcao: txt(e['tipo_acao']),
      dataReferencia: dia(e['data_referencia']),
      dataLancamento: dia(e['data_lancamento']),
      valor: n(e['valor']),
      situacao: txt(e['situacao']),
      contaId: nn(e['conta_hospitalar_id']),
      contaNumero: e['conta_numero'] === null ? null : txt(e['conta_numero']),
      itemId: nn(e['conta_hospitalar_item_id']),
      debito: `${txt(e['debito'])} ${txt(e['debito_descricao'])}`.trim(),
      credito: `${txt(e['credito'])} ${txt(e['credito_descricao'])}`.trim(),
    })),
    ocorrencias: ocorrencias.map((o) => ({
      id: n(o['id']),
      tipo: txt(o['tipo']),
      chave: txt(o['chave_fato']),
      fato: txt(o['fato']),
      motivo: txt(o['motivo']),
      valor: o['valor'] === null ? null : n(o['valor']),
      dataReferencia: o['data_referencia'] ? dia(o['data_referencia']) : null,
      situacao: txt(o['situacao']),
      resolvidaEm: o['resolvida_em'] ? dia(o['resolvida_em']) : null,
      contaId: nn(o['conta_hospitalar_id']),
      contaNumero: o['conta_numero'] === null ? null : txt(o['conta_numero']),
      itemId: nn(o['conta_hospitalar_item_id']),
    })),
  };
}
