// Esperas e painel do supervisor (M19; ficha, seção 4): esperas da emissão à chamada e da chamada ao fim, por
// prioridade, a partir das marcas de tempo que o novo guarda (o legado não guarda a hora da chamada); as senhas
// esperando há mais tempo e as acima do tempo-alvo da fila.
import { prioritaria } from './prioridade.js';

export interface TemposSenha {
  readonly prioridade: string;
  readonly emitidaEm: string;
  readonly chamadaEm: string | null;
  readonly concluidaEm: string | null;
}

const minutos = (de: string, ate: string) => (Date.parse(ate) - Date.parse(de)) / 60_000;
const media = (xs: readonly number[]) =>
  xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

export interface ResumoEsperas {
  readonly medidas: number;
  readonly chegadaChamadaMedia: number | null;
  readonly chamadaFimMedia: number | null;
  readonly prioritariasMedia: number | null;
  readonly normaisMedia: number | null;
}

export function resumirEsperas(ts: readonly TemposSenha[]): ResumoEsperas {
  const comChamada = ts.filter((t) => t.chamadaEm && minutos(t.emitidaEm, t.chamadaEm) >= 0);
  const esperas = comChamada.map((t) => minutos(t.emitidaEm, t.chamadaEm as string));
  const fins = ts
    .filter((t) => t.chamadaEm && t.concluidaEm && minutos(t.chamadaEm, t.concluidaEm) >= 0)
    .map((t) => minutos(t.chamadaEm as string, t.concluidaEm as string));
  return {
    medidas: comChamada.length,
    chegadaChamadaMedia: media(esperas),
    chamadaFimMedia: media(fins),
    prioritariasMedia: media(
      comChamada
        .filter((t) => prioritaria(t.prioridade))
        .map((t) => minutos(t.emitidaEm, t.chamadaEm as string)),
    ),
    normaisMedia: media(
      comChamada
        .filter((t) => !prioritaria(t.prioridade))
        .map((t) => minutos(t.emitidaEm, t.chamadaEm as string)),
    ),
  };
}

/** Tempos com o guichê da primeira chamada (a medida por guichê). */
export interface TemposSenhaGuiche extends TemposSenha {
  readonly recepcao: number;
  readonly guiche: number | null;
}

const esperaValida = (t: TemposSenha) => !!t.chamadaEm && minutos(t.emitidaEm, t.chamadaEm) >= 0;

/** Espera emissão → chamada pela hora da emissão (0 a 23), só as horas com medida. */
export function esperasPorHora(
  ts: readonly TemposSenha[],
): { hora: number; medidas: number; esperaMedia: number | null }[] {
  const por = new Map<number, number[]>();
  for (const t of ts) {
    if (!esperaValida(t)) continue;
    const hora = Number(t.emitidaEm.slice(11, 13));
    if (!Number.isInteger(hora)) continue;
    por.set(hora, [...(por.get(hora) ?? []), minutos(t.emitidaEm, t.chamadaEm as string)]);
  }
  return [...por.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hora, xs]) => ({ hora, medidas: xs.length, esperaMedia: media(xs) }));
}

/** Por guichê (recepção + número da primeira chamada): chamadas, espera até a chamada e da chamada ao fim. */
export function esperasPorGuiche(ts: readonly TemposSenhaGuiche[]): {
  recepcao: number;
  guiche: number;
  chamadas: number;
  esperaMedia: number | null;
  chamadaFimMedia: number | null;
}[] {
  const por = new Map<string, { recepcao: number; guiche: number; esperas: number[]; fins: number[] }>();
  for (const t of ts) {
    if (!esperaValida(t) || !t.guiche) continue;
    const k = `${t.recepcao}:${t.guiche}`;
    const x = por.get(k) ?? { recepcao: t.recepcao, guiche: t.guiche, esperas: [], fins: [] };
    x.esperas.push(minutos(t.emitidaEm, t.chamadaEm as string));
    if (t.concluidaEm && minutos(t.chamadaEm as string, t.concluidaEm) >= 0)
      x.fins.push(minutos(t.chamadaEm as string, t.concluidaEm));
    por.set(k, x);
  }
  return [...por.values()]
    .sort((a, b) => a.recepcao - b.recepcao || a.guiche - b.guiche)
    .map((x) => ({
      recepcao: x.recepcao,
      guiche: x.guiche,
      chamadas: x.esperas.length,
      esperaMedia: media(x.esperas),
      chamadaFimMedia: media(x.fins),
    }));
}

/** Minutos de espera até agora (nunca negativo). */
export function esperaAte(emitidaEm: string, agora: string): number {
  return Math.max(0, Math.floor(minutos(emitidaEm, agora)));
}

export interface FilaResumo {
  readonly aguardando: number;
  readonly prioritarias: number;
  readonly esperaMediaMinutos: number;
  readonly maiorEsperaMinutos: number;
  readonly acimaDaMeta: number;
}

export function resumirFila(
  senhas: readonly { readonly prioridade: string; readonly emitidaEm: string }[],
  agora: string,
  tempoAlvoMinutos: number,
): FilaResumo {
  const esperas = senhas.map((s) => esperaAte(s.emitidaEm, agora));
  return {
    aguardando: senhas.length,
    prioritarias: senhas.filter((s) => prioritaria(s.prioridade)).length,
    esperaMediaMinutos: esperas.length ? Math.round(esperas.reduce((a, b) => a + b, 0) / esperas.length) : 0,
    maiorEsperaMinutos: esperas.length ? Math.max(...esperas) : 0,
    acimaDaMeta: tempoAlvoMinutos > 0 ? esperas.filter((e) => e > tempoAlvoMinutos).length : 0,
  };
}

/** As n senhas esperando há mais tempo (a mais antiga primeiro). */
export function maisAntigas<T extends { readonly emitidaEm: string; readonly id: number }>(
  senhas: readonly T[],
  n: number,
): T[] {
  return [...senhas]
    .sort((a, b) => a.emitidaEm.localeCompare(b.emitidaEm) || a.id - b.id)
    .slice(0, Math.max(0, n));
}
