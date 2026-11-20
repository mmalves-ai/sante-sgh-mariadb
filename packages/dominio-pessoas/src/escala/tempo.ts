// Tempo da escala (M52.2): instantes em hora local de Brasília (`AAAA-MM-DDTHH:MM`) convertidos em minutos de relógio
// de parede. O fuso America/Sao_Paulo não tem horário de verão desde 2019 (Decreto 9.772/2019), então a diferença de
// relógio é a duração real (D-FUSO-52); se o horário de verão voltar, a conversão passa a usar a tabela de fusos e só
// este arquivo muda. O plantão que atravessa a meia-noite é só um intervalo cujo fim cai no dia seguinte.
import { diaUtc } from '../datas.js';

const INSTANTE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutos desde 1970-01-01T00:00 no relógio local. */
export function minutoLocal(instante: string): number {
  const m = INSTANTE.exec(instante);
  if (!m) throw new Error(`Instante inválido: ${instante}`);
  return diaUtc(m[1]!) * 1440 + Number(m[2]) * 60 + Number(m[3]);
}

const p2 = (x: number) => String(x).padStart(2, '0');

/** O instante local (`AAAA-MM-DDTHH:MM`) de um minuto de relógio. */
export function instanteDeMinuto(minuto: number): string {
  const dia = Math.floor(minuto / 1440);
  const resto = minuto - dia * 1440;
  const d = new Date(dia * 86_400_000).toISOString().slice(0, 10);
  return `${d}T${p2(Math.floor(resto / 60))}:${p2(resto % 60)}`;
}

/** A data civil de um minuto de relógio. */
export function diaDeMinuto(minuto: number): string {
  return instanteDeMinuto(minuto).slice(0, 10);
}

export interface Intervalo {
  readonly inicio: string;
  readonly fim: string;
}

export function duracaoMin(i: Intervalo): number {
  return minutoLocal(i.fim) - minutoLocal(i.inicio);
}

/** Dois intervalos se sobrepõem quando um começa antes de o outro acabar (encostar não é sobrepor). */
export function sobrepoem(a: Intervalo, b: Intervalo): boolean {
  return minutoLocal(a.inicio) < minutoLocal(b.fim) && minutoLocal(b.inicio) < minutoLocal(a.fim);
}

/** A segunda-feira da semana (segunda a domingo) que contém o dia. */
export function segundaDaSemana(dia: string): string {
  const d = diaUtc(dia);
  const desdeSegunda = (((d % 7) + 7 + 3) % 7) as number; // 1970-01-01 foi uma quinta-feira
  return new Date((d - desdeSegunda) * 86_400_000).toISOString().slice(0, 10);
}

/** Os dias da competência (`AAAA-MM`), em ordem. */
export function diasDaCompetencia(competencia: string): string[] {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia);
  if (!m) throw new Error(`Competência inválida: ${competencia}`);
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const total = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${m[1]}-${m[2]}-${p2(i + 1)}`);
}

/**
 * Minutos de cada semana (chave: a segunda-feira) somados dos intervalos; o intervalo que atravessa a virada da semana
 * (domingo para segunda, 0 h) é dividido entre as duas.
 */
export function minutosPorSemana(intervalos: readonly Intervalo[]): Map<string, number> {
  const r = new Map<string, number>();
  for (const i of intervalos) {
    let a = minutoLocal(i.inicio);
    const b = minutoLocal(i.fim);
    while (a < b) {
      const segunda = segundaDaSemana(diaDeMinuto(a));
      const proximaSegunda = (diaUtc(segunda) + 7) * 1440;
      const ate = Math.min(b, proximaSegunda);
      r.set(segunda, (r.get(segunda) ?? 0) + (ate - a));
      a = ate;
    }
  }
  return r;
}
