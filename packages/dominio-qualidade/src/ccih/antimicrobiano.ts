// Regra 6 do M48 (cap-05b §5.11, Antimicrobiano): o antimicrobiano restrito exige a ficha (M24) e a liberação da CCIH
// no prazo da política (24 a 48 h); sem liberação, alerta ao prescritor e à CCIH; o sistema NÃO suspende sozinho;
// revisão no 3º e no 7º dia; consumo em DDD por 1.000 pacientes-dia e DOT por 1.000 pacientes-dia.
//   - DDD (OMS): gramas dispensadas ÷ DDD do princípio ativo; as gramas = unidades × gramas por unidade (configurado
//     pela CCIH por item; item sem DDD configurada aparece à parte, com as unidades, e não entra na soma).
//   - DOT (dias de terapia): cada dia em que o paciente recebeu o antimicrobiano conta 1 por antimicrobiano (dois
//     antimicrobianos no mesmo dia = 2 DOT), pelos dias de vigência das prescrições na competência.
import {
  type ConsumoAntimicrobianoItem,
  type DecisaoAntimicrobiano,
  type MarcoRevisaoAntimicrobiano,
  type ParcelaIndicador,
  PRAZO_LIBERACAO_HORAS,
  type SituacaoLiberacaoAntimicrobiano,
} from '@sgh/contratos';
import { parcela } from './denominadores.js';
import { msLocal } from '../nsp/prazos.js';
import { diasDaCompetencia, diferencaDias, diaDe, somarDias } from './tempo.js';

const HORA_MS = 3_600_000;

/** O prazo da política em horas (parâmetro da CCIH), preso ao intervalo da ficha; fora dele, o padrão. */
export function prazoDaPolitica(horas: number | null | undefined): number {
  return horas !== null &&
    horas !== undefined &&
    Number.isInteger(horas) &&
    horas >= PRAZO_LIBERACAO_HORAS.minimo &&
    horas <= PRAZO_LIBERACAO_HORAS.maximo
    ? horas
    : PRAZO_LIBERACAO_HORAS.padrao;
}

export interface SituacaoDaLiberacao {
  readonly situacao: SituacaoLiberacaoAntimicrobiano;
  /** Até quando a CCIH tem para decidir (instante local). */
  readonly venceEm: string;
  /** Alerta ao prescritor e à CCIH (sem liberação no prazo); nunca suspende. */
  readonly alerta: boolean;
}

/** A situação do item restrito prescrito para a fila da CCIH (regra 6). */
export function situacaoDaLiberacao(e: {
  readonly prescritoEm: string;
  readonly agora: string;
  readonly prazoHoras: number;
  readonly decisao: DecisaoAntimicrobiano | null;
}): SituacaoDaLiberacao {
  const vence = msLocal(e.prescritoEm) + prazoDaPolitica(e.prazoHoras) * HORA_MS;
  const venceEm = new Date(vence).toISOString().slice(0, 19);
  if (e.decisao === 'naoLiberado') return { situacao: 'naoLiberado', venceEm, alerta: false };
  if (e.decisao !== null) return { situacao: 'liberado', venceEm, alerta: false };
  const vencida = msLocal(e.agora) > vence;
  return { situacao: vencida ? 'vencida' : 'aguardando', venceEm, alerta: vencida };
}

export interface RevisaoDevida {
  readonly marco: MarcoRevisaoAntimicrobiano;
  /** O dia em que a revisão cabe (data civil). */
  readonly devidaEm: string;
  readonly atrasada: boolean;
}

/**
 * A próxima revisão devida: o início do tratamento é o dia 1; a do 3º dia cabe no dia 3 e a do 7º no dia 7 (só se a
 * liberação cobre o 7º dia). Revisão já feita não volta; a mais antiga pendente vem primeiro.
 */
export function revisaoDevida(e: {
  readonly inicio: string;
  readonly agora: string;
  readonly diasAutorizados: number | null;
  readonly feitas: { readonly d3: boolean; readonly d7: boolean };
}): RevisaoDevida | null {
  const dia = diferencaDias(e.inicio, e.agora) + 1;
  const candidatos: { marco: MarcoRevisaoAntimicrobiano; n: number; feita: boolean }[] = [
    { marco: 'd3', n: 3, feita: e.feitas.d3 },
    { marco: 'd7', n: 7, feita: e.feitas.d7 || (e.diasAutorizados !== null && e.diasAutorizados < 7) },
  ];
  const c = candidatos.find((x) => !x.feita && dia >= x.n);
  if (!c) return null;
  return { marco: c.marco, devidaEm: somarDias(diaDe(e.inicio), c.n - 1), atrasada: dia > c.n };
}

/** A revisão pedida cabe agora (não antes do dia; não repetida). */
export function conferirRevisao(e: {
  readonly marco: MarcoRevisaoAntimicrobiano;
  readonly inicio: string;
  readonly agora: string;
  readonly feitas: { readonly d3: boolean; readonly d7: boolean };
}): 'revisao-ja-feita' | 'revisao-antes-do-dia' | null {
  if (e.feitas[e.marco]) return 'revisao-ja-feita';
  const n = e.marco === 'd3' ? 3 : 7;
  return diferencaDias(e.inicio, e.agora) + 1 < n ? 'revisao-antes-do-dia' : null;
}

/** DDD do item: unidades × gramas por unidade ÷ DDD em gramas (duas casas); null sem configuração. */
export function dddDoItem(
  unidades: number,
  gramasPorUnidade: number | null,
  dddGramas: number | null,
): number | null {
  if (gramasPorUnidade === null || dddGramas === null || dddGramas <= 0) return null;
  return Math.round(((unidades * gramasPorUnidade) / dddGramas) * 100) / 100;
}

export interface VigenciaAntimicrobiano {
  readonly paciente: number;
  readonly item: number;
  /** Instantes locais da vigência do item na prescrição. */
  readonly de: string;
  readonly ate: string;
}

/** DOT por item na competência: dias distintos (paciente, dia) em que o item esteve vigente. */
export function diasDeTerapia(
  vigencias: readonly VigenciaAntimicrobiano[],
  competencia: string,
): Map<number, number> {
  const dias = new Set(diasDaCompetencia(competencia));
  const vistos = new Map<number, Set<string>>();
  for (const v of vigencias) {
    if (msLocal(v.ate) < msLocal(v.de)) continue;
    const s = vistos.get(v.item) ?? new Set<string>();
    for (let d = diaDe(v.de); d <= diaDe(v.ate); d = somarDias(d, 1))
      if (dias.has(d)) s.add(`${v.paciente}|${d}`);
    vistos.set(v.item, s);
  }
  return new Map([...vistos].map(([item, s]) => [item, s.size]));
}

export interface ItemConsumo {
  readonly item: number;
  readonly nome: string;
  readonly atc: string | null;
  readonly unidades: number;
  readonly dddGramas: number | null;
  readonly gramasPorUnidade: number | null;
}

export interface ConsumoAntimicrobianos {
  readonly itens: readonly ConsumoAntimicrobianoItem[];
  /** Itens dispensados sem DDD configurada (fora da soma da DDD; a CCIH configura). */
  readonly semDdd: readonly ConsumoAntimicrobianoItem[];
  /** Σ DDD ÷ pacientes-dia × 1.000 (numerador em DDD, duas casas). */
  readonly dddPorMilPacientesDia: ParcelaIndicador;
  /** Σ DOT ÷ pacientes-dia × 1.000. */
  readonly dotPorMilPacientesDia: ParcelaIndicador;
}

/** O consumo da competência com as parcelas impressas (regra 5 aplicada à regra 6). */
export function consumoAntimicrobianos(e: {
  readonly itens: readonly ItemConsumo[];
  readonly dot: ReadonlyMap<number, number>;
  readonly pacientesDia: number;
}): ConsumoAntimicrobianos {
  const porItem = new Map<number, ItemConsumo>(e.itens.map((i) => [i.item, i]));
  for (const item of e.dot.keys())
    if (!porItem.has(item))
      porItem.set(item, {
        item,
        nome: `Item ${String(item)}`,
        atc: null,
        unidades: 0,
        dddGramas: null,
        gramasPorUnidade: null,
      });
  const todos: ConsumoAntimicrobianoItem[] = [...porItem.values()]
    .map((i) => ({
      item: i.item,
      nome: i.nome,
      atc: i.atc,
      unidadesDispensadas: i.unidades,
      ddd: dddDoItem(i.unidades, i.gramasPorUnidade, i.dddGramas),
      diasTerapia: e.dot.get(i.item) ?? 0,
    }))
    .sort((a, b) => (b.ddd ?? -1) - (a.ddd ?? -1) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const comDdd = todos.filter((i) => i.ddd !== null);
  const somaDdd = Math.round(comDdd.reduce((s, i) => s + (i.ddd ?? 0), 0) * 100) / 100;
  const somaDot = todos.reduce((s, i) => s + i.diasTerapia, 0);
  return {
    itens: comDdd,
    semDdd: todos.filter((i) => i.ddd === null),
    dddPorMilPacientesDia: parcela(somaDdd, e.pacientesDia, 1000),
    dotPorMilPacientesDia: parcela(somaDot, e.pacientesDia, 1000),
  };
}
