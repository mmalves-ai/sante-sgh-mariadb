// Regras puras das telas do financeiro (sem rede nem estado): datas, parcelas iguais em centavos e o CSV exportado.
/** Soma de dias numa data AAAA-MM-DD (meio-dia UTC: sem salto de horário de verão). */
export function somarDias(d: string, n: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** Soma de meses numa data AAAA-MM-DD, preso ao último dia do mês. */
export function somarMeses(d: string, n: number): string {
  const [a, m, dia] = d.split('-').map(Number);
  const alvo = new Date(Date.UTC(a!, m! - 1 + n, 1, 12));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0, 12)).getUTCDate();
  alvo.setUTCDate(Math.min(dia!, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/**
 * Parcelas iguais em centavos (a diferença do arredondamento vai na última), com o vencimento mês a mês: a soma
 * das parcelas fecha o valor do documento (o servidor recusa a que não fecha).
 */
export function dividirParcelas(
  valor: number,
  quantas: number,
  primeiroVencimento: string,
): { parcela: number; vencimento: string; valor: number }[] {
  const n = Math.max(1, Math.min(120, Math.trunc(quantas)));
  const total = Math.round(valor * 100);
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => ({
    parcela: i + 1,
    vencimento: somarMeses(primeiroVencimento, i),
    valor: (i === n - 1 ? total - base * (n - 1) : base) / 100,
  }));
}

/** Exporta linhas em CSV (separador ponto e vírgula, decimal com vírgula), como a planilha do usuário abre. */
export function paraCsv(
  cabecalho: readonly string[],
  linhas: readonly (readonly (string | number)[])[],
): string {
  const campo = (v: string | number) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cabecalho, ...linhas].map((l) => l.map(campo).join(';')).join('\r\n');
}
