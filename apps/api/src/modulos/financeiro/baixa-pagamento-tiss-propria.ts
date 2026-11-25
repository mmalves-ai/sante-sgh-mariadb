// 06-FAT linha 33 (F3.7) com 07-FIN linha 76: baixa dos títulos do convênio pelo demonstrativo de PAGAMENTO da TISS
// (protocolos ou guias, débitos e créditos), no banco próprio, pelo executor do @sgh/nucleo. A regra é a do domínio
// (planejarBaixaPagamento): o liberado de cada linha abate o saldo dos títulos das contas que ela cobre (a conta casada
// pela guia, ou as contas do lote casado pelo número do lote ou do protocolo); os débitos (IRRF, ISS, ajustes) e os
// créditos entram rateados pelo recebido.
// O que fica no banco: UM crédito na conta bancária pelo líquido baixado; por título, um recebimento com o meio
// "demonstrativo" (número do demonstrativo no documento), o recebido, a retenção (débitos) e o acréscimo (créditos);
// a parcela e o título somam o recebido. As linhas inteiramente baixadas ficam "conciliado"; o cabeçalho fica
// "baixado", com a conta, a data e o primeiro título. O já baixado é recusado. Nada é apagado.
import { planejarBaixaPagamento, type RecusaBaixaPagamento } from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  garantirSequencia,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { exigirPeriodoAberto } from './periodo-propria.js';
import { LANCAMENTO_RECEBIMENTO, numero } from './vocabulario.js';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const ph = (n: readonly unknown[]) => n.map(() => '?').join(',');
type Linha = Record<string, unknown>;

export const esquemaBaixarPagamentoTiss = z
  .object({ demonstrativo: id, conta: id, dataRecebimento: DATA })
  .strict();

/** As linhas do pagamento com as contas que cada uma cobre (a conta casada, ou as contas do lote casado). */
const SQL_LINHAS = `
  SELECT i.id, i.versao, i.conta_hospitalar_id, i.lote_tiss_id, i.valor_liberado, i.valor_glosa,
         i.situacao_conciliacao
    FROM demonstrativo_pagamento_item i
   WHERE i.demonstrativo_pagamento_id = ? AND i.excluido_em IS NULL
   ORDER BY i.sequencia`;
const SQL_CONTAS_DOS_LOTES = (n: readonly unknown[]) => `
  SELECT ltc.lote_tiss_id, ltc.conta_hospitalar_id FROM lote_tiss_conta ltc
   WHERE ltc.lote_tiss_id IN (${ph(n)}) AND ltc.excluido_em IS NULL
   ORDER BY ltc.lote_tiss_id, ltc.conta_hospitalar_id`;
/** O título (não cancelado, do mesmo convênio e estabelecimento) de cada conta, com a primeira parcela em aberto. */
const SQL_TITULOS = (n: readonly unknown[]) => `
  SELECT o.entidade_id AS conta, t.id, t.versao, t.valor_recebido, t.natureza_financeira_id,
         (SELECT p.id FROM parcela_receber p WHERE p.titulo_receber_id = t.id AND p.excluido_em IS NULL
             AND p.saldo > 0 AND p.situacao IN ('aberta','parcial') ORDER BY p.sequencia LIMIT 1) AS parcela
    FROM documento_origem_titulo o
    JOIN titulo_receber t ON t.id = o.titulo_receber_id AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
   WHERE o.entidade = 'conta_hospitalar' AND o.excluido_em IS NULL AND o.entidade_id IN (${ph(n)})
     AND t.estabelecimento_id = ? AND t.fonte_pagadora_id = ?
   ORDER BY o.entidade_id, t.id DESC`;

function recusar<T extends object>(r: RecusaBaixaPagamento | T): T {
  if ('codigo' in r && 'mensagem' in r) throw recusa(r.codigo, r.mensagem);
  return r;
}

const baixarPagamentoTiss = definirOperacao<z.infer<typeof esquemaBaixarPagamentoTiss>, ResultadoOperacao>({
  nome: 'financeiro.baixar_pagamento_tiss',
  tabelas: [
    'recebimento',
    'movimento_bancario',
    'parcela_receber',
    'titulo_receber',
    'sequencia_negocio',
    'demonstrativo_pagamento',
    'demonstrativo_pagamento_item',
  ],
  entrada: esquemaBaixarPagamentoTiss as never,
  async gravar(tx, e, ctx: ContextoOperacao) {
    if (ctx.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
    const est = ctx.estabelecimento;
    const usuario = ctx.usuario;
    await exigirPeriodoAberto(tx, est, e.dataRecebimento, 'dataRecebimento');
    const { contasDoEscopo } = await import('./operacoes.js');
    if (!(await contasDoEscopo(tx, est, usuario, 'movimentar')).includes(e.conta))
      throw recusa('fora-do-escopo', 'A conta bancária não está no seu escopo de contas.', {
        campos: ['conta'],
      });
    const conta = await tx.uma(
      'SELECT id, permite_recebimento FROM conta_bancaria WHERE id = ? AND estabelecimento_id = ?',
      [e.conta, est],
    );
    if (!conta || !Number(conta['permite_recebimento']))
      throw recusa('conta-nao-recebe', 'Esta conta bancária não é usada para recebimentos.', {
        campos: ['conta'],
      });
    const [d] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, numero_demonstrativo, fonte_pagadora_id, valor_debitos, valor_creditos
         FROM demonstrativo_pagamento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.demonstrativo, est],
      { teto: 1 },
    );
    if (!d) throw recusa('demonstrativo-inexistente', 'O demonstrativo não existe neste estabelecimento.');
    const fonte = numero(d['fonte_pagadora_id']);
    const linhas = await tx.consultarParaAtualizar(SQL_LINHAS, [e.demonstrativo], { teto: 20000 });
    const lotes = [
      ...new Set(
        linhas
          .filter((l) => l['conta_hospitalar_id'] === null && l['lote_tiss_id'] !== null)
          .map((l) => numero(l['lote_tiss_id'])),
      ),
    ];
    const contasDoLote = new Map<number, number[]>();
    for (const r of lotes.length ? await tx.consultar(SQL_CONTAS_DOS_LOTES(lotes), lotes) : [])
      contasDoLote.set(numero(r['lote_tiss_id']), [
        ...(contasDoLote.get(numero(r['lote_tiss_id'])) ?? []),
        numero(r['conta_hospitalar_id']),
      ]);
    const contasDe = (l: Linha) =>
      l['conta_hospitalar_id'] !== null
        ? [numero(l['conta_hospitalar_id'])]
        : l['lote_tiss_id'] !== null
          ? (contasDoLote.get(numero(l['lote_tiss_id'])) ?? [])
          : [];
    const contas = [...new Set(linhas.flatMap(contasDe))];
    const titulos = contas.length
      ? await tx.consultarParaAtualizar(SQL_TITULOS(contas), [...contas, est, fonte], { teto: 20000 })
      : [];
    const parcelas = new Map<number, Linha>();
    const idsParcela = [...new Set(titulos.map((t) => numero(t['parcela'])).filter((x) => x > 0))];
    for (const p of idsParcela.length
      ? await tx.consultarParaAtualizar(
          `SELECT id, versao, titulo_receber_id, saldo, valor_recebido FROM parcela_receber
            WHERE id IN (${ph(idsParcela)}) ORDER BY id`,
          idsParcela,
          { teto: 20000 },
        )
      : [])
      parcelas.set(numero(p['id']), p);
    const plano = recusar(
      planejarBaixaPagamento({
        situacao: String(d['situacao']),
        linhas: linhas.map((l) => ({
          linha: numero(l['id']),
          contas: contasDe(l),
          liberado: numero(l['valor_liberado']),
          glosa: numero(l['valor_glosa']),
        })),
        titulos: titulos.map((t) => {
          const p = parcelas.get(numero(t['parcela']));
          return {
            titulo: numero(t['id']),
            conta: numero(t['conta']),
            parcela: p ? numero(p['id']) : null,
            saldo: numero(p?.['saldo']),
          };
        }),
        debitos: numero(d['valor_debitos']),
        creditos: numero(d['valor_creditos']),
      }),
    );
    const numeroDemonstrativo = String(d['numero_demonstrativo']);
    const documento = numeroDemonstrativo.slice(0, 30);
    const forma = await tx.uma(
      `SELECT id FROM forma_recebimento WHERE ativo = TRUE AND uso IN ('recebimento','ambos')
        ORDER BY (meio IN ('transferencia','credito_conta')) DESC, padrao DESC, id LIMIT 1`,
      [],
    );
    if (!forma)
      throw recusa('cadastro-ausente', 'Falta no cadastro uma forma de recebimento ativa.', {
        campos: ['conta'],
      });
    const porTitulo = new Map(titulos.map((t) => [numero(t['id']), t]));
    let movimento: number | null = null;
    if (plano.totalLiquido > 0) {
      const tipo = await tx.uma('SELECT id FROM tipo_lancamento_bancario WHERE codigo = ? AND ativo = TRUE', [
        LANCAMENTO_RECEBIMENTO,
      ]);
      if (!tipo)
        throw recusa('cadastro-ausente', 'Falta no cadastro o tipo de lançamento bancário do recebimento.');
      movimento = await tx.incluir('movimento_bancario', {
        estabelecimento_id: est,
        conta_bancaria_id: e.conta,
        tipo_lancamento_bancario_id: tipo['id'],
        natureza: 'credito',
        tipo_origem: 'manual',
        data_movimento: e.dataRecebimento,
        numero_documento: documento,
        historico: `Recebimento pelo demonstrativo de pagamento TISS ${numeroDemonstrativo}`.slice(0, 300),
        valor: plano.totalLiquido,
        natureza_financeira_id:
          porTitulo.get(plano.baixas[0]?.titulo ?? 0)?.['natureza_financeira_id'] ?? null,
      });
    }
    await garantirSequencia(
      tx,
      { tipo: 'recebimento', estabelecimento: est, prefixo: 'RC-' },
      { usuario, agora: new Date() },
    );
    for (const b of plano.baixas) {
      const t = porTitulo.get(b.titulo) as Linha;
      const p = parcelas.get(b.parcela) as Linha;
      const num = await tx.proximoNumero('recebimento');
      await tx.incluir('recebimento', {
        estabelecimento_id: est,
        numero: num.formatado,
        parcela_receber_id: b.parcela,
        data_recebimento: e.dataRecebimento,
        forma_recebimento_id: forma['id'],
        conta_bancaria_id: e.conta,
        numero_documento: documento,
        valor_recebido: b.recebido,
        valor_glosa: b.glosa,
        valor_retencao: b.retencao,
        valor_juros: b.acrescimo,
        meio_baixa: 'demonstrativo',
        movimento_bancario_id: b.liquido > 0 ? movimento : null,
        observacao:
          `Baixa pelo demonstrativo de pagamento TISS ${numeroDemonstrativo}: líquido ${b.liquido.toFixed(2)}, débitos ${b.retencao.toFixed(2)}, créditos ${b.acrescimo.toFixed(2)}`.slice(
            0,
            500,
          ),
      });
      await tx.alterar('parcela_receber', b.parcela, numero(p['versao']), {
        valor_recebido: centavos(numero(p['valor_recebido']) + b.recebido),
        saldo: b.saldoRestante,
        situacao: b.quita ? 'recebida' : 'parcial',
        quitada_em: b.quita ? e.dataRecebimento : null,
      });
      const outrasAbertas = await tx.uma(
        `SELECT id FROM parcela_receber WHERE titulo_receber_id = ? AND id <> ? AND excluido_em IS NULL
            AND saldo > 0 AND situacao IN ('aberta','parcial') LIMIT 1`,
        [b.titulo, b.parcela],
      );
      await tx.alterar('titulo_receber', b.titulo, numero(t['versao']), {
        valor_recebido: centavos(numero(t['valor_recebido']) + b.recebido),
        situacao: b.quita && !outrasAbertas ? 'recebido' : 'recebido_parcial',
      });
    }
    const baixadas = new Set(plano.linhasBaixadas);
    for (const l of linhas)
      if (baixadas.has(numero(l['id'])) && String(l['situacao_conciliacao']) !== 'conciliado')
        await tx.alterar('demonstrativo_pagamento_item', numero(l['id']), numero(l['versao']), {
          situacao_conciliacao: 'conciliado',
        });
    await tx.alterar('demonstrativo_pagamento', e.demonstrativo, numero(d['versao']), {
      situacao: 'baixado',
      conta_bancaria_id: e.conta,
      titulo_receber_id: plano.baixas[0]?.titulo ?? null,
    });
    return {
      demonstrativo: e.demonstrativo,
      numero: numeroDemonstrativo,
      titulos: plano.baixas.length,
      linhas: baixadas.size,
      recebido: plano.totalRecebido,
      retencao: plano.totalRetencao,
      acrescimo: plano.totalAcrescimo,
      liquido: plano.totalLiquido,
      linhasSemTitulo: plano.linhasSemTitulo,
      valorSemTitulo: plano.valorSemTitulo,
      conta: e.conta,
      movimento,
    };
  },
  alvo: (e) => ({ tabela: 'demonstrativo_pagamento', id: e.demonstrativo }),
  eventos: (_e, r) => [
    {
      tipo: 'financeiro.titulo_receber.recebido',
      carga: { titulos: numero(r['titulos']), conta: numero(r['conta']) },
    },
  ],
});

export const OPERACOES_BAIXA_PAGAMENTO_TISS = {
  'financeiro.baixarPagamentoTiss': baixarPagamentoTiss,
} as const;
