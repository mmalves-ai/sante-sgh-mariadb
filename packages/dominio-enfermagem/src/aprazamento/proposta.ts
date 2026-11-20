// Aprazamento (ficha do M25, regras 1 e 2; cap-05b §5.8; cap-11 §11.2 "Frequência e aprazamento"):
//   1. aprazar é ato do enfermeiro; o técnico executa e checa (COFEN 736/2024: a checagem da prescrição é a etapa de
//      implementação; a anotação pela equipe técnica, sob supervisão). A categoria vem do CBO da ocupação: 2235
//      (enfermeiro) apraza; 3222 (técnico e auxiliar de enfermagem) executa e checa.
//   2. a proposta segue a grade de horários-padrão da unidade (os horários do dia que a unidade usa para o número de
//      doses) e a âncora das frequências relativas (antes do café, ao deitar…); a primeira dose vai "agora" (quando o
//      prescritor pediu) ou para o próximo horário-padrão; reaprazar e suprimir exigem motivo.
import { deMinutos, minutos, minutosDoDia } from '../tempo.js';

export type CategoriaEnfermagem = 'enfermeiro' | 'tecnico' | 'outro';

/** Categoria pela ocupação (código CBO de 6 dígitos ou o começo dele). */
export function categoriaPorCbo(cbo: string | null | undefined): CategoriaEnfermagem {
  const c = (cbo ?? '').replace(/\D/g, '');
  if (c.startsWith('2235')) return 'enfermeiro';
  if (c.startsWith('3222')) return 'tecnico';
  return 'outro';
}

/** Regra 1: só o enfermeiro apraza (o técnico checa; os demais, nenhum dos dois). */
export function podeAprazar(categoria: CategoriaEnfermagem): boolean {
  return categoria === 'enfermeiro';
}

/** A checagem é da enfermagem (enfermeiro ou técnico). */
export function podeChecar(categoria: CategoriaEnfermagem): boolean {
  return categoria === 'enfermeiro' || categoria === 'tecnico';
}

export interface HorarioParaAprazar {
  readonly id: number;
  /** O horário previsto que a prescrição gerou. */
  readonly previsto: string;
  /** Ordem da dose no item (0 = a primeira). */
  readonly ordem: number;
  /** Âncora da frequência relativa (HH:mm), quando a frequência é relativa a um evento do dia. */
  readonly ancora?: string | null;
}

export interface EntradaProposta {
  readonly horarios: readonly HorarioParaAprazar[];
  /** Horários-padrão da unidade para o número de doses do item (HH:mm), em qualquer ordem. */
  readonly grade: readonly string[];
  readonly agora: string;
  /** A primeira dose "agora" (pedido do prescritor). */
  readonly primeiraAgora: boolean;
}

export interface Proposta {
  readonly horario: number;
  readonly previsto: string;
  readonly proposto: string;
  readonly motivo: 'agora' | 'proximoPadrao' | 'grade' | 'ancora' | 'mantido';
}

/** Próximo horário da grade no instante dado ou depois dele (minutos desde a época). */
function proximoDaGrade(grade: readonly number[], desde: number): number | null {
  if (grade.length === 0) return null;
  const dia = Math.floor(desde / 1440) * 1440;
  for (let d = 0; d <= 1; d++)
    for (const g of grade) {
      const t = dia + d * 1440 + g;
      if (t >= desde) return t;
    }
  return null;
}

/** O horário da grade mais perto do previsto (empate: o anterior, para não atrasar a dose). */
function maisPertoDaGrade(grade: readonly number[], previsto: number): number | null {
  if (grade.length === 0) return null;
  const dia = Math.floor(previsto / 1440) * 1440;
  let melhor: number | null = null;
  for (const d of [-1, 0, 1])
    for (const g of grade) {
      const t = dia + d * 1440 + g;
      if (melhor === null || Math.abs(t - previsto) < Math.abs(melhor - previsto)) melhor = t;
      else if (Math.abs(t - previsto) === Math.abs(melhor - previsto) && t < melhor) melhor = t;
    }
  return melhor;
}

/** Regra 2: a proposta de cada horário (a enfermeira ajusta e confirma em lote). */
export function proporAprazamento(e: EntradaProposta): Proposta[] {
  const grade = [...new Set(e.grade.map(minutosDoDia))].sort((a, b) => a - b);
  const agora = minutos(e.agora);
  const ordenados = [...e.horarios].sort((a, b) => a.ordem - b.ordem || a.previsto.localeCompare(b.previsto));
  return ordenados.map((h) => {
    const previsto = minutos(h.previsto);
    if (h.ordem === 0 && e.primeiraAgora)
      return {
        horario: h.id,
        previsto: h.previsto,
        proposto: deMinutos(Math.max(agora, previsto)),
        motivo: 'agora',
      };
    if (h.ancora) {
      const dia = Math.floor(previsto / 1440) * 1440;
      return {
        horario: h.id,
        previsto: h.previsto,
        proposto: deMinutos(dia + minutosDoDia(h.ancora)),
        motivo: 'ancora',
      };
    }
    if (h.ordem === 0 && previsto < agora) {
      const p = proximoDaGrade(grade, agora);
      if (p !== null)
        return { horario: h.id, previsto: h.previsto, proposto: deMinutos(p), motivo: 'proximoPadrao' };
    }
    const g = maisPertoDaGrade(grade, previsto);
    if (g === null || g === previsto)
      return { horario: h.id, previsto: h.previsto, proposto: h.previsto, motivo: 'mantido' };
    return { horario: h.id, previsto: h.previsto, proposto: deMinutos(g), motivo: 'grade' };
  });
}

export type AcaoAprazamento = 'aprazar' | 'reaprazar' | 'suprimir';

/** Reaprazar e suprimir exigem motivo (regra 2); aprazar fora da proposta também (o ajuste fica explicado). */
export function conferirAcaoAprazamento(a: {
  readonly acao: AcaoAprazamento;
  readonly proposto: string;
  readonly confirmado: string | null;
  readonly motivo: string | null;
}): string | null {
  const motivo = (a.motivo ?? '').trim();
  if ((a.acao === 'reaprazar' || a.acao === 'suprimir') && motivo.length < 5)
    return a.acao === 'suprimir'
      ? 'Informe o motivo de suprimir o horário.'
      : 'Informe o motivo de reaprazar o horário.';
  if (a.acao === 'suprimir')
    return a.confirmado === null ? null : 'Horário suprimido não tem hora confirmada.';
  if (a.confirmado === null) return 'Informe a hora confirmada.';
  if (a.acao === 'aprazar' && a.confirmado !== a.proposto.slice(0, 16) && motivo.length < 5)
    return 'A hora confirmada difere da proposta: informe o motivo do ajuste.';
  return null;
}
