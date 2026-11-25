// Ajustes de valor na conta sobre o banco do cliente (F3.7, 06-FAT linhas 17, 18 e 20). Leituras pelo Leitor e
// gravações pelo Executor (trilha, autoria e idempotência na mesma transação). As regras são do
// @sgh/dominio-faturamento (conta/ajustes): aqui só se lê, confere pelo domínio e grava. Nada se apaga: item que sai
// do pacote volta a ser cobrado, o item que cobrava o pacote fica estornado com o motivo, o ajuste recusado fica.
// - Linha 17: faixas de acréscimo por horário especial (acrescimo_horario_especial), expediente da tabela
//   (horario_normal_tabela) e a aplicação nos itens da conta pela hora em que foram feitos, no relógio do hospital.
// - Linha 18: acréscimo e desconto na conta (ajuste_conta) com motivo, justificativa e alçada (quem pede não decide).
// - Linha 20: versão, exceções, tetos e diárias do pacote; aplicação do pacote na conta (item do pacote, inclusos sem
//   cobrança, alertas de teto) e descaracterização com motivo, que devolve a conta à cobrança aberta.
import {
  alertasDoPacote,
  classificarItens,
  composicaoDaVersao,
  conferirAlcadaDoValor,
  etapaDaAlcada,
  conferirDecisaoAjuste,
  contaEditavel,
  diasDePermanenciaPacote,
  type FaixaHorarioEspecial,
  faixaDoHorario,
  faixasDoAto,
  itemDeAnestesia,
  acrescimoDoItem,
  type ItemParaPacote,
  type NivelAlcadaAjuste,
  type RegraAlcadaAjuste,
  type SituacaoAjuste,
  validarAjusteConta,
  validarFaixaHorario,
  validarNovaVersao,
  type VersaoPacote,
  versaoVigente,
  vespera,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { lerFeriadosDoPeriodo } from '../agenda/dias-sem-expediente-leitor.js';
import { totalDosItens } from './operacoes.js';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const b = (v: unknown) => v === true || v === 1 || v === '1';
const r2 = (x: number) => Math.round(x * 100) / 100;
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const hora = (v: unknown) => (v === null || v === undefined ? null : String(v).slice(0, 5));
/** Instante gravado (UTC) no relógio do hospital: 'AAAA-MM-DDTHH:MM'. */
export function noRelogio(v: unknown, fuso: string): string {
  const d = v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
  return d.toLocaleString('sv-SE', { timeZone: fuso, hour12: false }).replace(' ', 'T').slice(0, 16);
}

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
}
function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}

interface ContaLida {
  id: number;
  versao: number;
  situacao: string;
  inicio: unknown;
  fim: unknown;
  fonte: number;
  contrato: number | null;
  plano: number | null;
  tabela: number | null;
  acomodacao: number | null;
  valorItens: number;
  valorAcrescimo: number;
  valorDesconto: number;
  valorTotal: number;
  fuso: string;
}

async function contaDa(l: Consulta, est: number, conta: number): Promise<ContaLida> {
  const r = await l.uma<Linha>(
    `SELECT c.id, c.versao, c.situacao, c.inicio_em, c.fim_em, c.fonte_pagadora_id, c.contrato_fonte_pagadora_id,
            c.plano_fonte_pagadora_id,
            c.tabela_preco_id, c.categoria_acomodacao_id, c.valor_itens, c.valor_acrescimo, c.valor_desconto,
            c.valor_total, e.fuso_horario
       FROM conta_hospitalar c JOIN estabelecimento e ON e.id = c.estabelecimento_id
      WHERE c.id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL`,
    [conta, est],
  );
  if (!r)
    throw recusa('nao-encontrado', 'A conta não existe neste estabelecimento.', { campos: ['contaId'] });
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    situacao: String(r['situacao']),
    inicio: r['inicio_em'],
    fim: r['fim_em'],
    fonte: n(r['fonte_pagadora_id']),
    contrato: nn(r['contrato_fonte_pagadora_id']),
    plano: nn(r['plano_fonte_pagadora_id']),
    tabela: nn(r['tabela_preco_id']),
    acomodacao: nn(r['categoria_acomodacao_id']),
    valorItens: n(r['valor_itens']),
    valorAcrescimo: n(r['valor_acrescimo']),
    valorDesconto: n(r['valor_desconto']),
    valorTotal: n(r['valor_total']),
    fuso: txn(r['fuso_horario']) ?? 'America/Sao_Paulo',
  };
}
function exigirEditavel(c: ContaLida) {
  if (!contaEditavel(c.situacao))
    throw recusa('conta-fechada', 'A conta não está aberta: reabra-a para mudar os valores.', { campos: [] });
}
/** Trava a conta da sessão (nunca a de outro estabelecimento) antes de ler e gravar. */
async function travarConta(tx: TxOperacao, est: number, conta: number) {
  await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ?', [
    conta,
    est,
  ]);
}

/**
 * Trava a conta e refaz o total numa alteração só, sem gatilho. O acréscimo e o desconto do cabeçalho mudam só pela
 * diferença do ajuste que acabou de ser aprovado (delta): o que já estava no cabeçalho sem linha de ajuste (vindo da
 * importação ou de outro fluxo) fica como está.
 */
async function refazerTotal(
  tx: TxOperacao,
  conta: number,
  delta: { acrescimo: number; desconto: number } = { acrescimo: 0, desconto: 0 },
) {
  const v = await tx.consultarParaAtualizar(
    'SELECT versao, valor_acrescimo, valor_desconto FROM conta_hospitalar WHERE id = ?',
    [conta],
  );
  const acrescimo = r2(n(v[0]?.['valor_acrescimo']) + delta.acrescimo);
  const desconto = r2(n(v[0]?.['valor_desconto']) + delta.desconto);
  const tot = await totalDosItens(tx, conta);
  const valores = {
    valor_itens: tot.valor_itens,
    valor_filme: tot.valor_filme,
    valor_acrescimo: acrescimo,
    valor_desconto: desconto,
    valor_total: Math.max(0, r2(tot.valor_itens + acrescimo - desconto)),
  };
  await tx.alterar('conta_hospitalar', conta, n(v[0]?.['versao']), valores);
  return valores;
}

const id = z.number().int().positive();
const idN = id.nullable().default(null);
const dataZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).');

// ── Linha 17: horário especial ──────────────────────────────────────────────────────────────────────

function faixaDe(r: Linha): FaixaHorarioEspecial & { descricao: string; versao: number } {
  return {
    id: n(r['id']),
    codigo: String(r['codigo']),
    descricao: String(r['descricao']),
    tipoHorario: String(r['tipo_horario']) as FaixaHorarioEspecial['tipoHorario'],
    diaSemana: nn(r['dia_semana']),
    aplicaFeriado: b(r['aplica_feriado']),
    horaInicio: hora(r['hora_inicio']),
    horaFim: hora(r['hora_fim']),
    percentual: n(r['percentual_acrescimo']),
    percentualHonorario: nn(r['percentual_honorario']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
    fontePagadoraId: nn(r['fonte_pagadora_id']),
    contratoId: nn(r['contrato_fonte_pagadora_id']),
    percentualCustoOperacional: nn(r['percentual_custo_operacional']),
    percentualFilme: nn(r['percentual_filme']),
    percentualAnestesia: nn(r['percentual_anestesia']),
    exigeUrgencia: b(r['exige_urgencia']),
    aplicaProcedimentosVinculados: b(r['aplica_procedimentos_vinculados']),
    ativo: b(r['ativo']),
    versao: n(r['versao']),
  };
}

/** As faixas de acréscimo do estabelecimento (todas as fontes) e o expediente da tabela informada. */
export async function horarioEspecialPropria(l: Consulta, est: number, tabela: number | null = null) {
  const faixas = (
    await l.consultar<Linha>(
      'SELECT * FROM acrescimo_horario_especial WHERE estabelecimento_id = ? ORDER BY ativo DESC, codigo',
      [est],
    )
  ).map(faixaDe);
  const expediente =
    tabela === null
      ? []
      : (
          await l.consultar<Linha>(
            'SELECT dia_semana, hora_inicio, hora_fim FROM horario_normal_tabela WHERE tabela_preco_id = ? AND ativo = 1 ORDER BY dia_semana, hora_inicio',
            [tabela],
          )
        ).map((r) => ({
          diaSemana: n(r['dia_semana']),
          horaInicio: hora(r['hora_inicio'])!,
          horaFim: hora(r['hora_fim'])!,
        }));
  // Para o cadastro na tela: as fontes pagadoras ativas e as tabelas de preço do estabelecimento (ou da rede).
  const fontes = (
    await l.consultar<Linha>("SELECT id, nome FROM fonte_pagadora WHERE situacao = 'ativa' ORDER BY nome", [])
  ).map((r) => ({ id: n(r['id']), nome: String(r['nome']) }));
  const tabelas = (
    await l.consultar<Linha>(
      `SELECT id, codigo, descricao FROM tabela_preco
        WHERE situacao = 'ativa' AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) ORDER BY codigo`,
      [est],
    )
  ).map((r) => ({ id: n(r['id']), codigo: String(r['codigo']), descricao: String(r['descricao']) }));
  return { faixas, expediente, fontes, tabelas };
}

/** Dos dias dos itens, os que são feriado no estabelecimento, pelo calendário único (cadastros > estrutura). */
async function feriadosDe(l: Consulta, est: number, datas: string[]): Promise<Set<string>> {
  if (!datas.length) return new Set();
  const ordenadas = [...datas].sort();
  const doPeriodo = await lerFeriadosDoPeriodo(l, est, ordenadas[0]!, ordenadas[ordenadas.length - 1]!);
  const pedidas = new Set(datas);
  return new Set(doPeriodo.map((x) => x.data).filter((x) => pedidas.has(x)));
}

/** O caráter do atendimento da conta é de urgência ou emergência (TISS: caráter do atendimento). */
async function contaDeUrgencia(l: Consulta, conta: number): Promise<boolean> {
  const r = await l.uma<Linha>(
    `SELECT ct.urgencia FROM conta_hospitalar c
       JOIN atendimento a ON a.id = c.atendimento_id
       LEFT JOIN carater_atendimento_tiss ct ON ct.id = a.carater_atendimento_tiss_id
      WHERE c.id = ?`,
    [conta],
  );
  return r ? b(r['urgencia']) : false;
}

/**
 * O que a aplicação do horário especial faria em cada item cobrado da conta (sem gravar): a faixa pelo relógio do
 * hospital e pelo caráter do atendimento; o item acoplado segue a do principal quando ela replica (o mesmo ato); o
 * item de anestesia (função na equipe ou grau TISS de anestesia) leva o percentual de anestesia da faixa.
 */
async function horarioDosItens(l: Consulta, est: number, c: ContaLida) {
  const { faixas } = await horarioEspecialPropria(l, est);
  const exp = c.tabela === null ? [] : (await horarioEspecialPropria(l, est, c.tabela)).expediente;
  const urgencia = await contaDeUrgencia(l, c.id);
  const itens = await l.consultar<Linha>(
    `SELECT i.id, i.versao, i.sequencia, i.realizado_em, i.valor_total, i.valor_acrescimo, i.valor_honorario,
            i.valor_custo_operacional, i.valor_filme, i.valor_acrescimo_horario, i.item_pai_id,
            i.valor_desconto, i.acrescimo_horario_especial_id, f.codigo, f.descricao,
            fe.tipo_funcao, tg.codigo_termo AS grau_tiss
       FROM conta_hospitalar_item i JOIN item_faturavel f ON f.id = i.item_faturavel_id
       LEFT JOIN funcao_equipe_cobranca fe ON fe.id = i.funcao_equipe_cobranca_id
       LEFT JOIN termo_terminologia tg ON tg.id = fe.grau_participacao_termo_terminologia_id
      WHERE i.conta_hospitalar_id = ? AND i.excluido_em IS NULL AND i.situacao IN ('lancado','conferido')
        AND i.tipo_valorizacao <> 'pacote' ORDER BY i.sequencia`,
    [c.id],
  );
  const quando = itens.map((i) => noRelogio(i['realizado_em'], c.fuso));
  const feriados = await feriadosDe(l, est, [...new Set(quando.map((q) => q.slice(0, 10)))]);
  const doAto = faixasDoAto(
    itens.map((i, k) => ({
      id: n(i['id']),
      principalId: nn(i['item_pai_id']),
      faixa: faixaDoHorario(
        {
          quando: quando[k]!,
          feriado: feriados.has(quando[k]!.slice(0, 10)),
          fontePagadoraId: c.fonte,
          contratoId: c.contrato,
          urgencia,
        },
        faixas,
        exp,
      ),
    })),
  );
  return itens.map((i, k) => {
    // O acréscimo de horário fica em coluna própria: o acréscimo manual ou importado do item (o resto de
    // valor_acrescimo) é preservado, e a base do cálculo é o valor do item sem nenhum acréscimo.
    const horarioAtual = n(i['valor_acrescimo_horario']);
    const outros = r2(n(i['valor_acrescimo']) - horarioAtual);
    const base = r2(n(i['valor_total']) - horarioAtual);
    const f = doAto.get(n(i['id'])) ?? null;
    const anestesia = itemDeAnestesia(txn(i['tipo_funcao']), txn(i['grau_tiss']));
    const acrescimo = f
      ? acrescimoDoItem(
          r2(base - outros + n(i['valor_desconto'])),
          {
            honorario: n(i['valor_honorario']),
            custoOperacional: n(i['valor_custo_operacional']),
            filme: n(i['valor_filme']),
            anestesia,
          },
          f,
        )
      : 0;
    return {
      id: n(i['id']),
      versao: n(i['versao']),
      sequencia: n(i['sequencia']),
      codigo: String(i['codigo']),
      descricao: String(i['descricao']),
      realizadoEm: quando[k]!,
      feriado: feriados.has(quando[k]!.slice(0, 10)),
      urgencia,
      anestesia,
      principalId: nn(i['item_pai_id']),
      faixaId: f?.id ?? null,
      faixa: f ? `${f.codigo} (${f.percentual}%)` : null,
      acrescimoAtual: horarioAtual,
      acrescimo,
      outros,
      base,
      mudou: r2(acrescimo) !== r2(horarioAtual) || (f?.id ?? null) !== nn(i['acrescimo_horario_especial_id']),
    };
  });
}

export const esquemaFaixa = z.object({
  id: idN,
  versao: z.number().int().positive().nullable().default(null),
  fontePagadoraId: idN,
  codigo: z.string().trim().max(30),
  descricao: z.string().trim().max(150),
  tipoHorario: z.string(),
  diaSemana: z.number().int().nullable().default(null),
  aplicaFeriado: z.boolean().default(false),
  horaInicio: z.string().nullable().default(null),
  horaFim: z.string().nullable().default(null),
  percentual: z.number(),
  percentualHonorario: z.number().nullable().default(null),
  percentualCustoOperacional: z.number().nullable().default(null),
  percentualFilme: z.number().nullable().default(null),
  percentualAnestesia: z.number().nullable().default(null),
  exigeUrgencia: z.boolean().default(false),
  aplicaProcedimentosVinculados: z.boolean().default(false),
  contratoId: idN,
  vigenciaInicio: dataZ,
  vigenciaFim: dataZ.nullable().default(null),
  ativo: z.boolean().default(true),
});

export const opGravarFaixa = definirOperacao({
  nome: 'faturamento.gravar-faixa-horario-especial',
  tabelas: ['acrescimo_horario_especial'],
  entrada: esquemaFaixa,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    exigirValido(validarFaixaHorario(e));
    if (
      e.fontePagadoraId !== null &&
      !(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ?', [e.fontePagadoraId]))
    )
      throw recusa('referencia-inexistente', 'A fonte pagadora não existe.', { campos: ['fontePagadoraId'] });
    if (e.contratoId !== null) {
      const ct = await tx.uma<Linha>('SELECT fonte_pagadora_id FROM contrato_fonte_pagadora WHERE id = ?', [
        e.contratoId,
      ]);
      if (!ct || (e.fontePagadoraId !== null && n(ct['fonte_pagadora_id']) !== e.fontePagadoraId))
        throw recusa('referencia-inexistente', 'O acordo não existe ou é de outra fonte pagadora.', {
          campos: ['contratoId'],
        });
    }
    const repetido = await tx.uma<Linha>(
      'SELECT id FROM acrescimo_horario_especial WHERE estabelecimento_id = ? AND codigo = ? AND id <> ?',
      [est, e.codigo, e.id ?? 0],
    );
    if (repetido) throw recusa('duplicado', 'Já existe faixa com esse código.', { campos: ['codigo'] });
    const v = {
      fonte_pagadora_id: e.fontePagadoraId,
      contrato_fonte_pagadora_id: e.contratoId,
      codigo: e.codigo,
      descricao: e.descricao,
      tipo_horario: e.tipoHorario,
      dia_semana: e.diaSemana,
      aplica_feriado: e.aplicaFeriado,
      hora_inicio: e.horaInicio,
      hora_fim: e.horaFim,
      percentual_acrescimo: e.percentual,
      percentual_honorario: e.percentualHonorario,
      percentual_custo_operacional: e.percentualCustoOperacional,
      percentual_filme: e.percentualFilme,
      percentual_anestesia: e.percentualAnestesia,
      exige_urgencia: e.exigeUrgencia,
      aplica_procedimentos_vinculados: e.aplicaProcedimentosVinculados,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      ativo: e.ativo,
    };
    if (e.id === null)
      return { id: await tx.incluir('acrescimo_horario_especial', { estabelecimento_id: est, ...v }) };
    const r = await tx.uma<Linha>('SELECT estabelecimento_id FROM acrescimo_horario_especial WHERE id = ?', [
      e.id,
    ]);
    if (!r || n(r['estabelecimento_id']) !== est)
      throw recusa('nao-encontrado', 'A faixa não existe neste estabelecimento.', { campos: ['id'] });
    if (e.versao === null)
      throw recusa('conflito-versao', 'Informe a versão da faixa.', { campos: ['versao'] });
    await tx.alterar('acrescimo_horario_especial', e.id, e.versao, v);
    return { id: e.id };
  },
  alvo: (_e, s) => ({ tabela: 'acrescimo_horario_especial', id: s.id }),
});

export const esquemaExpediente = z.object({
  tabelaPrecoId: id,
  faixas: z
    .array(
      z.object({ diaSemana: z.number().int().min(0).max(6), horaInicio: z.string(), horaFim: z.string() }),
    )
    .max(28),
});

/** Grava o expediente da tabela num pedido só: o que sai do pedido fica inativo (não se apaga). */
export const opGravarExpediente = definirOperacao({
  nome: 'faturamento.gravar-expediente-tabela',
  tabelas: ['horario_normal_tabela'],
  entrada: esquemaExpediente,
  async gravar(tx, e) {
    if (!(await tx.uma('SELECT id FROM tabela_preco WHERE id = ?', [e.tabelaPrecoId])))
      throw recusa('referencia-inexistente', 'A tabela de preço não existe.', { campos: ['tabelaPrecoId'] });
    for (const [i, f] of e.faixas.entries())
      if (!/^\d{2}:\d{2}/.test(f.horaInicio) || !/^\d{2}:\d{2}/.test(f.horaFim) || f.horaFim <= f.horaInicio)
        throw recusa('entrada-invalida', 'O fim do expediente tem de ser depois do início.', {
          campos: [`faixas.${i}.horaFim`],
        });
    const atuais = await tx.consultarParaAtualizar(
      'SELECT id, versao, dia_semana, hora_inicio, hora_fim, ativo FROM horario_normal_tabela WHERE tabela_preco_id = ?',
      [e.tabelaPrecoId],
    );
    const chave = (d: number, h: string) => `${d}|${h.slice(0, 5)}`;
    const porChave = new Map(atuais.map((a) => [chave(n(a['dia_semana']), String(a['hora_inicio'])), a]));
    const pedidas = new Set<string>();
    let gravadas = 0;
    for (const f of e.faixas) {
      const k = chave(f.diaSemana, f.horaInicio);
      pedidas.add(k);
      const a = porChave.get(k);
      if (!a) {
        await tx.incluir('horario_normal_tabela', {
          tabela_preco_id: e.tabelaPrecoId,
          dia_semana: f.diaSemana,
          hora_inicio: f.horaInicio,
          hora_fim: f.horaFim,
        });
        gravadas++;
      } else if (!b(a['ativo']) || hora(a['hora_fim']) !== f.horaFim.slice(0, 5)) {
        await tx.alterar('horario_normal_tabela', n(a['id']), n(a['versao']), {
          hora_fim: f.horaFim,
          ativo: true,
        });
        gravadas++;
      }
    }
    let inativadas = 0;
    for (const a of atuais)
      if (b(a['ativo']) && !pedidas.has(chave(n(a['dia_semana']), String(a['hora_inicio'])))) {
        await tx.alterar('horario_normal_tabela', n(a['id']), n(a['versao']), { ativo: false });
        inativadas++;
      }
    return { id: e.tabelaPrecoId, gravadas, inativadas };
  },
  alvo: (e) => ({ tabela: 'tabela_preco', id: e.tabelaPrecoId }),
});

/** Aplica (ou retira) o acréscimo de horário especial nos itens cobrados da conta e refaz o total. */
export async function aplicarHorarioEspecialNaConta(
  tx: TxOperacao,
  est: number,
  conta: number,
  opcoes: { readonly soSeEditavel?: boolean } = {},
) {
  const c = await contaDa(tx, est, conta);
  // No lançamento do item a conta já foi conferida pela regra do lançamento: conta não editável fica como está.
  if (opcoes.soSeEditavel && !contaEditavel(c.situacao))
    return { contaId: c.id, alterados: 0, comAcrescimo: 0, total: c.valorTotal };
  exigirEditavel(c);
  const itens = await horarioDosItens(tx, est, c);
  let alterados = 0;
  for (const i of itens)
    if (i.mudou) {
      await tx.alterar('conta_hospitalar_item', i.id, i.versao, {
        horario_especial: i.faixaId !== null,
        acrescimo_horario_especial_id: i.faixaId,
        valor_acrescimo_horario: i.acrescimo,
        valor_acrescimo: r2(i.outros + i.acrescimo),
        valor_total: r2(i.base + i.acrescimo),
      });
      alterados++;
    }
  const tot = alterados ? await refazerTotal(tx, c.id) : null;
  return {
    contaId: c.id,
    alterados,
    comAcrescimo: itens.filter((i) => i.faixaId !== null).length,
    total: tot?.valor_total ?? c.valorTotal,
  };
}

export const opAplicarHorario = definirOperacao({
  nome: 'faturamento.aplicar-horario-especial',
  tabelas: ['conta_hospitalar_item', 'conta_hospitalar'],
  entrada: z.object({ contaId: id }),
  gravar: (tx, e, ctx) => aplicarHorarioEspecialNaConta(tx, estDe(ctx), e.contaId),
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.contaId }),
});

// ── Linha 18: acréscimo e desconto na conta ─────────────────────────────────────────────────────────

/** Ajustes da conta, motivos ativos, totais e a prévia do horário especial: tudo o que a tela da conta precisa. */
export async function ajustesContaPropria(l: Leitor, est: number, conta: number) {
  const c = await contaDa(l, est, conta);
  const ajustes = (
    await l.consultar<Linha>(
      `SELECT a.*, m.codigo AS motivo_codigo, m.descricao AS motivo, us.nome AS solicitante, ud.nome AS decisor
         FROM ajuste_conta a JOIN motivo_ajuste_conta m ON m.id = a.motivo_ajuste_conta_id
         LEFT JOIN usuario us ON us.id = a.solicitado_por_usuario_id
         LEFT JOIN usuario ud ON ud.id = a.decidido_por_usuario_id
        WHERE a.conta_hospitalar_id = ? AND a.excluido_em IS NULL ORDER BY a.solicitado_em DESC, a.id DESC`,
      [c.id],
    )
  ).map((a) => ({
    id: n(a['id']),
    versao: n(a['versao']),
    tipo: String(a['tipo']),
    motivoId: n(a['motivo_ajuste_conta_id']),
    motivo: `${String(a['motivo_codigo'])} - ${String(a['motivo'])}`,
    forma: String(a['forma_calculo']),
    percentual: nn(a['percentual']),
    valor: n(a['valor']),
    justificativa: String(a['justificativa']),
    situacao: String(a['situacao']),
    solicitadoEm:
      a['solicitado_em'] instanceof Date
        ? (a['solicitado_em'] as Date).toISOString()
        : String(a['solicitado_em']),
    solicitanteId: n(a['solicitado_por_usuario_id']),
    solicitante: txn(a['solicitante']),
    decisor: txn(a['decisor']),
  }));
  const motivos = (
    await l.consultar<Linha>(
      'SELECT id, codigo, descricao, tipo_ajuste, forma_aplicacao, valor_padrao, texto_padrao FROM motivo_ajuste_conta WHERE ativo = 1 ORDER BY tipo_ajuste, descricao',
      [],
    )
  ).map((m) => ({
    id: n(m['id']),
    codigo: String(m['codigo']),
    descricao: String(m['descricao']),
    tipoAjuste: String(m['tipo_ajuste']) as 'acrescimo' | 'desconto',
    forma: txn(m['forma_aplicacao']),
    valorPadrao: nn(m['valor_padrao']),
    textoPadrao: txn(m['texto_padrao']),
  }));
  return {
    contaId: c.id,
    situacao: c.situacao,
    editavel: contaEditavel(c.situacao),
    valores: {
      itens: c.valorItens,
      acrescimo: c.valorAcrescimo,
      desconto: c.valorDesconto,
      total: c.valorTotal,
    },
    reservado: {
      desconto: r2(
        ajustes
          .filter((a) => a.tipo === 'desconto' && ['aprovado', 'pendente_aprovacao'].includes(a.situacao))
          .reduce((s, a) => s + a.valor, 0),
      ),
      acrescimo: r2(
        ajustes
          .filter((a) => a.tipo === 'acrescimo' && a.situacao === 'aprovado')
          .reduce((s, a) => s + a.valor, 0),
      ),
    },
    ajustes,
    motivos,
    horario: await horarioDosItens(l, est, c),
  };
}

export const esquemaMotivoAjuste = z.object({
  codigo: z.string().trim().min(1).max(30),
  descricao: z.string().trim().min(3).max(150),
  tipoAjuste: z.enum(['acrescimo', 'desconto']),
  forma: z.enum(['percentual', 'valor']).nullable().default(null),
  valorPadrao: z.number().nonnegative().nullable().default(null),
  textoPadrao: z.string().trim().max(500).nullable().default(null),
});

export const opGravarMotivoAjuste = definirOperacao({
  nome: 'faturamento.gravar-motivo-ajuste-conta',
  tabelas: ['motivo_ajuste_conta'],
  entrada: esquemaMotivoAjuste,
  async gravar(tx, e) {
    if (await tx.uma('SELECT id FROM motivo_ajuste_conta WHERE codigo = ?', [e.codigo]))
      throw recusa('duplicado', 'Já existe motivo com esse código.', { campos: ['codigo'] });
    return {
      id: await tx.incluir('motivo_ajuste_conta', {
        codigo: e.codigo,
        descricao: e.descricao,
        tipo_ajuste: e.tipoAjuste,
        forma_aplicacao: e.forma,
        valor_padrao: e.valorPadrao,
        texto_padrao: e.textoPadrao,
      }),
    };
  },
  alvo: (_e, s) => ({ tabela: 'motivo_ajuste_conta', id: s.id }),
});

export const esquemaPedirAjuste = z.object({
  contaId: id,
  tipo: z.enum(['acrescimo', 'desconto']),
  motivoId: id,
  forma: z.enum(['valor', 'percentual']).default('valor'),
  valor: z.number().nullable().default(null),
  percentual: z.number().nullable().default(null),
  justificativa: z.string().trim().max(1000),
});

async function contextoAjuste(tx: Consulta, c: ContaLida, ignorar = 0) {
  const r = await tx.consultar<Linha>(
    `SELECT tipo, situacao, valor FROM ajuste_conta WHERE conta_hospitalar_id = ? AND excluido_em IS NULL AND id <> ?`,
    [c.id, ignorar],
  );
  const soma = (f: (a: Linha) => boolean) => r2(r.filter(f).reduce((s, a) => s + n(a['valor']), 0));
  return {
    valorItens: c.valorItens,
    descontosEmVigor: soma(
      (a) => a['tipo'] === 'desconto' && ['aprovado', 'pendente_aprovacao'].includes(String(a['situacao'])),
    ),
    acrescimosEmVigor: soma((a) => a['tipo'] === 'acrescimo' && a['situacao'] === 'aprovado'),
  };
}

/** Tipo de documento da alçada dos ajustes da conta (nativo do sistema). */
export const TIPO_APROVACAO_AJUSTE = 'ajuste_conta';

async function tipoAprovacaoAjuste(tx: TxOperacao): Promise<number> {
  const t = await tx.uma<Linha>('SELECT id FROM tipo_documento_aprovacao WHERE codigo = ?', [
    TIPO_APROVACAO_AJUSTE,
  ]);
  if (t) return n(t['id']);
  return tx.incluir('tipo_documento_aprovacao', {
    codigo: TIPO_APROVACAO_AJUSTE,
    descricao: 'Acréscimo ou desconto na conta do paciente',
    entidade: 'ajuste_conta',
    tipo_limite: 'valor',
  });
}

/** Os níveis da alçada vigente dos ajustes da conta no estabelecimento (vazio: sem alçada cadastrada). */
async function niveisDaAlcada(l: Consulta, est: number, hoje: string) {
  const r = await l.consultar<Linha>(
    `SELECT a.id AS alcada_id, a.modo_aprovacao, a.permite_autoaprovacao, nv.id, nv.nivel, nv.perfil_acesso_id,
            nv.aprovador_usuario_id, nv.valor_unitario_minimo, nv.valor_unitario_maximo, nv.obrigatorio
       FROM alcada_aprovacao a
       JOIN tipo_documento_aprovacao t ON t.id = a.tipo_documento_aprovacao_id AND t.codigo = ?
       JOIN alcada_aprovacao_nivel nv ON nv.alcada_aprovacao_id = a.id AND nv.excluido_em IS NULL
        AND (nv.vigencia_inicio IS NULL OR nv.vigencia_inicio <= ?) AND (nv.vigencia_fim IS NULL OR nv.vigencia_fim >= ?)
      WHERE a.estabelecimento_id = ? AND a.ativo = 1 AND a.vigencia_inicio <= ?
        AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= ?)
      ORDER BY a.vigencia_inicio DESC, nv.nivel, nv.sequencia`,
    [TIPO_APROVACAO_AJUSTE, hoje, hoje, est, hoje, hoje],
  );
  const alcada = r.length ? n(r[0]!['alcada_id']) : null;
  const niveis: NivelAlcadaAjuste[] = r
    .filter((x) => n(x['alcada_id']) === alcada)
    .map((x) => ({
      id: n(x['id']),
      nivel: n(x['nivel']),
      perfilId: nn(x['perfil_acesso_id']),
      usuarioId: nn(x['aprovador_usuario_id']),
      valorMinimo: n(x['valor_unitario_minimo']),
      valorMaximo: nn(x['valor_unitario_maximo']),
      obrigatorio: Boolean(Number(x['obrigatorio'])),
    }));
  const regra: RegraAlcadaAjuste = {
    modo: r[0]?.['modo_aprovacao'] === 'paralelo' ? 'paralelo' : 'serie',
    permiteAutoaprovacao: Boolean(Number(r[0]?.['permite_autoaprovacao'] ?? 0)),
  };
  return { alcada, niveis, regra };
}

const hojeIso = () => new Date().toISOString().slice(0, 10);

export const opPedirAjuste = definirOperacao({
  nome: 'faturamento.pedir-ajuste-conta',
  tabelas: ['ajuste_conta', 'pedido_aprovacao', 'tipo_documento_aprovacao'],
  entrada: esquemaPedirAjuste,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    if (ctx.usuario === null)
      throw recusa('sem-usuario', 'O ajuste exige usuário identificado.', { campos: [] });
    await travarConta(tx, est, e.contaId);
    const c = await contaDa(tx, est, e.contaId);
    exigirEditavel(c);
    const m = await tx.uma<Linha>('SELECT tipo_ajuste, ativo FROM motivo_ajuste_conta WHERE id = ?', [
      e.motivoId,
    ]);
    const { erros, valor } = validarAjusteConta(
      e,
      m ? { tipoAjuste: String(m['tipo_ajuste']) as 'acrescimo' | 'desconto', ativo: b(m['ativo']) } : null,
      await contextoAjuste(tx, c),
    );
    exigirValido(erros);
    const novo = await tx.incluir('ajuste_conta', {
      estabelecimento_id: est,
      conta_hospitalar_id: c.id,
      tipo: e.tipo,
      motivo_ajuste_conta_id: e.motivoId,
      forma_calculo: e.forma,
      percentual: e.forma === 'percentual' ? e.percentual : null,
      valor,
      justificativa: e.justificativa,
      situacao: 'pendente_aprovacao',
      solicitado_em: new Date(),
      solicitado_por_usuario_id: ctx.usuario,
    });
    // O pedido entra no mecanismo de alçada de aprovação (o mesmo dos outros documentos), com o valor.
    const { alcada } = await niveisDaAlcada(tx, est, hojeIso());
    const pedido = await tx.incluir('pedido_aprovacao', {
      estabelecimento_id: est,
      tipo_documento_aprovacao_id: await tipoAprovacaoAjuste(tx),
      alcada_aprovacao_id: alcada,
      entidade: 'ajuste_conta',
      entidade_id: novo,
      descricao: `${e.tipo === 'desconto' ? 'Desconto' : 'Acréscimo'} na conta ${c.id}`.slice(0, 500),
      valor,
      solicitante_usuario_id: ctx.usuario,
      solicitado_em: new Date(),
      situacao: 'pendente',
    });
    await tx.alterar('ajuste_conta', novo, 1, { pedido_aprovacao_id: pedido });
    return { id: novo, valor, situacao: 'pendente_aprovacao', pedidoAprovacaoId: pedido };
  },
  alvo: (_e, s) => ({ tabela: 'ajuste_conta', id: s.id }),
  trilha: (e) => ({ motivo: e.justificativa }),
});

export const esquemaDecidirAjuste = z.object({
  id,
  versao: z.number().int().positive(),
  decisao: z.enum(['aprovar', 'recusar', 'cancelar']),
  observacao: z.string().trim().max(500).nullable().default(null),
});

export const opDecidirAjuste = definirOperacao({
  nome: 'faturamento.decidir-ajuste-conta',
  tabelas: ['ajuste_conta', 'conta_hospitalar', 'pedido_aprovacao', 'decisao_aprovacao'],
  entrada: esquemaDecidirAjuste,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const a = await tx.uma<Linha>(
      'SELECT * FROM ajuste_conta WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.id, est],
    );
    if (!a) throw recusa('nao-encontrado', 'O ajuste não existe neste estabelecimento.', { campos: ['id'] });
    await travarConta(tx, est, n(a['conta_hospitalar_id']));
    const hoje = hojeIso();
    const pedido = nn(a['pedido_aprovacao_id']);
    // A regra da alçada vale pelo pedido (a vigente quando foi pedido); sem pedido, pela vigente hoje.
    const { niveis, regra } = await niveisDaAlcada(tx, est, hoje);
    const motivo = conferirDecisaoAjuste(
      String(a['situacao']) as SituacaoAjuste,
      n(a['solicitado_por_usuario_id']),
      ctx.usuario,
      e.decisao,
      niveis.length > 0 && regra.permiteAutoaprovacao,
    );
    if (motivo) throw recusa('alcada', motivo, { campos: ['decisao'] });
    if (e.decisao === 'recusar' && !e.observacao)
      throw recusa('entrada-invalida', 'Diga por que o ajuste foi recusado.', { campos: ['observacao'] });
    const c = await contaDa(tx, est, n(a['conta_hospitalar_id']));
    exigirEditavel(c);
    if (e.decisao === 'aprovar' && a['tipo'] === 'desconto') {
      const cx = await contextoAjuste(tx, c, e.id);
      if (r2(cx.descontosEmVigor + n(a['valor'])) > r2(c.valorItens + cx.acrescimosEmVigor))
        throw recusa('entrada-invalida', 'O desconto passa do valor atual da conta.', {
          campos: ['decisao'],
        });
    }
    // Alçada por valor: com pedido no mecanismo, os níveis cuja faixa contém o valor aprovam um após o outro (série)
    // ou em qualquer ordem (paralelo), cada um por uma pessoa; o ajuste só muda o total no último. Sem pedido (pedido
    // antes de haver alçada), basta um nível que cubra o valor.
    let nivel: NivelAlcadaAjuste | null = null;
    let faltam: readonly number[] = [];
    if (e.decisao === 'aprovar') {
      const perfis = niveis.length
        ? (
            await tx.consultar<Linha>(
              `SELECT perfil_acesso_id FROM usuario_perfil WHERE usuario_id = ? AND estabelecimento_id = ?
                  AND excluido_em IS NULL AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
              [ctx.usuario, est, hoje, hoje],
            )
          ).map((x) => n(x['perfil_acesso_id']))
        : [];
      if (pedido !== null) {
        const aprovacoes = (
          await tx.consultar<Linha>(
            `SELECT nivel, aprovador_usuario_id FROM decisao_aprovacao
              WHERE pedido_aprovacao_id = ? AND decisao = 'aprovado'`,
            [pedido],
          )
        ).map((x) => ({ nivel: n(x['nivel']), usuarioId: n(x['aprovador_usuario_id']) }));
        const et = etapaDaAlcada(n(a['valor']), niveis, regra, aprovacoes, ctx.usuario!, perfis);
        if (et.motivo) throw recusa('alcada', et.motivo, { campos: ['decisao'] });
        nivel = et.nivel;
        if (!et.conclui) faltam = et.faltam.filter((x) => x !== et.nivel?.nivel);
      } else {
        const al = conferirAlcadaDoValor(n(a['valor']), niveis, ctx.usuario!, perfis);
        if (al.motivo) throw recusa('alcada', al.motivo, { campos: ['decisao'] });
        nivel = al.nivel;
      }
    }
    if (faltam.length && pedido !== null) {
      // Aprovação de um nível intermediário: grava a decisão do nível e avança o pedido; o ajuste segue pendente.
      const pv = await tx.consultarParaAtualizar('SELECT versao FROM pedido_aprovacao WHERE id = ?', [
        pedido,
      ]);
      await tx.incluir('decisao_aprovacao', {
        pedido_aprovacao_id: pedido,
        alcada_aprovacao_nivel_id: nivel?.id ?? null,
        nivel: nivel?.nivel ?? 1,
        aprovador_usuario_id: ctx.usuario,
        decisao: 'aprovado',
        justificativa: e.observacao,
        valor_aprovado: n(a['valor']),
        ocorrido_em: new Date(),
      });
      const proximo = niveis.find((x) => x.nivel === faltam[0]) ?? null;
      await tx.alterar('pedido_aprovacao', pedido, n(pv[0]?.['versao']), {
        nivel_atual: faltam[0],
        alcada_aprovacao_nivel_id: proximo?.id ?? null,
      });
      return {
        id: e.id,
        situacao: 'pendente_aprovacao',
        total: c.valorTotal,
        avisos: `Aprovado no nível ${nivel?.nivel ?? 1}; falta o nível ${faltam.join(', ')} da alçada.`,
      };
    }
    const situacao =
      e.decisao === 'aprovar' ? 'aprovado' : e.decisao === 'recusar' ? 'recusado' : 'cancelado';
    await tx.alterar('ajuste_conta', e.id, e.versao, {
      situacao,
      ...(e.decisao === 'cancelar' ? {} : { decidido_em: new Date(), decidido_por_usuario_id: ctx.usuario }),
    });
    if (pedido !== null) {
      const pv = await tx.consultarParaAtualizar('SELECT versao FROM pedido_aprovacao WHERE id = ?', [
        pedido,
      ]);
      if (e.decisao !== 'cancelar')
        await tx.incluir('decisao_aprovacao', {
          pedido_aprovacao_id: pedido,
          alcada_aprovacao_nivel_id: nivel?.id ?? null,
          nivel: nivel?.nivel ?? 1,
          aprovador_usuario_id: ctx.usuario,
          decisao: e.decisao === 'aprovar' ? 'aprovado' : 'recusado',
          justificativa: e.observacao,
          valor_aprovado: e.decisao === 'aprovar' ? n(a['valor']) : null,
          ocorrido_em: new Date(),
        });
      await tx.alterar('pedido_aprovacao', pedido, n(pv[0]?.['versao']), {
        situacao: e.decisao === 'aprovar' ? 'aprovado' : e.decisao === 'recusar' ? 'reprovado' : 'cancelado',
        concluido_em: new Date(),
        motivo_conclusao: e.observacao,
      });
    }
    const tot =
      e.decisao === 'aprovar'
        ? await refazerTotal(
            tx,
            c.id,
            a['tipo'] === 'desconto'
              ? { acrescimo: 0, desconto: n(a['valor']) }
              : { acrescimo: n(a['valor']), desconto: 0 },
          )
        : null;
    return { id: e.id, situacao, total: tot?.valor_total ?? c.valorTotal };
  },
  alvo: (e) => ({ tabela: 'ajuste_conta', id: e.id }),
  trilha: (e) => ({ motivo: `${e.decisao}${e.observacao ? `: ${e.observacao}` : ''}` }),
});

// ── Linha 20: pacote na conta ──────────────────────────────────────────────────────────────────────

async function versoesDo(
  l: Consulta,
  pacote: number,
): Promise<(VersaoPacote & { quantidadeDiarias: number | null; dados: unknown })[]> {
  return (
    await l.consultar<Linha>(
      'SELECT id, numero_versao, vigencia_inicio, vigencia_fim, valor, quantidade_diarias, dados FROM pacote_versao WHERE pacote_id = ? ORDER BY numero_versao',
      [pacote],
    )
  ).map((v) => ({
    id: n(v['id']),
    numero: n(v['numero_versao']),
    vigenciaInicio: dataIso(v['vigencia_inicio'])!,
    vigenciaFim: dataIso(v['vigencia_fim']),
    valor: nn(v['valor']),
    quantidadeDiarias: nn(v['quantidade_diarias']),
    dados: v['dados'] ?? null,
  }));
}

/** A composição que governa a conta: o retrato da versão encerrada ou a composição atual da versão aberta. */
async function composicaoParaConta(
  l: Consulta,
  pacote: number,
  versao: (VersaoPacote & { dados: unknown }) | null | undefined,
) {
  return composicaoDaVersao(versao ?? null, versao?.dados ?? null, await composicaoDo(l, pacote));
}

const adicionalDe = (d: { diariaItemId: number | null; valorDiariaAdicional: number | null } | undefined) =>
  d ? { itemId: d.diariaItemId, valor: d.valorDiariaAdicional } : null;

async function composicaoDo(l: Consulta, pacote: number) {
  const inclusoes = (
    await l.consultar<Linha>('SELECT * FROM pacote_item_incluso WHERE pacote_id = ? ORDER BY sequencia', [
      pacote,
    ])
  ).map((r) => ({
    itemId: nn(r['item_faturavel_id']),
    grupoId: nn(r['grupo_faturamento_id']),
    setorId: nn(r['setor_funcional_id']),
    quantidadeLimite: nn(r['quantidade_limite']),
  }));
  const excecoes = (
    await l.consultar<Linha>(
      'SELECT * FROM pacote_excecao WHERE pacote_id = ? AND excluido_em IS NULL ORDER BY sequencia',
      [pacote],
    )
  ).map((r) => ({
    id: n(r['id']),
    versao: n(r['versao']),
    itemId: nn(r['item_faturavel_id']),
    grupoId: nn(r['grupo_faturamento_id']),
    setorId: nn(r['setor_funcional_id']),
    categoriaAcomodacaoId: nn(r['categoria_acomodacao_id']),
    efeito: String(r['efeito']) as 'cobrar_a_parte' | 'descaracteriza',
  }));
  const tetos = (
    await l.consultar<Linha>('SELECT * FROM pacote_teto WHERE pacote_id = ? AND ativo = 1', [pacote])
  ).map((r) => ({
    id: n(r['id']),
    versao: n(r['versao']),
    grupoId: nn(r['grupo_faturamento_id']),
    diasTeto: nn(r['dias_teto']),
    quantidadeTeto: nn(r['quantidade_teto']),
    valorTeto: nn(r['valor_teto']),
    descaracteriza: b(r['descaracteriza']),
  }));
  const diarias = (
    await l.consultar<Linha>('SELECT * FROM pacote_diaria_acomodacao WHERE pacote_id = ?', [pacote])
  ).map((r) => ({
    id: n(r['id']),
    versao: n(r['versao']),
    categoriaAcomodacaoId: n(r['categoria_acomodacao_id']),
    quantidadeDiarias: n(r['quantidade_diarias']),
    diariaItemId: nn(r['diaria_item_faturavel_id']),
    valorDiariaAdicional: nn(r['valor_diaria_adicional']),
  }));
  return { inclusoes, excecoes, tetos, diarias };
}

/** Versões e composição do pacote (cadastro). */
export async function pacoteComposicaoPropria(l: Leitor, pacote: number) {
  const p = await l.uma<Linha>(
    'SELECT id, codigo, descricao, valor, quantidade_diarias, situacao, versao FROM pacote WHERE id = ? AND excluido_em IS NULL',
    [pacote],
  );
  if (!p) throw recusa('nao-encontrado', 'O pacote não existe.', { campos: ['pacoteId'] });
  return {
    id: n(p['id']),
    codigo: String(p['codigo']),
    descricao: String(p['descricao']),
    valor: nn(p['valor']),
    quantidadeDiarias: nn(p['quantidade_diarias']),
    situacao: String(p['situacao']),
    versoes: await versoesDo(l, pacote),
    ...(await composicaoDo(l, pacote)),
  };
}

export const esquemaVersaoPacote = z.object({
  pacoteId: id,
  vigenciaInicio: dataZ,
  valor: z.number().nonnegative().nullable().default(null),
  quantidadeDiarias: z.number().int().nonnegative().nullable().default(null),
  percentualLimiteOpme: z.number().nonnegative().nullable().default(null),
});

/** Nova versão do pacote: fecha a anterior na véspera e guarda o retrato da composição. */
export const opVersionarPacote = definirOperacao({
  nome: 'faturamento.versionar-pacote',
  tabelas: ['pacote_versao', 'pacote'],
  entrada: esquemaVersaoPacote,
  async gravar(tx, e, ctx) {
    const p = await tx.consultarParaAtualizar(
      'SELECT id, versao FROM pacote WHERE id = ? AND excluido_em IS NULL',
      [e.pacoteId],
    );
    if (!p.length) throw recusa('nao-encontrado', 'O pacote não existe.', { campos: ['pacoteId'] });
    const versoes = await versoesDo(tx, e.pacoteId);
    exigirValido(validarNovaVersao(versoes, e.vigenciaInicio, e.valor));
    const ultima = versoes[versoes.length - 1];
    if (ultima && (ultima.vigenciaFim === null || ultima.vigenciaFim >= e.vigenciaInicio)) {
      const vv = await tx.uma<Linha>('SELECT versao FROM pacote_versao WHERE id = ?', [ultima.id]);
      // Ao encerrar, a versão guarda o retrato da composição em que vigorou: contas da época seguem por ele.
      await tx.alterar('pacote_versao', ultima.id, n(vv?.['versao']), {
        vigencia_fim: vespera(e.vigenciaInicio),
        dados: JSON.stringify(await composicaoDo(tx, e.pacoteId)),
      });
    }
    const numero = (ultima?.numero ?? 0) + 1;
    const novo = await tx.incluir('pacote_versao', {
      pacote_id: e.pacoteId,
      operacao: ultima ? 'alteracao' : 'inclusao',
      dados: JSON.stringify(await composicaoDo(tx, e.pacoteId)),
      ocorrido_em: new Date(),
      usuario_id: ctx.usuario,
      numero_versao: numero,
      vigencia_inicio: e.vigenciaInicio,
      valor: e.valor,
      quantidade_diarias: e.quantidadeDiarias,
      percentual_limite_opme: e.percentualLimiteOpme,
    });
    await tx.alterar('pacote', e.pacoteId, n(p[0]!['versao']), {
      valor: e.valor,
      quantidade_diarias: e.quantidadeDiarias,
      percentual_limite_opme: e.percentualLimiteOpme,
    });
    return { id: novo, numero };
  },
  alvo: (_e, s) => ({ tabela: 'pacote_versao', id: s.id }),
});

const alvoZ = { itemId: idN, grupoId: idN, setorId: idN };
export const esquemaComposicao = z.object({
  pacoteId: id,
  excecoes: z
    .array(
      z.object({
        ...alvoZ,
        categoriaAcomodacaoId: idN,
        efeito: z.enum(['cobrar_a_parte', 'descaracteriza']),
      }),
    )
    .max(200),
  tetos: z
    .array(
      z.object({
        grupoId: idN,
        diasTeto: z.number().int().positive().nullable().default(null),
        quantidadeTeto: z.number().positive().nullable().default(null),
        valorTeto: z.number().nonnegative().nullable().default(null),
        descaracteriza: z.boolean().default(true),
      }),
    )
    .max(50),
  diarias: z
    .array(
      z.object({
        categoriaAcomodacaoId: id,
        quantidadeDiarias: z.number().int().nonnegative(),
        diariaItemId: idN,
        valorDiariaAdicional: z.number().nonnegative().nullable().default(null),
      }),
    )
    .max(20),
});

/** Exceções, tetos e diárias por acomodação num pedido só. O que sai do pedido fica marcado (não se apaga). */
export const opGravarComposicao = definirOperacao({
  nome: 'faturamento.gravar-composicao-pacote',
  tabelas: ['pacote_excecao', 'pacote_teto', 'pacote_diaria_acomodacao'],
  entrada: esquemaComposicao,
  async gravar(tx, e) {
    if (!(await tx.uma('SELECT id FROM pacote WHERE id = ? AND excluido_em IS NULL', [e.pacoteId])))
      throw recusa('nao-encontrado', 'O pacote não existe.', { campos: ['pacoteId'] });
    for (const [i, x] of e.excecoes.entries())
      if (x.itemId === null && x.grupoId === null)
        throw recusa('entrada-invalida', 'A exceção precisa do item ou do grupo.', {
          campos: [`excecoes.${i}.itemId`],
        });
    for (const [i, t] of e.tetos.entries())
      if (t.diasTeto === null && t.quantidadeTeto === null && t.valorTeto === null)
        throw recusa('entrada-invalida', 'O teto precisa de dias, quantidade ou valor.', {
          campos: [`tetos.${i}.valorTeto`],
        });
    const grupos = new Set<string>();
    for (const [i, t] of e.tetos.entries()) {
      if (grupos.has(String(t.grupoId)))
        throw recusa('duplicado', 'Teto repetido para o mesmo grupo.', { campos: [`tetos.${i}.grupoId`] });
      grupos.add(String(t.grupoId));
    }
    // Exceções: casa pelo alvo; a que sai fica marcada como excluída.
    const ex = await tx.consultarParaAtualizar('SELECT * FROM pacote_excecao WHERE pacote_id = ?', [
      e.pacoteId,
    ]);
    const k = (r: {
      itemId: number | null;
      grupoId: number | null;
      setorId: number | null;
      categoriaAcomodacaoId: number | null;
    }) => [r.itemId, r.grupoId, r.setorId, r.categoriaAcomodacaoId].join('|');
    const kDe = (r: Linha) =>
      k({
        itemId: nn(r['item_faturavel_id']),
        grupoId: nn(r['grupo_faturamento_id']),
        setorId: nn(r['setor_funcional_id']),
        categoriaAcomodacaoId: nn(r['categoria_acomodacao_id']),
      });
    const exPor = new Map(ex.map((r) => [kDe(r), r]));
    let seq = ex.reduce((m, r) => Math.max(m, n(r['sequencia'])), 0);
    const pedidas = new Set<string>();
    for (const x of e.excecoes) {
      const kk = k(x);
      pedidas.add(kk);
      const a = exPor.get(kk);
      if (!a)
        await tx.incluir('pacote_excecao', {
          pacote_id: e.pacoteId,
          sequencia: ++seq,
          item_faturavel_id: x.itemId,
          grupo_faturamento_id: x.grupoId,
          setor_funcional_id: x.setorId,
          categoria_acomodacao_id: x.categoriaAcomodacaoId,
          efeito: x.efeito,
        });
      else if (a['excluido_em'] !== null || a['efeito'] !== x.efeito)
        await tx.alterar('pacote_excecao', n(a['id']), n(a['versao']), {
          efeito: x.efeito,
          excluido_em: null,
          excluido_por: null,
        });
    }
    for (const a of ex)
      if (a['excluido_em'] === null && !pedidas.has(kDe(a)))
        await tx.excluir('pacote_excecao', n(a['id']), n(a['versao']));
    // Tetos: um por grupo (nulo = geral); o que sai fica inativo.
    const te = await tx.consultarParaAtualizar('SELECT * FROM pacote_teto WHERE pacote_id = ?', [e.pacoteId]);
    const tePor = new Map(te.map((r) => [String(nn(r['grupo_faturamento_id'])), r]));
    for (const t of e.tetos) {
      const v = {
        dias_teto: t.diasTeto,
        quantidade_teto: t.quantidadeTeto,
        valor_teto: t.valorTeto,
        descaracteriza: t.descaracteriza,
        ativo: true,
      };
      const a = tePor.get(String(t.grupoId));
      if (!a)
        await tx.incluir('pacote_teto', { pacote_id: e.pacoteId, grupo_faturamento_id: t.grupoId, ...v });
      else await tx.alterar('pacote_teto', n(a['id']), n(a['versao']), v);
    }
    for (const a of te)
      if (b(a['ativo']) && !grupos.has(String(nn(a['grupo_faturamento_id']))))
        await tx.alterar('pacote_teto', n(a['id']), n(a['versao']), { ativo: false });
    // Diárias por acomodação: uma por categoria.
    const di = await tx.consultarParaAtualizar('SELECT * FROM pacote_diaria_acomodacao WHERE pacote_id = ?', [
      e.pacoteId,
    ]);
    const diPor = new Map(di.map((r) => [n(r['categoria_acomodacao_id']), r]));
    for (const d of e.diarias) {
      const v = {
        quantidade_diarias: d.quantidadeDiarias,
        diaria_item_faturavel_id: d.diariaItemId,
        valor_diaria_adicional: d.valorDiariaAdicional,
      };
      const a = diPor.get(d.categoriaAcomodacaoId);
      if (!a)
        await tx.incluir('pacote_diaria_acomodacao', {
          pacote_id: e.pacoteId,
          categoria_acomodacao_id: d.categoriaAcomodacaoId,
          ...v,
        });
      else await tx.alterar('pacote_diaria_acomodacao', n(a['id']), n(a['versao']), v);
    }
    return { id: e.pacoteId, excecoes: e.excecoes.length, tetos: e.tetos.length, diarias: e.diarias.length };
  },
  alvo: (e) => ({ tabela: 'pacote', id: e.pacoteId }),
});

async function itensParaPacote(l: Consulta, conta: number, cp: number | null) {
  const r = await l.consultar<Linha>(
    `SELECT id, versao, item_faturavel_id, grupo_faturamento_id, setor_funcional_id, quantidade, valor_total, situacao,
            conta_hospitalar_pacote_id
       FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND excluido_em IS NULL AND tipo_valorizacao <> 'pacote'
        AND (situacao IN ('lancado','conferido') OR (situacao = 'sem_cobranca' AND conta_hospitalar_pacote_id = ?))
      ORDER BY id`,
    [conta, cp ?? 0],
  );
  return r.map((i) => ({
    id: n(i['id']),
    versao: n(i['versao']),
    itemId: n(i['item_faturavel_id']),
    grupoId: nn(i['grupo_faturamento_id']),
    setorId: nn(i['setor_funcional_id']),
    quantidade: n(i['quantidade']),
    valor: n(i['valor_total']),
    situacao: String(i['situacao']),
  }));
}

/** O preço do pacote para a conta: acordo da fonte (plano e acomodação) vigente, senão a versão, senão o padrão. */
async function precoDoPacote(
  l: Consulta,
  pacote: Linha,
  c: ContaLida,
  data: string,
  versao: VersaoPacote | null,
) {
  const acordo = await l.uma<Linha>(
    `SELECT valor FROM pacote_contrato WHERE pacote_id = ? AND fonte_pagadora_id = ? AND excluido_em IS NULL
        AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND valor IS NOT NULL
        AND (plano_fonte_pagadora_id IS NULL OR plano_fonte_pagadora_id = ?)
        AND (categoria_acomodacao_id IS NULL OR categoria_acomodacao_id = ?)
      ORDER BY plano_fonte_pagadora_id IS NULL, categoria_acomodacao_id IS NULL, vigencia_inicio DESC LIMIT 1`,
    [n(pacote['id']), c.fonte, data, data, c.plano ?? 0, c.acomodacao ?? 0],
  );
  if (acordo) return { valor: n(acordo['valor']), origem: 'acordo' as const };
  if (versao?.valor != null) return { valor: versao.valor, origem: 'versao' as const };
  if (pacote['valor'] !== null) return { valor: n(pacote['valor']), origem: 'padrao' as const };
  return null;
}

/** Pacotes da conta (aplicados, com a classificação e os alertas) e os que a fonte da conta aceita. */
export async function pacotesContaPropria(l: Leitor, est: number, conta: number) {
  const c = await contaDa(l, est, conta);
  const data = dataIso(c.inicio)!;
  const aplicados = await l.consultar<Linha>(
    `SELECT cp.*, p.codigo, p.descricao, pv.numero_versao, d.descaracterizado_em, d.justificativa,
            md.descricao AS motivo_descaracterizacao
       FROM conta_hospitalar_pacote cp JOIN pacote p ON p.id = cp.pacote_id
       LEFT JOIN pacote_versao pv ON pv.id = cp.pacote_versao_id
       LEFT JOIN descaracterizacao_pacote d ON d.id = cp.descaracterizacao_pacote_id
       LEFT JOIN motivo_descaracterizacao_pacote md ON md.id = d.motivo_descaracterizacao_pacote_id
      WHERE cp.conta_hospitalar_id = ? AND cp.excluido_em IS NULL ORDER BY cp.id`,
    [c.id],
  );
  const dias = diasDePermanenciaPacote(data, dataIso(c.fim) ?? new Date().toISOString().slice(0, 10));
  const lidos = [];
  for (const a of aplicados) {
    const ativo = a['descaracterizacao_pacote_id'] === null;
    const versao =
      a['pacote_versao_id'] === null
        ? null
        : (await versoesDo(l, n(a['pacote_id']))).find((v) => v.id === n(a['pacote_versao_id']));
    const comp = await composicaoParaConta(l, n(a['pacote_id']), versao);
    const itens = ativo ? await itensParaPacote(l, c.id, n(a['id'])) : [];
    const classes = classificarItens(itens, comp.inclusoes, comp.excecoes, c.acomodacao);
    const daAcomodacao = comp.diarias.find((d) => d.categoriaAcomodacaoId === c.acomodacao);
    const diarias = daAcomodacao?.quantidadeDiarias ?? versao?.quantidadeDiarias ?? null;
    lidos.push({
      id: n(a['id']),
      versao: n(a['versao']),
      pacoteId: n(a['pacote_id']),
      pacote: `${String(a['codigo'])} - ${String(a['descricao'])}`,
      numeroVersao: nn(a['numero_versao']),
      valorCobrado: n(a['valor_cobrado']),
      ativo,
      descaracterizacao: ativo
        ? null
        : {
            em: a['descaracterizado_em'],
            motivo: txn(a['motivo_descaracterizacao']),
            justificativa: txn(a['justificativa']),
          },
      inclusos: itens.filter((i) => classes.get(i.id) === 'incluso').length,
      aParte: itens.filter((i) => classes.get(i.id) === 'a_parte').length,
      alertas: ativo
        ? alertasDoPacote(
            itens as ItemParaPacote[],
            classes,
            comp.tetos,
            dias,
            diarias,
            adicionalDe(daAcomodacao),
          )
        : [],
    });
  }
  const candidatos = (
    await l.consultar<Linha>(
      `SELECT DISTINCT p.id, p.codigo, p.descricao, p.valor FROM pacote p
         LEFT JOIN pacote_contrato pc ON pc.pacote_id = p.id AND pc.excluido_em IS NULL
        WHERE p.excluido_em IS NULL AND p.situacao = 'ativo' AND (p.estabelecimento_id IS NULL OR p.estabelecimento_id = ?)
          AND p.vigencia_inicio <= ? AND (p.vigencia_fim IS NULL OR p.vigencia_fim >= ?)
          AND (pc.fonte_pagadora_id = ? OR NOT EXISTS (SELECT 1 FROM pacote_contrato x WHERE x.pacote_id = p.id AND x.excluido_em IS NULL))
        ORDER BY p.descricao LIMIT 200`,
      [est, data, data, c.fonte],
    )
  ).map((p) => ({ id: n(p['id']), codigo: String(p['codigo']), descricao: String(p['descricao']) }));
  const motivos = (
    await l.consultar<Linha>(
      'SELECT id, codigo, descricao, tipo_motivo FROM motivo_descaracterizacao_pacote WHERE ativo = 1 ORDER BY descricao',
      [],
    )
  ).map((m) => ({
    id: n(m['id']),
    codigo: String(m['codigo']),
    descricao: String(m['descricao']),
    tipo: String(m['tipo_motivo']),
  }));
  return {
    contaId: c.id,
    situacao: c.situacao,
    editavel: contaEditavel(c.situacao),
    dias,
    aplicados: lidos,
    candidatos,
    motivos,
  };
}

export const opAplicarPacote = definirOperacao({
  nome: 'faturamento.aplicar-pacote-conta',
  tabelas: ['conta_hospitalar_pacote', 'conta_hospitalar_item', 'conta_hospitalar'],
  entrada: z.object({ contaId: id, pacoteId: id }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    await travarConta(tx, est, e.contaId);
    const c = await contaDa(tx, est, e.contaId);
    exigirEditavel(c);
    const data = dataIso(c.inicio)!;
    const p = await tx.uma<Linha>(
      `SELECT * FROM pacote WHERE id = ? AND excluido_em IS NULL AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
      [e.pacoteId, est],
    );
    if (!p) throw recusa('nao-encontrado', 'O pacote não existe.', { campos: ['pacoteId'] });
    if (
      p['situacao'] !== 'ativo' ||
      dataIso(p['vigencia_inicio'])! > data ||
      (p['vigencia_fim'] !== null && dataIso(p['vigencia_fim'])! < data)
    )
      throw recusa('pacote-fora-de-vigencia', 'O pacote não está ativo na data de início da conta.', {
        campos: ['pacoteId'],
      });
    const cp = await tx.uma<Linha>(
      'SELECT id, descaracterizacao_pacote_id FROM conta_hospitalar_pacote WHERE conta_hospitalar_id = ? AND pacote_id = ? AND recem_nascido = 0 AND excluido_em IS NULL',
      [c.id, e.pacoteId],
    );
    if (cp && cp['descaracterizacao_pacote_id'] !== null)
      throw recusa(
        'pacote-descaracterizado',
        'O pacote já foi descaracterizado nesta conta: a cobrança segue aberta.',
        { campos: ['pacoteId'] },
      );
    const versoes = await versoesDo(tx, e.pacoteId);
    const vigente = versaoVigente(versoes, data);
    const versao = vigente ? (versoes.find((v) => v.id === vigente.id) ?? null) : null;
    let cpId: number;
    let valor = 0;
    if (!cp) {
      const preco = await precoDoPacote(tx, p, c, data, versao);
      if (!preco)
        throw recusa(
          'pacote-sem-preco',
          'O pacote não tem preço para esta fonte pagadora nem preço padrão.',
          { campos: ['pacoteId'] },
        );
      valor = preco.valor;
      cpId = await tx.incluir('conta_hospitalar_pacote', {
        conta_hospitalar_id: c.id,
        pacote_id: e.pacoteId,
        pacote_versao_id: versao?.id ?? null,
        principal: !(await tx.uma(
          'SELECT id FROM conta_hospitalar_pacote WHERE conta_hospitalar_id = ? AND excluido_em IS NULL',
          [c.id],
        )),
        valor_cobrado: valor,
        aplicado_em: new Date(),
      });
      const seq = await tx.uma<Linha>(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
        [c.id],
      );
      const cobranca = await tx.uma<Linha>('SELECT grupo_faturamento_id FROM item_faturavel WHERE id = ?', [
        n(p['cobranca_item_faturavel_id']),
      ]);
      await tx.incluir('conta_hospitalar_item', {
        conta_hospitalar_id: c.id,
        sequencia: n(seq?.['s']),
        item_faturavel_id: n(p['cobranca_item_faturavel_id']),
        grupo_faturamento_id: cobranca?.['grupo_faturamento_id'] ?? null,
        realizado_em: c.inicio,
        quantidade: 1,
        valor_unitario: valor,
        valor_total: valor,
        tipo_valorizacao: 'pacote',
        pertence_pacote: true,
        conta_hospitalar_pacote_id: cpId,
        situacao: 'lancado',
        observacao: `Pacote ${String(p['codigo'])}${versao ? ` versão ${versao.numero}` : ''} (preço do ${preco.origem}).`,
      });
    } else cpId = n(cp['id']);
    // Classifica os itens já lançados: o incluso fica na conta sem cobrança, ligado ao pacote; o resto segue cobrado.
    const comp = await composicaoParaConta(tx, e.pacoteId, versao);
    const itens = await itensParaPacote(tx, c.id, cpId);
    const classes = classificarItens(itens, comp.inclusoes, comp.excecoes, c.acomodacao);
    let inclusos = 0;
    for (const i of itens) {
      const inc = classes.get(i.id) === 'incluso';
      if (inc && i.situacao !== 'sem_cobranca') {
        await tx.alterar('conta_hospitalar_item', i.id, i.versao, {
          pertence_pacote: true,
          conta_hospitalar_pacote_id: cpId,
          situacao: 'sem_cobranca',
        });
        inclusos++;
      } else if (!inc && i.situacao === 'sem_cobranca')
        await tx.alterar('conta_hospitalar_item', i.id, i.versao, {
          pertence_pacote: false,
          conta_hospitalar_pacote_id: null,
          situacao: 'lancado',
        });
    }
    const tot = await refazerTotal(tx, c.id);
    const dias = diasDePermanenciaPacote(data, dataIso(c.fim) ?? new Date().toISOString().slice(0, 10));
    const daAcomodacao = comp.diarias.find((d) => d.categoriaAcomodacaoId === c.acomodacao);
    const diarias =
      daAcomodacao?.quantidadeDiarias ?? versao?.quantidadeDiarias ?? nn(p['quantidade_diarias']);
    // O resultado da operação é plano (vai à trilha): os alertas seguem como texto; a tela lê o detalhe pela leitura.
    const alertas = alertasDoPacote(itens, classes, comp.tetos, dias, diarias, adicionalDe(daAcomodacao));
    return {
      id: cpId,
      valor: valor || null,
      inclusos,
      total: tot.valor_total,
      alertas: alertas.length,
      descaracterizaPorAlerta: alertas.some((a) => a.descaracteriza),
      avisos: alertas.map((a) => a.mensagem).join(' '),
    };
  },
  alvo: (_e, s) => ({ tabela: 'conta_hospitalar_pacote', id: s.id }),
});

export const esquemaMotivoDescaracterizacao = z.object({
  codigo: z.string().trim().min(1).max(30),
  descricao: z.string().trim().min(3).max(150),
  tipo: z.enum(['intercorrencia', 'permanencia', 'item_extra', 'diagnostico', 'obito', 'outro']),
});
export const opGravarMotivoDescaracterizacao = definirOperacao({
  nome: 'faturamento.gravar-motivo-descaracterizacao',
  tabelas: ['motivo_descaracterizacao_pacote'],
  entrada: esquemaMotivoDescaracterizacao,
  async gravar(tx, e) {
    if (await tx.uma('SELECT id FROM motivo_descaracterizacao_pacote WHERE codigo = ?', [e.codigo]))
      throw recusa('duplicado', 'Já existe motivo com esse código.', { campos: ['codigo'] });
    return {
      id: await tx.incluir('motivo_descaracterizacao_pacote', {
        codigo: e.codigo,
        descricao: e.descricao,
        tipo_motivo: e.tipo,
      }),
    };
  },
  alvo: (_e, s) => ({ tabela: 'motivo_descaracterizacao_pacote', id: s.id }),
});

export const esquemaDescaracterizar = z.object({
  id,
  versao: z.number().int().positive(),
  motivoId: id,
  justificativa: z.string().trim().min(10, 'Justifique (ao menos 10 letras).').max(1000),
});

/** Descaracteriza o pacote da conta: os inclusos voltam a ser cobrados e o item do pacote fica estornado. */
export const opDescaracterizar = definirOperacao({
  nome: 'faturamento.descaracterizar-pacote',
  tabelas: [
    'descaracterizacao_pacote',
    'conta_hospitalar_pacote',
    'conta_hospitalar_item',
    'conta_hospitalar',
  ],
  entrada: esquemaDescaracterizar,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    if (ctx.usuario === null)
      throw recusa('sem-usuario', 'A descaracterização exige usuário identificado.', { campos: [] });
    // Só o pacote de conta do estabelecimento da sessão: a conta alheia nem é travada.
    const cp = await tx.uma<Linha>(
      `SELECT cp.* FROM conta_hospitalar_pacote cp JOIN conta_hospitalar c ON c.id = cp.conta_hospitalar_id
        WHERE cp.id = ? AND cp.excluido_em IS NULL AND c.estabelecimento_id = ?`,
      [e.id, est],
    );
    if (!cp) throw recusa('nao-encontrado', 'O pacote não está nesta conta.', { campos: ['id'] });
    await travarConta(tx, est, n(cp['conta_hospitalar_id']));
    const c = await contaDa(tx, est, n(cp['conta_hospitalar_id']));
    exigirEditavel(c);
    if (cp['descaracterizacao_pacote_id'] !== null)
      throw recusa('pacote-descaracterizado', 'O pacote já foi descaracterizado.', { campos: ['id'] });
    const m = await tx.uma<Linha>(
      'SELECT descricao, ativo FROM motivo_descaracterizacao_pacote WHERE id = ?',
      [e.motivoId],
    );
    if (!m || !b(m['ativo']))
      throw recusa('entrada-invalida', 'Escolha um motivo ativo.', { campos: ['motivoId'] });
    const d = await tx.incluir('descaracterizacao_pacote', {
      estabelecimento_id: est,
      conta_hospitalar_id: c.id,
      conta_hospitalar_pacote_id: e.id,
      pacote_id: n(cp['pacote_id']),
      motivo_descaracterizacao_pacote_id: e.motivoId,
      justificativa: e.justificativa,
      descaracterizado_em: new Date(),
      usuario_id: ctx.usuario,
    });
    await tx.alterar('conta_hospitalar_pacote', e.id, e.versao, { descaracterizacao_pacote_id: d });
    const itens = await tx.consultar<Linha>(
      'SELECT id, versao, tipo_valorizacao, situacao, observacao FROM conta_hospitalar_item WHERE conta_hospitalar_pacote_id = ? AND excluido_em IS NULL',
      [e.id],
    );
    let reabertos = 0;
    for (const i of itens)
      if (i['tipo_valorizacao'] === 'pacote')
        await tx.alterar('conta_hospitalar_item', n(i['id']), n(i['versao']), {
          situacao: 'estornado',
          observacao: `${txn(i['observacao']) ?? ''} Pacote descaracterizado: ${String(m['descricao'])}.`
            .trim()
            .slice(0, 2000),
        });
      else if (i['situacao'] === 'sem_cobranca') {
        await tx.alterar('conta_hospitalar_item', n(i['id']), n(i['versao']), {
          pertence_pacote: false,
          conta_hospitalar_pacote_id: null,
          situacao: 'lancado',
        });
        reabertos++;
      }
    const tot = await refazerTotal(tx, c.id);
    return { id: d, reabertos, total: tot.valor_total };
  },
  alvo: (_e, s) => ({ tabela: 'descaracterizacao_pacote', id: s.id }),
  trilha: (e) => ({ motivo: e.justificativa }),
});

export const OPERACOES_AJUSTES = {
  'horario.faixa': opGravarFaixa,
  'horario.expediente': opGravarExpediente,
  'horario.aplicar': opAplicarHorario,
  'ajuste.motivo': opGravarMotivoAjuste,
  'ajuste.pedir': opPedirAjuste,
  'ajuste.decidir': opDecidirAjuste,
  'pacote.versao': opVersionarPacote,
  'pacote.composicao': opGravarComposicao,
  'pacote.aplicar': opAplicarPacote,
  'pacote.motivo': opGravarMotivoDescaracterizacao,
  'pacote.descaracterizar': opDescaracterizar,
} as const;
export type NomeOperacaoAjustes = keyof typeof OPERACOES_AJUSTES;

export async function gravarAjustes(
  executor: Executor,
  nome: NomeOperacaoAjustes,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_AJUSTES[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
