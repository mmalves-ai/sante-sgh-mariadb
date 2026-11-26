// Preço do item na conta: as tabelas que valem para a conta e o preço vigente na data. Fica fora de operacoes.ts para
// que a apuração automática (conta-entrada.ts) e o lançamento usem a mesma busca sem ciclo de importação (operacoes.ts
// registra as operações da apuração em OPERACOES_CONTA).
// 06-FAT linha 5: o item da tabela no modelo CH ou PORTE (modelo_valor 'indice' ou 'porte') é cobrado pelo índice do
// acordo na data × a quantidade (o do procedimento vence o do setor do lançamento, que vence o do acordo), mais o porte
// anestésico do acordo no regime da conta; nunca pela soma dos componentes da vigência. Faltando índice, recusa com a
// falta dita (nunca um preço em silêncio). A regra é do @sgh/dominio-preco (totalDoHonorario, resolverIndices).
import {
  type EntradaTotalHonorario,
  regimesDoAtendimento,
  resolverIndices,
  totalDoHonorario,
} from '@sgh/dominio-preco';
import { type Leitor, recusa } from '@sgh/nucleo';
import {
  indicesDiferenciadosNaDataPropria,
  indicesNaDataPropria,
  porteAnestesicoNaDataPropria,
  porteNaDataPropria,
} from '../precos/indices-propria.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const r2 = (x: number) => Math.round(x * 100) / 100;

/** As tabelas de preço que valem para a conta: a da própria conta, a do plano e as da fonte pagadora. */
export async function tabelasDePreco(
  l: Leitor,
  est: number,
  fonte: number,
  plano: number | null,
  daConta: number | null = null,
): Promise<number[]> {
  const ids: number[] = [];
  if (daConta !== null) ids.push(daConta);
  if (plano !== null) {
    const p = await l.uma<Linha>('SELECT tabela_preco_id FROM plano_fonte_pagadora WHERE id = ?', [plano]);
    if (p?.['tabela_preco_id']) ids.push(n(p['tabela_preco_id']));
  }
  const r = await l.consultar<Linha>(
    `SELECT id FROM tabela_preco WHERE fonte_pagadora_id = ? AND excluido_em IS NULL AND situacao = 'ativa'
        AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
      ORDER BY estabelecimento_id IS NULL, id`,
    [fonte, est],
    { teto: 100 },
  );
  for (const x of r) if (!ids.includes(n(x['id']))) ids.push(n(x['id']));
  return ids;
}

export interface PrecoVigente {
  readonly modelo: string;
  readonly unitario: number;
  readonly honorario: number;
  readonly custoOperacional: number;
  readonly filme: number;
  readonly vigencia: string;
  readonly tabela: number;
  /** De onde saiu o unitário: do índice do acordo (CH ou PORTE) ou da vigência do valor. */
  readonly origem?: 'indice' | 'vigencia';
  /** Os passos do cálculo pelo índice (para a memória do item). */
  readonly passos?: readonly string[];
  /** A entrada do cálculo pelo índice (índices, portes e regime), para o simulador medir um reajuste sobre ela. */
  readonly entrada?: EntradaTotalHonorario;
}

/** Onde o item é lançado: o acordo da conta, o setor do lançamento, o regime da conta e o horário especial. */
export interface AlvoPrecoConta {
  readonly est: number;
  readonly fonte: number;
  /** A conta: o regime do atendimento dela escolhe o índice do setor e a tabela do porte anestésico. */
  readonly conta?: number | null;
  /** Setor do lançamento (setor funcional do estabelecimento): o índice do setor no acordo. */
  readonly setor?: number | null;
  /** Horário especial: o porte anestésico pelo valor do horário especial do acordo. */
  readonly horarioEspecial?: boolean;
  /** Regime do porte anestésico quando não há conta (simulador: o tipo de conta escolhido). */
  readonly regime?: 'internacao' | 'ambulatorial';
}

const MODELOS_POR_INDICE = new Set(['indice', 'porte']);

/** O unitário do item CH ou PORTE pelo índice do acordo na data (recusa quando falta índice ou acordo). */
async function precoPeloIndice(
  l: Leitor,
  v: Linha,
  item: number,
  data: string,
  alvo: AlvoPrecoConta | null,
): Promise<{ unitario: number; passos: readonly string[]; entrada: EntradaTotalHonorario }> {
  const est = alvo?.est ?? (v['t_est'] == null ? null : n(v['t_est']));
  const fonte = alvo?.fonte ?? (v['t_fonte'] == null ? null : n(v['t_fonte']));
  if (est === null || fonte === null)
    throw recusa(
      'item-sem-indice',
      'O item é cobrado pelo índice e a tabela não está ligada a uma fonte pagadora com acordo neste estabelecimento.',
      { campos: ['codigo'] },
    );
  let regimeId: number | null = null;
  let regimePorte: 'internacao' | 'ambulatorial' = alvo?.regime ?? 'ambulatorial';
  if (alvo?.conta) {
    const c = await l.uma<Linha>(
      `SELECT c.natureza, a.regime_atendimento_id, ra.codigo_tiss AS regime, ct.urgencia
         FROM conta_hospitalar c
         LEFT JOIN atendimento a ON a.id = c.atendimento_id
         LEFT JOIN regime_atendimento ra ON ra.id = a.regime_atendimento_id
         LEFT JOIN carater_atendimento_tiss ct ON ct.id = a.carater_atendimento_tiss_id
        WHERE c.id = ?`,
      [alvo.conta],
    );
    regimeId = c?.['regime_atendimento_id'] == null ? null : n(c['regime_atendimento_id']);
    // O regime pelo código oficial do atendimento; sem ele, pela natureza da conta (nunca pela descrição).
    const pelo = regimesDoAtendimento(
      c?.['regime'] == null ? null : texto(c['regime']),
      Number(c?.['urgencia'] ?? 0) === 1,
    ).regimes;
    regimePorte =
      pelo.includes('internacao') || (pelo.length === 0 && texto(c?.['natureza']) === 'internacao')
        ? 'internacao'
        : 'ambulatorial';
  }
  const acordo = await indicesNaDataPropria(l, est, fonte, data);
  const dif = await indicesDiferenciadosNaDataPropria(l, est, fonte, data, {
    itemFaturavel: item,
    setor: alvo?.setor ?? null,
    regimeAtendimento: regimeId,
  });
  const indices = resolverIndices({ acordo, setor: dif.setor, item: dif.item });
  const porte = v['porte'] == null ? null : texto(v['porte']);
  const porteAnest = v['porte_anestesico'] == null ? null : texto(v['porte_anestesico']);
  const entrada: EntradaTotalHonorario = {
    item: {
      ch: texto(v['modelo_valor']) === 'indice' ? n(v['quantidade_indice']) : 0,
      porte,
      fracaoPorte: null,
      cope: null,
      filmeM2: null,
      porteAnestesico: porteAnest,
    },
    vigente: null,
    indices,
    porte: porte ? await porteNaDataPropria(l, est, fonte, porte, data) : null,
    porteAnestesico: porteAnest
      ? await porteAnestesicoNaDataPropria(l, est, fonte, regimePorte, porteAnest, data)
      : null,
    horarioEspecial: alvo?.horarioEspecial === true,
  };
  const t = totalDoHonorario(entrada);
  if (t.origem !== 'indice' || t.total === null)
    throw recusa(
      'item-sem-indice',
      `O item é cobrado pelo índice do acordo e falta ${t.falta.join(', ') || 'o valor do índice na data'}: registre o valor na aba Tabelas e índices do contrato.`,
      { campos: ['codigo'] },
    );
  return { unitario: t.total, passos: t.passos, entrada };
}

/**
 * O preço vigente do item na data, pela primeira tabela (na ordem dada) que o tem. No modelo CH ou PORTE o unitário
 * sai do índice do acordo (alvo: o acordo, o setor, o regime e o horário especial do lançamento; sem alvo, o
 * estabelecimento e a fonte da própria tabela).
 */
export async function precoVigente(
  l: Leitor,
  tabelas: readonly number[],
  item: number,
  data: string,
  alvo: AlvoPrecoConta | null = null,
): Promise<PrecoVigente | null> {
  for (const t of tabelas) {
    const v = await l.uma<Linha>(
      `SELECT pp.modelo_valor, pp.quantidade_indice, po.codigo AS porte, it.porte_anestesico,
              t.estabelecimento_id AS t_est, t.fonte_pagadora_id AS t_fonte,
              pv.vigencia_inicio, pv.valor_honorario, pv.valor_custo_operacional, pv.valor_filme, pv.valor_total
         FROM preco_procedimento pp JOIN preco_procedimento_valor pv ON pv.preco_procedimento_id = pp.id
         JOIN tabela_preco t ON t.id = pp.tabela_preco_id
         LEFT JOIN porte_procedimento po ON po.id = pp.porte_procedimento_id
         LEFT JOIN item_faturavel it ON it.id = pp.item_faturavel_id
        WHERE pp.tabela_preco_id = ? AND pp.item_faturavel_id = ? AND pp.ativo = 1 AND pp.excluido_em IS NULL
          AND pv.vigencia_inicio <= ? AND pv.operacao <> 'exclusao'
          AND NOT EXISTS (SELECT 1 FROM preco_procedimento_valor z WHERE z.preco_procedimento_id = pv.preco_procedimento_id
                AND z.vigencia_inicio = pv.vigencia_inicio AND z.operacao = 'exclusao' AND z.id > pv.id)
        ORDER BY pv.vigencia_inicio DESC, pv.id DESC`,
      [t, item, data],
    );
    if (!v) continue;
    const vig = v['vigencia_inicio'];
    const vigencia = vig instanceof Date ? vig.toISOString().slice(0, 10) : texto(vig).slice(0, 10);
    if (MODELOS_POR_INDICE.has(texto(v['modelo_valor']))) {
      // CH ou PORTE: o unitário é o honorário pelo índice (sem custo operacional nem filme de vigência).
      const x = await precoPeloIndice(l, v, item, data, alvo);
      return {
        modelo: texto(v['modelo_valor']),
        unitario: x.unitario,
        honorario: x.unitario,
        custoOperacional: 0,
        filme: 0,
        vigencia,
        tabela: t,
        origem: 'indice',
        passos: x.passos,
        entrada: x.entrada,
      };
    }
    const honorario = n(v['valor_honorario']);
    const custoOperacional = n(v['valor_custo_operacional']);
    const filme = n(v['valor_filme']);
    const total = v['valor_total'] === null ? r2(honorario + custoOperacional + filme) : n(v['valor_total']);
    return {
      modelo: texto(v['modelo_valor']),
      unitario: total,
      honorario,
      custoOperacional,
      filme,
      vigencia,
      tabela: t,
      origem: 'vigencia',
    };
  }
  return null;
}
