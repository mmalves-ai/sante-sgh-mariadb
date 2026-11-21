// Apoio das portas próprias do centro cirúrgico: conversão de valores lidos do banco e do horário civil do fuso do
// estabelecimento ("AAAA-MM-DD HH:MM") para o instante gravado (DATETIME em UTC) e de volta.
export const FUSO_PADRAO = 'America/Sao_Paulo';

export const n = (v: unknown) => Number(v ?? 0);
export const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
export const textoOuNulo = (v: unknown) => (v === null || v === undefined ? null : String(v));
export const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
/** Coluna DATE → "AAAA-MM-DD"; null se vazia. */
export const dataOuNulo = (v: unknown) =>
  v === null || v === undefined || v === ''
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
export const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

function partes(d: Date, fuso: string): string {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return f.format(d).replace('T', ' ');
}

/** Instante do banco → "AAAA-MM-DD HH:MM" no fuso; null se vazio. */
export function civil(v: unknown, fuso: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d =
    v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + (String(v).endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : partes(d, fuso);
}

/**
 * Hora "HH:MM" (ou "HH:MM:SS") → "HH:MM". Os quatro dígitos sem separador ainda chegam do contrato do portal do médico
 * externo até ele migrar (lote 21); depois disso, só "HH:MM".
 */
export const horaDe = (h: string) => (h.includes(':') ? h.slice(0, 5) : `${h.slice(0, 2)}:${h.slice(2, 4)}`);

/** "AAAA-MM-DD HH:MM" (ou com "T") no fuso → instante; `minutos` soma ao fim (o limite superior do dia). */
export function instante(civilTexto: string, fuso: string, minutos = 0): Date {
  const t = civilTexto.replace('T', ' ');
  const [data, hora = '00:00'] = t.split(' ');
  const [a, m, d] = (data ?? '').split('-').map(Number);
  const [h, mi] = horaDe(hora).split(':').map(Number);
  const palpite = Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  const visto = partes(new Date(palpite), fuso);
  const [vd, vh] = visto.split(' ');
  const [va, vm, vdd] = (vd ?? '').split('-').map(Number);
  const [vhh, vmi] = (vh ?? '').split(':').map(Number);
  const desvio = Date.UTC(va ?? 1970, (vm ?? 1) - 1, vdd ?? 1, vhh ?? 0, vmi ?? 0) - palpite;
  return new Date(palpite - desvio + minutos * 60_000);
}
