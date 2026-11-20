// Documentos SINTÉTICOS da operadora (M56.2) para a sessão sintética de dev/ci e os testes: o dígito é calculado sobre
// uma base inventada, nunca um documento real copiado.

function dvCpf(base: string): string {
  let r = base;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(r[i]) * (n + 1 - i);
    const d = (s * 10) % 11;
    r += String(d === 10 ? 0 : d);
  }
  return r;
}

/** CPF sintético válido a partir de 9 dígitos inventados. */
export const cpfSintetico = (base9: string): string => dvCpf(base9);

/** CNPJ sintético válido a partir de 12 dígitos inventados. */
export function cnpjSintetico(base12: string): string {
  let r = base12;
  for (const pesos of [
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  ]) {
    let s = 0;
    pesos.forEach((p, i) => (s += Number(r[i]) * p));
    const d = s % 11;
    r += String(d < 2 ? 0 : 11 - d);
  }
  return r;
}

/** CNS provisório sintético (começa por 7, 8 ou 9): ajusta os dois últimos dígitos até a soma fechar em 11. */
export function cnsProvisorioSintetico(base13: string): string {
  for (let x = 0; x < 100; x++) {
    const c = `${base13}${String(x).padStart(2, '0')}`;
    let s = 0;
    for (let i = 0; i < 15; i++) s += Number(c[i]) * (15 - i);
    if (s % 11 === 0) return c;
  }
  throw new Error('base sem CNS provisório');
}

/** CNS definitivo sintético (começa por 1 ou 2) a partir de 11 dígitos inventados. */
export function cnsDefinitivoSintetico(base11: string): string {
  let s = 0;
  for (let i = 0; i < 11; i++) s += Number(base11[i]) * (15 - i);
  let dv = 11 - (s % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) {
    s += 2;
    dv = 11 - (s % 11);
    return `${base11}001${dv}`;
  }
  return `${base11}000${dv}`;
}
