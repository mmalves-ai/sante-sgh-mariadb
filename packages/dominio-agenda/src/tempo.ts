// Horas e datas da agenda (ficha do M17, regras 1 e 4; ref 01 §4.2): o legado guarda a hora do horário como
// texto 'HHMM' de 4 dígitos (100% das linhas de REPACAGI medidas) e a duração também em HHMM ('0100' são 60
// minutos, não 100). "08:01" quebraria o gatilho que monta o carimbo da marcação: toda hora passa por aqui.
// Datas de calendário em AAAA-MM-DD (texto: a comparação lexical é a cronológica), sem fuso (UTC).

import { FORMATO_HHMM } from '@sgh/contratos';

const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

export class ErroTempo extends Error {
  override readonly name = 'ErroTempo';
}

export function hhmmValido(h: string): boolean {
  return FORMATO_HHMM.test(h);
}

/** "08:00", "8:00", "0800" ou "800" → "0800"; recusa o resto. */
export function normalizarHora(h: string): string {
  const s = h.trim();
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s);
  if (!m) throw new ErroTempo(`Hora inválida: use HH:MM.`);
  const r = `${m[1]!.padStart(2, '0')}${m[2]}`;
  if (!hhmmValido(r)) throw new ErroTempo(`Hora inválida: use HH:MM.`);
  return r;
}

/** "0800" → "08:00" (texto vazio fica vazio). */
export function formatarHora(h: string | null | undefined): string {
  const s = (h ?? '').trim();
  if (!s) return '';
  const p = s.padStart(4, '0');
  return `${p.slice(0, 2)}:${p.slice(2, 4)}`;
}

/** "0815" → 495 (minutos desde a meia-noite). */
export function paraMinutos(hhmm: string): number {
  const s = hhmm.trim().padStart(4, '0');
  if (!hhmmValido(s)) throw new ErroTempo('Hora inválida.');
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(2, 4));
}

/** 495 → "0815" (dentro do dia). */
export function deMinutos(min: number): string {
  if (!Number.isInteger(min) || min < 0 || min >= 1440) throw new ErroTempo('Hora fora do dia.');
  return `${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}`;
}

/** Duração em minutos → HHMM do legado (60 → "0100"; 15 → "0015"). */
export function duracaoHHMM(minutos: number): string {
  if (!Number.isInteger(minutos) || minutos < 1 || minutos >= 1440) throw new ErroTempo('Duração inválida.');
  return deMinutos(minutos);
}

/** Duração HHMM do legado → minutos ("0100" → 60); "0000", vazio ou inválido → null. */
export function duracaoMinutos(hhmm: string | null | undefined): number | null {
  const s = (hhmm ?? '').trim();
  if (!s || !hhmmValido(s.padStart(4, '0'))) return null;
  const m = paraMinutos(s);
  return m > 0 ? m : null;
}

export function dataValida(d: string): boolean {
  const m = FORMATO_DATA.exec(d);
  if (!m) return false;
  const [a, me, di] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const x = new Date(Date.UTC(a, me - 1, di));
  return x.getUTCFullYear() === a && x.getUTCMonth() === me - 1 && x.getUTCDate() === di;
}

function utc(d: string): Date {
  if (!dataValida(d)) throw new ErroTempo('Data inválida: use AAAA-MM-DD.');
  return new Date(`${d}T00:00:00Z`);
}

/** Dia da semana como o legado (REAGECRI.SEM1..SEM7, RECTRAGE.SEMANA): 1 = domingo … 7 = sábado. */
export function semanaDaData(d: string): number {
  return utc(d).getUTCDay() + 1;
}

export function somarDias(d: string, n: number): string {
  const x = utc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  return Math.round((utc(ate).getTime() - utc(de).getTime()) / 86_400_000);
}

/** Todas as datas de `de` a `ate` (inclusive). */
export function datasEntre(de: string, ate: string): string[] {
  const r: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) r.push(d);
  return r;
}

/** A mesma data no ano seguinte (29/02 vira 28/02). */
export function umAnoDepois(d: string): string {
  const [a, m, di] = d.split('-').map(Number) as [number, number, number];
  utc(d);
  const alvo = new Date(Date.UTC(a + 1, m - 1, di));
  if (alvo.getUTCMonth() !== m - 1) alvo.setUTCDate(0);
  return alvo.toISOString().slice(0, 10);
}

/** Segunda-feira da semana da data (a semana da grade começa na segunda). */
export function segundaDaSemana(d: string): string {
  const recuo = (utc(d).getUTCDay() + 6) % 7;
  return somarDias(d, -recuo);
}

/** Relógio do BANCO (nunca o do processo): hoje e o minuto corrente 'HHMM'. */
export interface Relogio {
  readonly hoje: string;
  readonly hhmm: string;
}

export interface Horario {
  readonly data: string;
  readonly hora: string;
}

/**
 * O horário já começou? O do minuto corrente conta como começado (vigencia.js:292-307): marcar ou remarcar
 * horário que já passou, inclusive o minuto corrente, é recusado.
 */
export function horarioJaPassou(h: Horario, relogio: Relogio): boolean {
  return h.data < relogio.hoje || (h.data === relogio.hoje && h.hora.padStart(4, '0') <= relogio.hhmm);
}

/** Janela de consulta recortada (até `maxDias`, contados a partir de `de`): recorta, não recusa. */
export function recortarJanela(
  de: string,
  ate: string,
  maxDias: number,
): { de: string; ate: string; recortada: boolean } {
  if (ate < de) throw new ErroTempo('O fim da janela vem antes do início.');
  const limite = somarDias(de, maxDias - 1);
  return ate > limite ? { de, ate: limite, recortada: true } : { de, ate, recortada: false };
}
