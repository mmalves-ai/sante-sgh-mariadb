/** Idade em anos completos na data (AAAA-MM-DD); null sem nascimento válido. */
export function idadeNaData(nascimento: string | null, data: string): number | null {
  if (!nascimento || !/^\d{4}-\d{2}-\d{2}$/.test(nascimento) || nascimento > data) return null;
  const [an, mn, dn] = nascimento.split('-').map(Number) as [number, number, number];
  const [ah, mh, dh] = data.split('-').map(Number) as [number, number, number];
  let idade = ah - an;
  if (mh < mn || (mh === mn && dh < dn)) idade--;
  return idade;
}
