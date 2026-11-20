// Apoio da tela da agenda de sessões (M50, etapa 6): os dias da grade, a hora e o dia em texto curto e a busca na grade.
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Os dias [de, ate) da grade, com o rótulo curto ("seg 01/03"). */
export function diasDaGrade(de: string, ate: string): { dia: string; rotulo: string }[] {
  const r: { dia: string; rotulo: string }[] = [];
  for (let t = Date.parse(`${de}T00:00:00Z`); t < Date.parse(`${ate}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    const dia = d.toISOString().slice(0, 10);
    r.push({ dia, rotulo: `${DIAS_SEMANA[d.getUTCDay()]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}` });
  }
  return r;
}

/** "AAAA-MM-DDTHH:MM" → "HH:MM". */
export const hora = (instante: string) => instante.slice(11, 16);
/** "AAAA-MM-DDTHH:MM" → "DD/MM HH:MM". */
export const quando = (instante: string) =>
  `${instante.slice(8, 10)}/${instante.slice(5, 7)} ${instante.slice(11, 16)}`;

/** A sessão bate com a busca (nome, prontuário ou plano), sem diferença de acento nem de caixa. */
export function combinaBusca(busca: string, campos: readonly (string | number | null)[]): boolean {
  const n = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toUpperCase()
      .trim();
  const b = n(busca);
  return !b || campos.some((c) => c !== null && n(String(c)).includes(b));
}

/** Soma dias a "AAAA-MM-DD". */
export const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
