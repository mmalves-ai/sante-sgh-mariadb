// Formatos da agenda na tela: datas dd/mm/aaaa, horas HH:MM e a hora digitada (com ou sem os dois-pontos) para o
// contrato, que recebe sempre "HH:MM".

/** AAAA-MM-DD → dd/mm/aaaa (texto vazio fica vazio). */
export function dataBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Hora para exibir: "HH:MM" (a hora sem os dois-pontos também é aceita); o resto volta como veio. */
export function horaBr(h: string | null | undefined): string {
  if (!h) return '';
  return horaDoContrato(h) ?? h;
}

/** Hora digitada ("08:15", "0815", "8:15" ou "815") → "HH:MM" do contrato; null quando inválida. */
export function horaDoContrato(h: string | null | undefined): string | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec((h ?? '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh <= 23 && mm <= 59 ? `${String(hh).padStart(2, '0')}:${m[2]}` : null;
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
