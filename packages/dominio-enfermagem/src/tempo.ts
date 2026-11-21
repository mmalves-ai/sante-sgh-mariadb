// Horas locais do estabelecimento em texto (AAAA-MM-DDTHH:mm[:ss]), como o banco guarda e a tela mostra: a conta é
// feita em minutos, sem fuso (o fuso do estabelecimento é fixo; o relógio vem do banco).
const FORMATO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

export class ErroHora extends Error {
  override readonly name = 'ErroHora';
}

/** Minutos desde a época (sem fuso). */
export function minutos(t: string): number {
  const m = FORMATO.exec(t);
  if (!m) throw new ErroHora(`Hora fora do formato AAAA-MM-DDTHH:mm: ${t}`);
  const [, a, me, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return Math.floor(Date.UTC(a, me - 1, d, h, mi) / 60_000);
}

/** Texto AAAA-MM-DDTHH:mm a partir dos minutos. */
export function deMinutos(n: number): string {
  return new Date(n * 60_000).toISOString().slice(0, 16);
}

export function somarMinutos(t: string, n: number): string {
  return deMinutos(minutos(t) + n);
}

export function diferencaMinutos(de: string, ate: string): number {
  return minutos(ate) - minutos(de);
}

/** "HH:MM" → minutos do dia. Os dois-pontos ainda são opcionais enquanto os padrões de turno não migram (pedido no lote 16). */
export function minutosDoDia(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):?([0-5]\d)$/.exec(hhmm.trim());
  if (!m) throw new ErroHora(`Hora do dia fora do formato HH:mm: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function dataDe(t: string): string {
  return t.slice(0, 10);
}
