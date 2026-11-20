// Hora local do estabelecimento (AAAA-MM-DDTHH:MM, sem fuso): o banco do legado é local e o relógio vem dele. As
// contas são em minutos desde a época, sobre o calendário civil (sem horário de verão: o legado grava fuso -3 e
// horário de verão F em 100% da janela).

const RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

export function minLocal(local: string): number {
  const m = RE.exec(local);
  if (!m) throw new Error(`Hora local inválida: ${local}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 60_000;
}

export function minLocalValido(local: string): number | null {
  return RE.test(local) ? minLocal(local) : null;
}

const p2 = (n: number) => String(n).padStart(2, '0');

export function localDe(min: number): string {
  const d = new Date(min * 60_000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** "HHMM" (hora do cadastro em texto de 4 dígitos) → minutos do dia. */
export function minutoDoDia(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):?([0-5]\d)$/.exec(hhmm.trim());
  if (!m) throw new Error(`Hora inválida: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export const DIA = 1_440;

/** Meia-noite (minutos) do dia da hora local. */
export const inicioDoDia = (min: number): number => Math.floor(min / DIA) * DIA;

/** Hora local acrescida do sufixo de fuso do legado (".0000-03:00", 100% na janela). */
export function utcLegado(localHora: string, segundos = '00'): string {
  return `${localHora.slice(0, 16)}:${segundos}.0000-03:00`;
}
