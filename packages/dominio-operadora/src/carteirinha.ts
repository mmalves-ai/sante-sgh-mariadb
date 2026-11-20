// Carteirinha do beneficiário (M56.2, fatia F1; ficha, seção 6): o número é o registro da operadora na ANS (6 dígitos),
// a sequência do beneficiário (9 dígitos, da sequência SGH_ da operadora) e um dígito verificador (módulo 11), 16
// dígitos que não mudam entre as vias (é o número que vai na guia TISS). A segunda via aumenta a via e pede o motivo do
// domínio; só o beneficiário ativo recebe via nova. A validade da via é o fim do contrato de prazo determinado ou 24
// meses da emissão (D-CART-VALIDADE-56).

export const DIGITOS_CARTEIRINHA = 16;
/** Meses de validade da via sem fim de contrato. */
export const MESES_VALIDADE_CARTEIRINHA = 24;

function digitoModulo11(base: string): number {
  let s = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    s += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = 11 - (s % 11);
  return r >= 10 ? 0 : r;
}

/** Número da carteirinha a partir do registro da operadora e da sequência do beneficiário. */
export function numeroCarteirinha(registroOperadora: string, sequencia: number): string {
  const r = registroOperadora.replace(/\D/g, '');
  if (!/^\d{6}$/.test(r)) throw new Error('Registro da operadora na ANS inválido.');
  if (!Number.isInteger(sequencia) || sequencia < 1 || sequencia > 999_999_999)
    throw new Error('Sequência da carteirinha fora da faixa.');
  const base = `${r}${String(sequencia).padStart(9, '0')}`;
  return `${base}${digitoModulo11(base)}`;
}

/** O número tem 16 dígitos e o verificador confere? */
export function carteirinhaValida(v: string): boolean {
  const c = v.replace(/\D/g, '');
  return c.length === DIGITOS_CARTEIRINHA && digitoModulo11(c.slice(0, 15)) === Number(c[15]);
}

/** Carteirinha formatada para a impressão (`000000 000000000 0`). */
export function formatarCarteirinha(v: string): string {
  const c = v.replace(/\D/g, '');
  return c.length === DIGITOS_CARTEIRINHA ? `${c.slice(0, 6)} ${c.slice(6, 15)} ${c.slice(15)}` : v;
}

export type ProblemaCarteirinha =
  'beneficiario-inativo' | 'segunda-via-sem-motivo' | 'motivo-invalido' | 'primeira-via-ja-emitida';

/** Pedido de via: a primeira só sem nenhuma emitida; da segunda em diante, com o motivo do domínio. */
export function problemasDoPedidoDeVia(
  b: { readonly situacao: string; readonly viasEmitidas: number },
  motivo: number | null,
  motivosValidos: readonly number[],
): ProblemaCarteirinha[] {
  const p: ProblemaCarteirinha[] = [];
  if (b.situacao !== 'ativo') p.push('beneficiario-inativo');
  if (b.viasEmitidas === 0) {
    if (motivo !== null) p.push('primeira-via-ja-emitida');
    return p;
  }
  if (motivo === null) p.push('segunda-via-sem-motivo');
  else if (!motivosValidos.includes(motivo)) p.push('motivo-invalido');
  return p;
}

/** Soma meses a uma data AAAA-MM-DD (o dia que não existe vai para o último do mês). */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Validade da via emitida na data: o fim do contrato de prazo determinado, ou 24 meses (o que vier antes). */
export function validadeDaVia(emissao: string, fimContrato: string | null): string {
  const padrao = somarMeses(emissao, MESES_VALIDADE_CARTEIRINHA);
  return fimContrato && fimContrato < padrao ? fimContrato : padrao;
}
