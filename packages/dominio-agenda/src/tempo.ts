// Horas e datas da agenda. A hora do dia é "HH:MM" (00:00 a 23:59), o formato neutro do produto
// (`FORMATO_HORA` de @sgh/contratos); a duração de um atendimento é um número de minutos. As funções aceitam
// também a hora digitada sem os dois-pontos ("0800", "800"), mas devolvem sempre "HH:MM". Datas de calendário em
// AAAA-MM-DD (texto: a comparação lexical é a cronológica), sem fuso (UTC).

import { FORMATO_HORA } from '@sgh/contratos';

const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

export class ErroTempo extends Error {
  override readonly name = 'ErroTempo';
}

/** A hora está no formato estrito "HH:MM" (00:00 a 23:59)? */
export function horaValida(h: string): boolean {
  return FORMATO_HORA.test(h);
}

/** "08:00", "8:00", "0800" ou "800" → "08:00"; recusa o resto (hora fora de 00:00 a 23:59 inclusive). */
export function normalizarHora(h: string): string {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(h.trim());
  if (!m) throw new ErroTempo(`Hora inválida: use HH:MM.`);
  const r = `${m[1]!.padStart(2, '0')}:${m[2]}`;
  if (!horaValida(r)) throw new ErroTempo(`Hora inválida: use HH:MM.`);
  return r;
}

/** Hora para a tela, sempre "HH:MM" ("0800" → "08:00"); texto vazio fica vazio; inválida volta como veio. */
export function formatarHora(h: string | null | undefined): string {
  const s = (h ?? '').trim();
  if (!s) return '';
  try {
    return normalizarHora(s);
  } catch {
    return s;
  }
}

/** "08:15" → 495 (minutos desde a meia-noite). */
export function paraMinutos(hora: string): number {
  let s: string;
  try {
    s = normalizarHora(hora);
  } catch {
    throw new ErroTempo('Hora inválida.');
  }
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
}

/** 495 → "08:15" (dentro do dia). */
export function deMinutos(min: number): string {
  if (!Number.isInteger(min) || min < 0 || min >= 1440) throw new ErroTempo('Hora fora do dia.');
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * Duração escrita como horas e minutos ("01:00" são 60 minutos; aceita também "0100") → minutos; "00:00",
 * vazio ou inválido → null.
 */
export function duracaoMinutos(duracao: string | null | undefined): number | null {
  const s = (duracao ?? '').trim();
  if (!s) return null;
  let m: number;
  try {
    m = paraMinutos(s);
  } catch {
    return null;
  }
  return m > 0 ? m : null;
}

/** Duração em minutos (1 a 1439) → "HH:MM" (60 → "01:00"; 15 → "00:15"). */
export function duracaoEmHoras(minutos: number): string {
  if (!Number.isInteger(minutos) || minutos < 1 || minutos >= 1440) throw new ErroTempo('Duração inválida.');
  return deMinutos(minutos);
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

/** Dia da semana da escala da agenda: 1 = domingo … 7 = sábado. */
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

/**
 * Relógio do BANCO (nunca o do processo): hoje e o minuto corrente em "HH:MM". O nome do campo `hhmm` fica até a
 * troca coordenada com os módulos de exames e do portal (pedido na saída do lote 12-agenda da F2.4); o valor já é
 * "HH:MM" (a leitura aceita também os quatro dígitos).
 */
export interface Relogio {
  readonly hoje: string;
  readonly hhmm: string;
}

export interface Horario {
  readonly data: string;
  readonly hora: string;
}

/**
 * O horário já começou? O do minuto corrente conta como começado (vigencia.js, linhas 292 a 307): marcar ou remarcar
 * horário que já passou, inclusive o minuto corrente, é recusado.
 */
export function horarioJaPassou(h: Horario, relogio: Relogio): boolean {
  return (
    h.data < relogio.hoje || (h.data === relogio.hoje && paraMinutos(h.hora) <= paraMinutos(relogio.hhmm))
  );
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
