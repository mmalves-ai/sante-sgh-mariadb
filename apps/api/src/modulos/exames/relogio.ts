// Relógio civil do estabelecimento (data ISO e hora "HHMM" do contrato), pelo fuso do cadastro do estabelecimento
// (estabelecimento.fuso_horario). O processo roda em UTC; o banco guarda instantes.
import type { RelogioEstabelecimento } from './tipos.js';

export const FUSO_PADRAO = 'America/Sao_Paulo';

export function relogioNoFuso(fuso: string = FUSO_PADRAO, agora: Date = new Date()): RelogioEstabelecimento {
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = formatador(fuso).formatToParts(agora);
  } catch {
    partes = formatador(FUSO_PADRAO).formatToParts(agora);
  }
  const v = (t: string) => partes.find((x) => x.type === t)?.value ?? '00';
  return { hoje: `${v('year')}-${v('month')}-${v('day')}`, hhmm: `${v('hour')}${v('minute')}` };
}

function formatador(fuso: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** "HHMM" → minutos desde a meia-noite (ou duração em minutos). */
export function minutosDeHhmm(hhmm: string): number {
  const s = hhmm.trim().padStart(4, '0');
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(2, 4));
}

/** Minutos → "HHMM". */
export function hhmmDeMinutos(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
}

/** Data civil e hora "HHMM" de um instante, no fuso do estabelecimento. */
export function civil(instante: Date, fuso: string = FUSO_PADRAO): { data: string; hhmm: string } {
  const r = relogioNoFuso(fuso, instante);
  return { data: r.hoje, hhmm: r.hhmm };
}

/** Instante (UTC) da data civil e hora "HHMM" no fuso do estabelecimento. */
export function instanteCivil(data: string, hhmm: string, fuso: string = FUSO_PADRAO): Date {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const min = minutosDeHhmm(hhmm);
  const alvo = Date.UTC(a, m - 1, d, Math.floor(min / 60), min % 60);
  let palpite = alvo;
  // Duas voltas bastam: a diferença entre o relógio civil e o UTC é a do fuso naquele instante.
  for (let i = 0; i < 2; i++) {
    const c = civil(new Date(palpite), fuso);
    const [ca, cm, cd] = c.data.split('-').map(Number) as [number, number, number];
    const cmin = minutosDeHhmm(c.hhmm);
    const visto = Date.UTC(ca, cm - 1, cd, Math.floor(cmin / 60), cmin % 60);
    palpite += alvo - visto;
  }
  return new Date(palpite);
}
