// Simulador do item (06-FAT linha 11): explicar o valor de um item e medir o impacto de um reajuste, sem gravar nada.
// O reajuste simulado é por percentual e por alvo, como o mercado negocia com as operadoras:
//   - índice: o valor do CH, da UCO e do filme do acordo (o honorário do modelo CH e o custo do PORTE);
//   - porte: o valor do porte de honorário do acordo (modelo PORTE, CBHPM);
//   - porte anestésico: o valor do porte anestésico do acordo (comum e em horário especial);
//   - tabela: os componentes da vigência de valor (modelo VALOR).
// Cada alvo só mexe no que o item usa: o item cobrado pelo índice não muda com o reajuste da tabela, e o da tabela
// não muda com o reajuste do índice. O impacto diz isso item a item, com as parcelas antes e depois.
import {
  type EntradaTotalHonorario,
  type IndicesResolvidos,
  type TotalHonorario,
  totalDoHonorario,
} from './indice-cobranca.js';
import { centavos, type Componentes } from './modelo-valor.js';

export const ALVOS_REAJUSTE_SIMULADO = ['indice', 'porte', 'porteAnestesico', 'tabela'] as const;
export type AlvoReajusteSimulado = (typeof ALVOS_REAJUSTE_SIMULADO)[number];

/** Percentual por alvo (10 = +10%; -5 = -5%); ausente ou null = sem reajuste naquele alvo. */
export type ReajusteSimulado = Partial<Record<AlvoReajusteSimulado, number | null>>;

const PCT_MIN = -99.9999;
const PCT_MAX = 1000;
const casas = (v: number) => (String(v).split('.')[1] ?? '').length;
const arred = (v: number, c: number) => Math.round(v * 10 ** c) / 10 ** c;
const fator = (p: number | null | undefined) => (p == null ? 1 : 1 + p / 100);

/** Percentual entre -99,9999 e 1000, com até 4 casas; pelo menos um alvo é pedido. */
export function validarReajusteSimulado(r: ReajusteSimulado): Record<string, string> {
  const erros: Record<string, string> = {};
  let algum = false;
  for (const a of ALVOS_REAJUSTE_SIMULADO) {
    const p = r[a];
    if (p == null) continue;
    algum = true;
    if (!Number.isFinite(p) || p < PCT_MIN || p > PCT_MAX || casas(p) > 4)
      erros[a] = 'Percentual entre -99,9999 e 1000, com até 4 casas.';
  }
  if (!algum) erros['reajuste'] = 'Informe o percentual de pelo menos um alvo.';
  return erros;
}

/** A entrada do total com os valores do acordo e da vigência reajustados (casas das tabelas oficiais). */
export function reajustarEntradaHonorario(
  e: EntradaTotalHonorario,
  r: ReajusteSimulado,
): EntradaTotalHonorario {
  const fi = fator(r.indice);
  const indices: IndicesResolvidos = {
    valores: new Map([...e.indices.valores].map(([k, v]) => [k, arred(v * fi, 6)])),
    origem: e.indices.origem,
  };
  const ft = fator(r.tabela);
  const vigente: Componentes | null = e.vigente
    ? {
        ch: arred(e.vigente.ch * ft, 2),
        co: arred(e.vigente.co * ft, 2),
        filme: arred(e.vigente.filme * ft, 2),
        anes: arred(e.vigente.anes * ft, 2),
        outros: arred(e.vigente.outros * ft, 2),
      }
    : null;
  const fa = fator(r.porteAnestesico);
  return {
    ...e,
    indices,
    vigente,
    porte: e.porte === null ? null : arred(e.porte * fator(r.porte), 2),
    porteAnestesico: e.porteAnestesico
      ? {
          valor: arred(e.porteAnestesico.valor * fa, 4),
          valorHorarioEspecial:
            e.porteAnestesico.valorHorarioEspecial === null
              ? null
              : arred(e.porteAnestesico.valorHorarioEspecial * fa, 4),
        }
      : (e.porteAnestesico ?? null),
  };
}

/** Os alvos pedidos que o item usa de fato. */
export function alvosQueAfetam(e: EntradaTotalHonorario, r: ReajusteSimulado): AlvoReajusteSimulado[] {
  const t = totalDoHonorario({ ...e, quantidade: 1 });
  const usa: Record<AlvoReajusteSimulado, boolean> = {
    indice: t.origem === 'indice' && e.indices.valores.size > 0,
    porte: t.origem === 'indice' && e.porte !== null && !!e.item.porte,
    porteAnestesico: t.origem === 'indice' && !!e.porteAnestesico && !!e.item.porteAnestesico?.trim(),
    tabela: t.origem === 'vigencia',
  };
  return ALVOS_REAJUSTE_SIMULADO.filter((a) => r[a] != null && r[a] !== 0 && usa[a]);
}

export interface ImpactoReajusteItem {
  readonly atual: TotalHonorario;
  readonly novo: TotalHonorario;
  readonly quantidade: number;
  /** Novo − atual (null quando um dos dois não fecha). */
  readonly diferenca: number | null;
  /** Variação em %, com 2 casas (null quando o atual é zero ou não fecha). */
  readonly percentual: number | null;
  /** Os alvos pedidos que mudam o valor deste item (vazio: o reajuste não o alcança). */
  readonly afetadoPor: readonly AlvoReajusteSimulado[];
}

/** O total do item antes e depois do reajuste simulado, na quantidade dada (nada é gravado). */
export function simularReajusteItem(
  e: EntradaTotalHonorario,
  r: ReajusteSimulado,
  quantidade = 1,
): ImpactoReajusteItem {
  const atual = totalDoHonorario({ ...e, quantidade });
  const afetadoPor = alvosQueAfetam(e, r);
  const novo =
    afetadoPor.length === 0 ? atual : totalDoHonorario({ ...reajustarEntradaHonorario(e, r), quantidade });
  const diferenca = atual.total === null || novo.total === null ? null : centavos(novo.total - atual.total);
  const percentual =
    diferenca === null || !atual.total ? null : Math.round((diferenca / atual.total) * 10_000) / 100;
  return { atual, novo, quantidade, diferenca, percentual, afetadoPor };
}
