// Simulação de cenários de receita sobre a produção real (F8, 01-ADM L120), no banco do cliente. As regras são do
// @sgh/dominio-faturamento (simulacao/simulacao-receita); o preço de destino vem do mesmo motor de preços do lançamento
// da conta (preco-conta.ts: tabelasDePreco e precoVigente), para que o simulado seja o que a conta cobraria.
// Contrato de efeito (simulacao-receita-propria.int.spec.ts):
// - criar o cenário grava cenario_simulacao_receita (rascunho, dono), a premissa de cada reajuste e do recorte por tipo
//   de atendimento (cenario_simulacao_parametro), a troca por convênio (regra_conversao_tabela_preco) e o de-para de
//   procedimentos com fatores (regra_conversao_procedimento), com os códigos resolvidos no catálogo;
// - executar recalcula os itens da produção do período pelo motor de preços e grava a execução (simulacao_receita, com
//   os totais), o resultado por convênio, procedimento e tipo de atendimento (simulacao_receita_resultado) e o que não
//   se conseguiu precificar (simulacao_receita_inconsistencia); o cenário fica "concluido" com a receita base e a
//   simulada. A operação só pode gravar essas tabelas: nada muda nas contas (o executor recusa qualquer outra).
// - cada execução é uma fotografia nova: as anteriores ficam como histórico.
import {
  consolidarInconsistencias,
  consolidarResultado,
  DATAS_REFERENCIA_SIMULACAO,
  type DataReferenciaSimulacao,
  normalizarPeriodoCenario,
  type LinhaRecalculada,
  objetivoDoCenario,
  type OcorrenciaInconsistencia,
  planoDoItem,
  type RegraResolvida,
  regraDoItem,
  TIPOS_ATENDIMENTO_FILTRO,
  tipoAtendimentoDaConta,
  tipoDaSimulacao,
  totaisDaSimulacao,
  validarCenarioReceita,
  valorSimuladoDoItem,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { precoVigente, tabelasDePreco } from './preco-conta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const p2 = (x: number) => String(x).padStart(2, '0');
function dia(v: unknown): string {
  if (v instanceof Date) return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  return txt(v).slice(0, 10);
}
function quando(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return `${dia(v)}T${p2(v.getHours())}:${p2(v.getMinutes())}:${p2(v.getSeconds())}`;
  return txt(v).replace(' ', 'T').slice(0, 19);
}
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('invalido', Object.values(erros).join(' '), { campos });
}
function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}
function usuarioDe(ctx: ContextoOperacao): number {
  if (ctx.usuario === null || ctx.usuario === undefined)
    throw recusa('sem-usuario', 'A simulação pede um usuário identificado.', { campos: [] });
  return ctx.usuario;
}

/** Itens de produção que uma execução recalcula de uma vez (acima disso, divide-se o período ou os convênios). */
export const LIMITE_ITENS_SIMULACAO = 50_000;

/** As naturezas de conta de cada tipo de atendimento do recorte. */
const NATUREZAS: Record<(typeof TIPOS_ATENDIMENTO_FILTRO)[number], readonly string[]> = {
  ambulatorial: ['ambulatorial'],
  urgencia: ['pronto_atendimento'],
  internacao: ['internacao'],
  externo: ['externo'],
};

// ── Entradas ────────────────────────────────────────────────────────────────────────────────────────────
const id = z.number().int().positive();
const esquemaConversao = z.object({
  itemAtualCodigo: z.string().trim().max(20),
  itemDestinoCodigo: z.string().trim().max(20),
  fatorAtual: z.number().default(1),
  fatorDestino: z.number().default(1),
  acrescimoValor: z.number().nullable().default(null),
  mantemValorOriginal: z.boolean().default(false),
});
const esquemaRegra = z.object({
  fontePagadoraId: z.number().int(),
  planoId: id.nullable().default(null),
  tabelaDestinoId: id.nullable().default(null),
  fonteDestinoId: id.nullable().default(null),
  planoDestinoId: id.nullable().default(null),
  percentualAjuste: z.number().nullable().default(null),
  conversoes: z.array(esquemaConversao).max(500).default([]),
});
export const esquemaCriarCenarioReceita = z.object({
  nome: z.string().max(150),
  descricao: z.string().trim().max(2000).nullable().default(null),
  producaoInicio: z.string().max(10),
  producaoFim: z.string().max(10),
  dataReferencia: z.enum(DATAS_REFERENCIA_SIMULACAO).default('competencia'),
  tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_FILTRO).nullable().default(null),
  regras: z.array(esquemaRegra).max(50),
});
export const esquemaExecutarSimulacaoReceita = z.object({
  cenarioId: id,
  // O recorte é premissa gravada do cenário; quem manda o recorte só confirma o do cenário (divergente é recusado).
  dataReferencia: z.enum(DATAS_REFERENCIA_SIMULACAO).nullable().default(null),
});

// ── Criar o cenário ─────────────────────────────────────────────────────────────────────────────────────
async function conferirReferencias(
  tx: Pick<Leitor, 'uma' | 'consultar'>,
  est: number,
  e: z.infer<typeof esquemaCriarCenarioReceita>,
): Promise<Map<string, number>> {
  const erros: Record<string, string> = {};
  const fonteExiste = async (f: number) =>
    !!(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [f]));
  const planoDa = async (p: number, f: number) =>
    !!(await tx.uma('SELECT id FROM plano_fonte_pagadora WHERE id = ? AND fonte_pagadora_id = ?', [p, f]));
  for (const [i, r] of e.regras.entries()) {
    const p = `regras.${i}`;
    if (!(await fonteExiste(r.fontePagadoraId))) erros[`${p}.fontePagadoraId`] = 'Convênio não encontrado.';
    if (r.planoId !== null && !(await planoDa(r.planoId, r.fontePagadoraId)))
      erros[`${p}.planoId`] = 'O plano não é deste convênio.';
    if (r.fonteDestinoId !== null && !(await fonteExiste(r.fonteDestinoId)))
      erros[`${p}.fonteDestinoId`] = 'Convênio simulado não encontrado.';
    if (
      r.planoDestinoId !== null &&
      r.fonteDestinoId !== null &&
      !(await planoDa(r.planoDestinoId, r.fonteDestinoId))
    )
      erros[`${p}.planoDestinoId`] = 'O plano simulado não é do convênio simulado.';
    if (r.tabelaDestinoId !== null) {
      const t = await tx.uma<Linha>(
        `SELECT id FROM tabela_preco WHERE id = ? AND excluido_em IS NULL AND situacao = 'ativa'
            AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)`,
        [r.tabelaDestinoId, est],
      );
      if (!t) erros[`${p}.tabelaDestinoId`] = 'Tabela de preço não encontrada ou inativa.';
    }
  }
  const codigos = [
    ...new Set(
      e.regras.flatMap((r) => r.conversoes.flatMap((c) => [c.itemAtualCodigo, c.itemDestinoCodigo])),
    ),
  ];
  const ids = new Map<string, number>();
  if (codigos.length) {
    const r = await tx.consultar<Linha>(
      `SELECT id, codigo FROM item_faturavel WHERE excluido_em IS NULL AND codigo IN (${lista(codigos.length)})`,
      codigos,
      { teto: codigos.length },
    );
    for (const x of r) ids.set(txt(x['codigo']), n(x['id']));
  }
  e.regras.forEach((r, i) =>
    r.conversoes.forEach((c, j) => {
      const q = `regras.${i}.conversoes.${j}`;
      if (!ids.has(c.itemAtualCodigo))
        erros[`${q}.itemAtualCodigo`] = `O código ${c.itemAtualCodigo} não está no catálogo de itens.`;
      if (!ids.has(c.itemDestinoCodigo))
        erros[`${q}.itemDestinoCodigo`] = `O código ${c.itemDestinoCodigo} não está no catálogo de itens.`;
    }),
  );
  exigirValido(erros);
  return ids;
}

export const opCriarCenarioReceita = definirOperacao({
  nome: 'faturamento.criar-cenario-receita',
  tabelas: [
    'cenario_simulacao_receita',
    'cenario_simulacao_parametro',
    'regra_conversao_tabela_preco',
    'regra_conversao_procedimento',
  ],
  entrada: esquemaCriarCenarioReceita,
  async gravar(tx, bruto, ctx) {
    const est = estDe(ctx);
    const dono = usuarioDe(ctx);
    // Pela competência, o período vira o dia 1 de cada mês (a competência da conta é sempre o dia 1).
    const e = normalizarPeriodoCenario(bruto);
    exigirValido(validarCenarioReceita(e));
    const nome = e.nome.trim();
    const mesmo = await tx.uma(
      'SELECT id FROM cenario_simulacao_receita WHERE estabelecimento_id = ? AND nome = ?',
      [est, nome],
    );
    if (mesmo) throw recusa('invalido', 'Já existe um cenário com este nome.', { campos: ['nome'] });
    const ids = await conferirReferencias(tx, est, e);
    const cenario = await tx.incluir('cenario_simulacao_receita', {
      estabelecimento_id: est,
      nome,
      objetivo: objetivoDoCenario(e.regras),
      descricao: e.descricao || null,
      producao_inicio: e.producaoInicio,
      producao_fim: e.producaoFim,
      data_referencia: e.dataReferencia,
      situacao: 'rascunho',
      dono_usuario_id: dono,
    });
    let seq = 0;
    const parametro = (v: Record<string, unknown>) =>
      tx.incluir('cenario_simulacao_parametro', {
        cenario_simulacao_receita_id: cenario,
        sequencia: ++seq,
        ...v,
      });
    if (e.tipoAtendimento)
      await parametro({ tipo_parametro: 'filtro_tipo_atendimento', tipo_atendimento: e.tipoAtendimento });
    let conversoes = 0;
    for (const r of e.regras) {
      if (r.percentualAjuste !== null && r.percentualAjuste !== 0)
        await parametro({
          tipo_parametro: 'reajuste_fonte_pagadora',
          fonte_pagadora_id: r.fontePagadoraId,
          plano_fonte_pagadora_id: r.planoId,
          percentual_reajuste: r.percentualAjuste,
          vigencia_inicio: e.producaoInicio,
          vigencia_fim: e.producaoFim,
        });
      const semDestino =
        r.tabelaDestinoId === null && r.fonteDestinoId === null && r.percentualAjuste === null;
      const regra = await tx.incluir('regra_conversao_tabela_preco', {
        cenario_simulacao_receita_id: cenario,
        atual_fonte_pagadora_id: r.fontePagadoraId,
        atual_plano_fonte_pagadora_id: r.planoId,
        destino_fonte_pagadora_id: r.fonteDestinoId,
        destino_plano_fonte_pagadora_id: r.planoDestinoId,
        destino_tabela_preco_id: r.tabelaDestinoId,
        // Só conversões: o reajuste fica 0% (a troca por convênio precisa dizer o que muda).
        percentual_ajuste: semDestino ? 0 : r.percentualAjuste,
        vigencia_inicio: e.producaoInicio,
        vigencia_fim: e.producaoFim,
        ativo: true,
      });
      for (const c of r.conversoes) {
        await tx.incluir('regra_conversao_procedimento', {
          regra_conversao_tabela_preco_id: regra,
          atual_item_faturavel_id: ids.get(c.itemAtualCodigo),
          destino_item_faturavel_id: ids.get(c.itemDestinoCodigo),
          fator_atual: c.fatorAtual,
          fator_destino: c.fatorDestino,
          acrescimo_valor: c.acrescimoValor,
          mantem_valor_original: c.mantemValorOriginal,
          vigencia_inicio: e.producaoInicio,
          vigencia_fim: e.producaoFim,
          ativo: true,
        });
        conversoes += 1;
      }
    }
    return {
      id: cenario,
      regras: e.regras.length,
      conversoes,
      parametros: seq,
      producaoInicio: e.producaoInicio,
      producaoFim: e.producaoFim,
      dataReferencia: e.dataReferencia,
    };
  },
  alvo: (_e, s) => ({ tabela: 'cenario_simulacao_receita', id: s.id }),
});

// ── Executar a simulação ───────────────────────────────────────────────────────────────────────────────
interface RegraDoCenario extends RegraResolvida {
  readonly id: number;
  readonly fontePagadoraId: number;
  readonly planoId: number | null;
  readonly planoDestinoId: number | null;
}

async function regrasDoCenario(l: Pick<Leitor, 'consultar'>, cenario: number): Promise<RegraDoCenario[]> {
  const regras = await l.consultar<Linha>(
    `SELECT id, atual_fonte_pagadora_id, atual_plano_fonte_pagadora_id, destino_fonte_pagadora_id,
            destino_plano_fonte_pagadora_id, destino_tabela_preco_id, percentual_ajuste
       FROM regra_conversao_tabela_preco WHERE cenario_simulacao_receita_id = ? AND ativo = TRUE ORDER BY id`,
    [cenario],
    { teto: 200 },
  );
  const conv = regras.length
    ? await l.consultar<Linha>(
        `SELECT regra_conversao_tabela_preco_id, atual_item_faturavel_id, destino_item_faturavel_id, fator_atual,
                fator_destino, acrescimo_valor, mantem_valor_original
           FROM regra_conversao_procedimento
          WHERE ativo = TRUE AND destino_item_faturavel_id IS NOT NULL
            AND regra_conversao_tabela_preco_id IN (${lista(regras.length)}) ORDER BY id`,
        regras.map((r) => r['id']),
        { teto: 25_000 },
      )
    : [];
  return regras.map((r) => ({
    id: n(r['id']),
    fontePagadoraId: n(r['atual_fonte_pagadora_id']),
    planoId: nn(r['atual_plano_fonte_pagadora_id']),
    fonteDestinoId: nn(r['destino_fonte_pagadora_id']),
    planoDestinoId: nn(r['destino_plano_fonte_pagadora_id']),
    tabelaDestinoId: nn(r['destino_tabela_preco_id']),
    percentualAjuste: nn(r['percentual_ajuste']),
    conversoes: conv
      .filter((c) => n(c['regra_conversao_tabela_preco_id']) === n(r['id']))
      .map((c) => ({
        itemAtualId: n(c['atual_item_faturavel_id']),
        itemDestinoId: n(c['destino_item_faturavel_id']),
        fatorAtual: n(c['fator_atual']),
        fatorDestino: n(c['fator_destino']),
        acrescimoValor: nn(c['acrescimo_valor']),
        mantemValorOriginal: Number(c['mantem_valor_original']) === 1 || c['mantem_valor_original'] === true,
      })),
  }));
}

/** A produção real do período: os itens cobráveis das contas válidas dos convênios do cenário. */
async function producaoDoPeriodo(
  l: Pick<Leitor, 'consultar'>,
  est: number,
  inicio: string,
  fim: string,
  data: (typeof DATAS_REFERENCIA_SIMULACAO)[number],
  fontes: readonly number[],
  tipo: (typeof TIPOS_ATENDIMENTO_FILTRO)[number] | null,
) {
  const naturezas = tipo ? NATUREZAS[tipo] : null;
  const recorte =
    data === 'competencia'
      ? 'c.competencia BETWEEN ? AND ?'
      : 'i.realizado_em >= ? AND i.realizado_em < DATE_ADD(?, INTERVAL 1 DAY)';
  const r = await l.consultar<Linha>(
    `SELECT i.item_faturavel_id, i.quantidade, i.percentual_cobranca, i.valor_total, i.realizado_em,
            c.id AS conta_id, c.atendimento_id, c.fonte_pagadora_id, c.plano_fonte_pagadora_id, c.tabela_preco_id,
            c.natureza
       FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
      WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao <> 'cancelada'
        AND c.reposicao_consumo = FALSE AND i.excluido_em IS NULL AND i.extra = FALSE
        AND i.situacao IN ('lancado', 'conferido', 'glosado') AND ${recorte}
        AND c.fonte_pagadora_id IN (${lista(fontes.length)})
        ${naturezas ? `AND c.natureza IN (${lista(naturezas.length)})` : ''}
      ORDER BY i.id LIMIT ${LIMITE_ITENS_SIMULACAO + 1}`,
    [est, inicio, fim, ...fontes, ...(naturezas ?? [])],
    { teto: LIMITE_ITENS_SIMULACAO + 1 },
  );
  if (r.length > LIMITE_ITENS_SIMULACAO)
    throw recusa(
      'invalido',
      `A produção do período passa de ${LIMITE_ITENS_SIMULACAO} itens; divida o período ou os convênios.`,
      { campos: ['producaoFim'] },
    );
  return r;
}

export const opExecutarSimulacaoReceita = definirOperacao({
  nome: 'faturamento.executar-simulacao-receita',
  tabelas: [
    'simulacao_receita',
    'simulacao_receita_resultado',
    'simulacao_receita_inconsistencia',
    'cenario_simulacao_receita',
  ],
  entrada: esquemaExecutarSimulacaoReceita,
  async gravar(tx: TxOperacao, e, ctx) {
    const est = estDe(ctx);
    const solicitante = usuarioDe(ctx);
    const c = await tx.uma<Linha>(
      `SELECT id, nome, situacao, producao_inicio, producao_fim, data_referencia, versao FROM cenario_simulacao_receita
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.cenarioId, est],
    );
    if (!c)
      throw recusa('nao-encontrado', 'Cenário não encontrado neste estabelecimento.', {
        campos: ['cenarioId'],
      });
    if (txt(c['situacao']) === 'arquivado')
      throw recusa('invalido', 'O cenário está arquivado.', { campos: ['cenarioId'] });
    const recorte = txt(c['data_referencia']) as DataReferenciaSimulacao;
    if (e.dataReferencia !== null && e.dataReferencia !== recorte)
      throw recusa(
        'invalido',
        `O cenário foi salvo com o recorte pela ${recorte === 'competencia' ? 'competência' : 'data do atendimento'}; para outro recorte, crie outro cenário.`,
        { campos: ['dataReferencia'] },
      );
    const regras = await regrasDoCenario(tx, e.cenarioId);
    if (!regras.length) throw recusa('invalido', 'O cenário não tem convênio.', { campos: ['cenarioId'] });
    const filtro = await tx.uma<Linha>(
      `SELECT tipo_atendimento FROM cenario_simulacao_parametro
        WHERE cenario_simulacao_receita_id = ? AND tipo_parametro = 'filtro_tipo_atendimento' AND excluido_em IS NULL`,
      [e.cenarioId],
    );
    const tipoFiltro = (filtro ? txt(filtro['tipo_atendimento']) : null) as
      (typeof TIPOS_ATENDIMENTO_FILTRO)[number] | null;
    const inicio = dia(c['producao_inicio']);
    const fim = dia(c['producao_fim']);
    const iniciada = new Date();
    const producao = await producaoDoPeriodo(
      tx,
      est,
      inicio,
      fim,
      recorte,
      [...new Set(regras.map((r) => r.fontePagadoraId))],
      tipoFiltro,
    );

    // O preço de destino pelo motor da conta, com memória por tabela, convênio, item, dia e natureza da conta.
    const tabelasCache = new Map<string, number[]>();
    const precoCache = new Map<string, { unitario: number | null; detalhe: string | null }>();
    const tabelasDe = async (k: string, fn: () => Promise<number[]>) => {
      const t = tabelasCache.get(k) ?? (await fn());
      tabelasCache.set(k, t);
      return t;
    };
    const linhas: LinhaRecalculada[] = [];
    const ocorrencias: (OcorrenciaInconsistencia & { valorAtual: number })[] = [];
    for (const p of producao) {
      const fonte = n(p['fonte_pagadora_id']);
      const plano = nn(p['plano_fonte_pagadora_id']);
      const regra = regraDoItem(regras, fonte, plano);
      if (!regra) continue;
      const item = {
        itemFaturavelId: n(p['item_faturavel_id']),
        quantidade: n(p['quantidade']),
        percentualCobranca: n(p['percentual_cobranca']),
        valorAtual: n(p['valor_total']),
      };
      const data = dia(p['realizado_em']);
      const plan = planoDoItem(item, regra);
      let unitario: number | null = null;
      let detalhe: string | null = null;
      if (plan.precisaPreco) {
        const tabelas =
          regra.tabelaDestinoId !== null
            ? [regra.tabelaDestinoId]
            : regra.fonteDestinoId !== null
              ? await tabelasDe(`f${regra.fonteDestinoId}|${regra.planoDestinoId ?? ''}`, () =>
                  tabelasDePreco(tx, est, regra.fonteDestinoId!, regra.planoDestinoId),
                )
              : await tabelasDe(`c${fonte}|${plano ?? ''}|${nn(p['tabela_preco_id']) ?? ''}`, () =>
                  tabelasDePreco(tx, est, fonte, plano, nn(p['tabela_preco_id'])),
                );
        const fonteAlvo = regra.fonteDestinoId ?? fonte;
        const chave = `${tabelas.join(',')}|${fonteAlvo}|${plan.itemCobradoId}|${data}|${txt(p['natureza'])}`;
        let preco = precoCache.get(chave);
        if (!preco) {
          try {
            const v = await precoVigente(tx, tabelas, plan.itemCobradoId, data, {
              est,
              fonte: fonteAlvo,
              conta: n(p['conta_id']),
            });
            preco = { unitario: v ? v.unitario : null, detalhe: null };
          } catch (erro) {
            if (!(erro instanceof ErroOperacao)) throw erro;
            preco = { unitario: null, detalhe: txt(erro.problema.detail).slice(0, 300) };
          }
          precoCache.set(chave, preco);
        }
        unitario = preco.unitario;
        detalhe = preco.detalhe;
      }
      const v = valorSimuladoDoItem(item, regra, plan, unitario);
      if (v.inconsistencia)
        ocorrencias.push({
          motivo: detalhe ? 'outro' : v.inconsistencia,
          itemAtualId: item.itemFaturavelId,
          itemDestinoId: plan.conversao?.itemDestinoId ?? null,
          fatorAtual: plan.conversao?.fatorAtual ?? null,
          fatorDestino: plan.conversao?.fatorDestino ?? null,
          data,
          fontePagadoraId: fonte,
          detalhe,
          valorAtual: item.valorAtual,
        });
      linhas.push({
        fontePagadoraId: fonte,
        planoId: plano,
        fonteDestinoId: regra.fonteDestinoId,
        planoDestinoId: regra.planoDestinoId,
        itemFaturavelId: item.itemFaturavelId,
        tipoAtendimento: tipoAtendimentoDaConta(txt(p['natureza'])),
        atendimentoId: n(p['atendimento_id']),
        quantidade: item.quantidade,
        valorAtual: item.valorAtual,
        valorSimulado: v.valorSimulado,
      });
    }
    const resultado = consolidarResultado(linhas);
    const inconsistencias = consolidarInconsistencias(ocorrencias);
    const t = totaisDaSimulacao(linhas, inconsistencias);
    const agora = new Date();
    const simulacao = await tx.incluir('simulacao_receita', {
      estabelecimento_id: est,
      cenario_simulacao_receita_id: e.cenarioId,
      descricao: `${txt(c['nome'])} (${inicio} a ${fim})`.slice(0, 200),
      tipo_simulacao: tipoDaSimulacao(regras),
      periodo_inicio: inicio,
      periodo_fim: fim,
      data_referencia: recorte,
      solicitante_usuario_id: solicitante,
      solicitado_em: iniciada,
      iniciada_em: iniciada,
      concluida_em: agora,
      situacao: t.situacao,
      quantidade_itens: t.quantidadeItens,
      quantidade_inconsistencias: t.quantidadeInconsistencias,
      valor_atual_total: t.valorAtual,
      valor_simulado_total: t.valorSimulado,
    });
    for (const r of resultado)
      await tx.incluir('simulacao_receita_resultado', {
        simulacao_receita_id: simulacao,
        sequencia: r.sequencia,
        fonte_pagadora_id: r.fontePagadoraId,
        plano_fonte_pagadora_id: r.planoId,
        destino_fonte_pagadora_id: r.fonteDestinoId,
        destino_plano_fonte_pagadora_id: r.planoDestinoId,
        item_faturavel_id: r.itemFaturavelId,
        tipo_atendimento: r.tipoAtendimento,
        quantidade: r.quantidade,
        quantidade_atendimentos: r.quantidadeAtendimentos,
        valor_atual: r.valorAtual,
        valor_simulado: r.valorSimulado,
      });
    for (const i of inconsistencias)
      await tx.incluir('simulacao_receita_inconsistencia', {
        simulacao_receita_id: simulacao,
        sequencia: i.sequencia,
        atual_item_faturavel_id: i.itemAtualId,
        destino_item_faturavel_id: i.itemDestinoId,
        fator_atual: i.fatorAtual,
        fator_destino: i.fatorDestino,
        data_referencia: i.data,
        motivo: i.motivo,
        detalhe: i.detalhe,
      });
    await tx.alterar('cenario_simulacao_receita', e.cenarioId, n(c['versao']), {
      situacao: 'concluido',
      processado_em: agora,
      quantidade_atendimentos: t.quantidadeAtendimentos,
      receita_base: t.valorAtual,
      receita_simulada: t.valorSimulado,
    });
    return { id: simulacao, ...t, linhasResultado: resultado.length };
  },
  alvo: (_e, s) => ({ tabela: 'simulacao_receita', id: s.id }),
});

export const OPERACOES_SIMULACAO_RECEITA = {
  criar: opCriarCenarioReceita,
  executar: opExecutarSimulacaoReceita,
} as const;
export type NomeOperacaoSimulacaoReceita = keyof typeof OPERACOES_SIMULACAO_RECEITA;

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────
const opcao = (x: Linha) => ({ id: n(x['id']), descricao: txt(x['d']) });

/** A tela: cenários com a última execução, o histórico de execuções e as opções dos combos. */
export async function painelSimulacaoReceitaPropria(l: Leitor, est: number) {
  const cenarios = await l.consultar<Linha>(
    `SELECT id, nome, objetivo, descricao, producao_inicio, producao_fim, data_referencia, situacao, receita_base, receita_simulada,
            quantidade_atendimentos, processado_em
       FROM cenario_simulacao_receita WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 200`,
    [est],
    { teto: 200 },
  );
  const execucoes = await l.consultar<Linha>(
    `SELECT id, cenario_simulacao_receita_id, solicitado_em, situacao, data_referencia, tipo_simulacao,
            quantidade_itens, quantidade_inconsistencias, valor_atual_total, valor_simulado_total, valor_diferenca_total
       FROM simulacao_receita WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 500`,
    [est],
    { teto: 500 },
  );
  return {
    cenarios: cenarios.map((c) => ({
      id: n(c['id']),
      nome: txt(c['nome']),
      objetivo: txt(c['objetivo']),
      descricao: c['descricao'] == null ? null : txt(c['descricao']),
      producaoInicio: dia(c['producao_inicio']),
      producaoFim: dia(c['producao_fim']),
      dataReferencia: txt(c['data_referencia']),
      situacao: txt(c['situacao']),
      receitaBase: nn(c['receita_base']),
      receitaSimulada: nn(c['receita_simulada']),
      quantidadeAtendimentos: nn(c['quantidade_atendimentos']),
      processadoEm: quando(c['processado_em']),
    })),
    execucoes: execucoes.map((x) => ({
      id: n(x['id']),
      cenarioId: n(x['cenario_simulacao_receita_id']),
      solicitadoEm: quando(x['solicitado_em']),
      situacao: txt(x['situacao']),
      dataReferencia: txt(x['data_referencia']),
      tipo: txt(x['tipo_simulacao']),
      quantidadeItens: n(x['quantidade_itens']),
      quantidadeInconsistencias: n(x['quantidade_inconsistencias']),
      valorAtual: n(x['valor_atual_total']),
      valorSimulado: n(x['valor_simulado_total']),
      diferenca: n(x['valor_diferenca_total']),
    })),
    opcoes: {
      fontes: (
        await l.consultar<Linha>(
          'SELECT id, nome AS d FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome',
          [],
          { teto: 2000 },
        )
      ).map(opcao),
      planos: (
        await l.consultar<Linha>(
          `SELECT p.id, CONCAT(p.codigo, ' ', p.descricao) AS d, p.fonte_pagadora_id
             FROM plano_fonte_pagadora p JOIN fonte_pagadora f ON f.id = p.fonte_pagadora_id
            WHERE f.excluido_em IS NULL ORDER BY p.descricao`,
          [],
          { teto: 5000 },
        )
      ).map((x) => ({ ...opcao(x), fonteId: n(x['fonte_pagadora_id']) })),
      tabelas: (
        await l.consultar<Linha>(
          `SELECT id, CONCAT(codigo, ' ', descricao) AS d, fonte_pagadora_id FROM tabela_preco
            WHERE excluido_em IS NULL AND situacao = 'ativa' AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
            ORDER BY descricao`,
          [est],
          { teto: 2000 },
        )
      ).map((x) => ({ ...opcao(x), fonteId: nn(x['fonte_pagadora_id']) })),
    },
  };
}

const somas = (x: Linha) => ({
  quantidade: n(x['quantidade']),
  valorAtual: n(x['valor_atual']),
  valorSimulado: n(x['valor_simulado']),
  diferenca: Math.round((n(x['valor_simulado']) - n(x['valor_atual'])) * 100) / 100,
});

/** Uma execução: o cenário, os totais, o resultado por convênio, por grupo, por tipo de atendimento e por procedimento
 *  (os de maior diferença primeiro) e as inconsistências. */
export async function detalheSimulacaoReceitaPropria(l: Leitor, est: number, simulacao: number) {
  const s = await l.uma<Linha>(
    `SELECT s.*, c.nome AS cenario_nome, c.objetivo FROM simulacao_receita s
       JOIN cenario_simulacao_receita c ON c.id = s.cenario_simulacao_receita_id
      WHERE s.id = ? AND s.estabelecimento_id = ? AND s.excluido_em IS NULL`,
    [simulacao, est],
  );
  if (!s)
    throw recusa('nao-encontrado', 'Simulação não encontrada neste estabelecimento.', { campos: ['id'] });
  const regras = await l.consultar<Linha>(
    `SELECT r.id, f.nome AS fonte, p.descricao AS plano, fd.nome AS fonte_destino, t.descricao AS tabela_destino,
            r.percentual_ajuste,
            (SELECT COUNT(*) FROM regra_conversao_procedimento x WHERE x.regra_conversao_tabela_preco_id = r.id) AS conversoes
       FROM regra_conversao_tabela_preco r JOIN fonte_pagadora f ON f.id = r.atual_fonte_pagadora_id
       LEFT JOIN plano_fonte_pagadora p ON p.id = r.atual_plano_fonte_pagadora_id
       LEFT JOIN fonte_pagadora fd ON fd.id = r.destino_fonte_pagadora_id
       LEFT JOIN tabela_preco t ON t.id = r.destino_tabela_preco_id
      WHERE r.cenario_simulacao_receita_id = ? ORDER BY r.id`,
    [s['cenario_simulacao_receita_id']],
    { teto: 200 },
  );
  const porConvenio = await l.consultar<Linha>(
    `SELECT r.fonte_pagadora_id, f.nome AS fonte, r.destino_fonte_pagadora_id, fd.nome AS fonte_destino,
            SUM(r.quantidade) AS quantidade, SUM(r.valor_atual) AS valor_atual, SUM(r.valor_simulado) AS valor_simulado
       FROM simulacao_receita_resultado r JOIN fonte_pagadora f ON f.id = r.fonte_pagadora_id
       LEFT JOIN fonte_pagadora fd ON fd.id = r.destino_fonte_pagadora_id
      WHERE r.simulacao_receita_id = ? AND r.excluido_em IS NULL
      GROUP BY r.fonte_pagadora_id, f.nome, r.destino_fonte_pagadora_id, fd.nome ORDER BY f.nome`,
    [simulacao],
    { teto: 500 },
  );
  const porGrupo = await l.consultar<Linha>(
    `SELECT g.id AS grupo_id, COALESCE(g.descricao, 'Sem grupo') AS grupo,
            SUM(r.quantidade) AS quantidade, SUM(r.valor_atual) AS valor_atual, SUM(r.valor_simulado) AS valor_simulado
       FROM simulacao_receita_resultado r JOIN item_faturavel it ON it.id = r.item_faturavel_id
       LEFT JOIN grupo_faturamento g ON g.id = it.grupo_faturamento_id
      WHERE r.simulacao_receita_id = ? AND r.excluido_em IS NULL
      GROUP BY g.id, g.descricao ORDER BY ABS(SUM(r.valor_simulado) - SUM(r.valor_atual)) DESC`,
    [simulacao],
    { teto: 1000 },
  );
  const porTipo = await l.consultar<Linha>(
    `SELECT r.tipo_atendimento, SUM(r.quantidade) AS quantidade, SUM(r.valor_atual) AS valor_atual,
            SUM(r.valor_simulado) AS valor_simulado
       FROM simulacao_receita_resultado r WHERE r.simulacao_receita_id = ? AND r.excluido_em IS NULL
      GROUP BY r.tipo_atendimento ORDER BY r.tipo_atendimento`,
    [simulacao],
    { teto: 10 },
  );
  const itens = await l.consultar<Linha>(
    `SELECT r.sequencia, f.nome AS fonte, it.codigo, it.descricao, r.tipo_atendimento, r.quantidade,
            r.quantidade_atendimentos, r.valor_atual, r.valor_simulado
       FROM simulacao_receita_resultado r JOIN fonte_pagadora f ON f.id = r.fonte_pagadora_id
       JOIN item_faturavel it ON it.id = r.item_faturavel_id
      WHERE r.simulacao_receita_id = ? AND r.excluido_em IS NULL
      ORDER BY ABS(r.valor_diferenca) DESC, r.sequencia LIMIT 100`,
    [simulacao],
    { teto: 100 },
  );
  const inconsistencias = await l.consultar<Linha>(
    `SELECT x.sequencia, x.motivo, x.detalhe, x.data_referencia, x.resolvida, a.codigo AS codigo_atual,
            a.descricao AS descricao_atual, d.codigo AS codigo_destino
       FROM simulacao_receita_inconsistencia x LEFT JOIN item_faturavel a ON a.id = x.atual_item_faturavel_id
       LEFT JOIN item_faturavel d ON d.id = x.destino_item_faturavel_id
      WHERE x.simulacao_receita_id = ? AND x.excluido_em IS NULL ORDER BY x.sequencia`,
    [simulacao],
    { teto: 5000 },
  );
  const atual = n(s['valor_atual_total']);
  const diferenca = n(s['valor_diferenca_total']);
  return {
    simulacao: {
      id: n(s['id']),
      cenarioId: n(s['cenario_simulacao_receita_id']),
      cenario: txt(s['cenario_nome']),
      objetivo: txt(s['objetivo']),
      tipo: txt(s['tipo_simulacao']),
      periodoInicio: dia(s['periodo_inicio']),
      periodoFim: dia(s['periodo_fim']),
      dataReferencia: txt(s['data_referencia']),
      situacao: txt(s['situacao']),
      solicitadoEm: quando(s['solicitado_em']),
      quantidadeItens: n(s['quantidade_itens']),
      quantidadeInconsistencias: n(s['quantidade_inconsistencias']),
      valorAtual: atual,
      valorSimulado: n(s['valor_simulado_total']),
      diferenca,
      percentual: atual === 0 ? null : Math.round((diferenca / atual) * 10_000) / 100,
    },
    regras: regras.map((r) => ({
      id: n(r['id']),
      fonte: txt(r['fonte']),
      plano: r['plano'] == null ? null : txt(r['plano']),
      fonteDestino: r['fonte_destino'] == null ? null : txt(r['fonte_destino']),
      tabelaDestino: r['tabela_destino'] == null ? null : txt(r['tabela_destino']),
      percentualAjuste: nn(r['percentual_ajuste']),
      conversoes: n(r['conversoes']),
    })),
    porConvenio: porConvenio.map((x) => ({
      fonteId: n(x['fonte_pagadora_id']),
      fonte: txt(x['fonte']),
      fonteDestino: x['fonte_destino'] == null ? null : txt(x['fonte_destino']),
      ...somas(x),
    })),
    porGrupo: porGrupo.map((x) => ({ grupoId: nn(x['grupo_id']), grupo: txt(x['grupo']), ...somas(x) })),
    porTipoAtendimento: porTipo.map((x) => ({
      tipo: x['tipo_atendimento'] == null ? null : txt(x['tipo_atendimento']),
      ...somas(x),
    })),
    itens: itens.map((x) => ({
      sequencia: n(x['sequencia']),
      fonte: txt(x['fonte']),
      codigo: txt(x['codigo']),
      descricao: txt(x['descricao']),
      tipo: x['tipo_atendimento'] == null ? null : txt(x['tipo_atendimento']),
      atendimentos: n(x['quantidade_atendimentos']),
      ...somas(x),
    })),
    inconsistencias: inconsistencias.map((x) => ({
      sequencia: n(x['sequencia']),
      motivo: txt(x['motivo']),
      detalhe: x['detalhe'] == null ? null : txt(x['detalhe']),
      data: x['data_referencia'] == null ? null : dia(x['data_referencia']),
      codigoAtual: x['codigo_atual'] == null ? null : txt(x['codigo_atual']),
      descricaoAtual: x['descricao_atual'] == null ? null : txt(x['descricao_atual']),
      codigoDestino: x['codigo_destino'] == null ? null : txt(x['codigo_destino']),
      resolvida: Number(x['resolvida']) === 1 || x['resolvida'] === true,
    })),
  };
}
