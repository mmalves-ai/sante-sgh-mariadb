// Razão de mortalidade padronizada (ficha do M45, regra 5; RDC 7/2010, art. 48): SMR = óbitos observados ÷ óbitos
// esperados (a soma das mortalidades esperadas do APACHE II validado de cada internação com o desfecho conhecido), com as
// parcelas impressas. Internação ainda aberta fica fora da conta (contada à parte). Uma internação conta uma vez: o
// primeiro índice validado dela (o da admissão na UTI). Puro.
export interface ParcelaSmr {
  readonly id: number;
  readonly reg: number | null;
  readonly mortalidade: number;
  /** null: a internação ainda não terminou (fora da conta). */
  readonly obito: boolean | null;
  readonly coletadoEm: string;
}

export interface ResultadoSmr {
  readonly indices: number;
  readonly comDesfecho: number;
  readonly semDesfecho: number;
  readonly obitosObservados: number;
  readonly obitosEsperados: number;
  readonly smr: number | null;
  readonly parcelas: readonly { id: number; reg: number | null; mortalidade: number; obito: boolean }[];
  readonly conta: string;
}

const fmt = (n: number, casas = 2) => n.toFixed(casas).replace('.', ',');

export function calcularSmr(entrada: readonly ParcelaSmr[]): ResultadoSmr {
  // O primeiro índice validado de cada internação (o da admissão na UTI).
  const porInternacao = new Map<string, ParcelaSmr>();
  for (const p of [...entrada].sort((a, b) => a.coletadoEm.localeCompare(b.coletadoEm) || a.id - b.id)) {
    const k = p.reg === null ? `i${p.id}` : `r${p.reg}`;
    if (!porInternacao.has(k)) porInternacao.set(k, p);
  }
  const unicos = [...porInternacao.values()];
  const conhecidas = unicos.filter((p) => p.obito !== null) as (ParcelaSmr & { obito: boolean })[];
  const obs = conhecidas.filter((p) => p.obito).length;
  const esp = Math.round(conhecidas.reduce((s, p) => s + p.mortalidade, 0) * 10_000) / 10_000;
  const smr = esp > 0 ? Math.round((obs / esp) * 100) / 100 : null;
  const soma = conhecidas.map((p) => fmt(p.mortalidade)).join(' + ') || '0';
  const conta =
    smr === null
      ? `Sem óbito esperado no período (${conhecidas.length} internação(ões) com desfecho): a SMR não se calcula.`
      : `SMR = ${obs} óbito(s) observado(s) ÷ ${fmt(esp)} esperado(s) (${soma}) = ${fmt(smr)}`;
  return {
    indices: unicos.length,
    comDesfecho: conhecidas.length,
    semDesfecho: unicos.length - conhecidas.length,
    obitosObservados: obs,
    obitosEsperados: esp,
    smr,
    parcelas: conhecidas.map((p) => ({ id: p.id, reg: p.reg, mortalidade: p.mortalidade, obito: p.obito })),
    conta,
  };
}
