// Formatos da agenda na tela: datas dd/mm/aaaa, horas HH:MM e a hora digitada (HH:MM ou HHMM) para o contrato.

/** AAAA-MM-DD → dd/mm/aaaa (texto vazio fica vazio). */
export function dataBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** HHMM ou HH:MM → HH:MM. */
export function horaBr(h: string | null | undefined): string {
  if (!h) return '';
  const s = h.replace(':', '');
  return /^\d{4}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : h;
}

/** Hora digitada (HH:MM, HHMM ou H:MM) → HHMM do contrato; null quando inválida. */
export function horaDoContrato(h: string | null | undefined): string | null {
  const s = (h ?? '').trim().replace(':', '');
  const t = s.length === 3 ? `0${s}` : s;
  if (!/^\d{4}$/.test(t)) return null;
  const hh = Number(t.slice(0, 2));
  const mm = Number(t.slice(2));
  return hh <= 23 && mm <= 59 ? t : null;
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Percentual com uma casa (0,1234 ou 12,34 conforme a origem já em %). */
export function pctBr(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}
