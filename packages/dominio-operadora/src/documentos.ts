// Documentos da operadora e do beneficiário (M56.2, fatia F1): CPF, CNPJ e CNS conferidos pelo dígito antes de gravar
// em SGH_OPE_*, a máscara do CPF nas listas (regra comum 6 da Fase 6: dado pessoal mascarado em lista) e o nome
// normalizado da busca (maiúsculas, sem acento). Puro; nenhum valor real nos testes.

const so = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

/** CPF com 11 dígitos e os dois verificadores (sequências repetidas recusadas). */
export function cpfValido(v: string | null | undefined): boolean {
  const c = so(v);
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

/** CNPJ numérico com 14 dígitos e os dois verificadores (sequências repetidas recusadas). */
export function cnpjValido(v: string | null | undefined): boolean {
  const c = so(v);
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (pesos[i] as number);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

/**
 * Cartão Nacional de Saúde: 15 dígitos; o definitivo (começa por 1 ou 2) pelo cálculo a partir dos 11 primeiros, o
 * provisório (7, 8 ou 9) pela soma ponderada múltipla de 11.
 */
export function cnsValido(v: string | null | undefined): boolean {
  const c = so(v);
  if (!/^\d{15}$/.test(c)) return false;
  const soma = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (15 - i);
    return s;
  };
  if (c[0] === '1' || c[0] === '2') {
    let s = soma(11);
    let dv = 11 - (s % 11);
    if (dv === 11) dv = 0;
    let esperado: string;
    if (dv === 10) {
      s += 2;
      dv = 11 - (s % 11);
      esperado = `${c.slice(0, 11)}001${dv}`;
    } else esperado = `${c.slice(0, 11)}000${dv}`;
    return esperado === c;
  }
  if (c[0] === '7' || c[0] === '8' || c[0] === '9') return soma(15) % 11 === 0;
  return false;
}

/** CPF mascarado para lista: só os seis dígitos do meio (`***.456.789-**`). */
export function mascararCpfBeneficiario(v: string | null | undefined): string | null {
  const c = so(v);
  if (c.length !== 11) return null;
  return `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**`;
}

/** Documento do contratante mascarado para lista (CPF como acima; CNPJ inteiro: é de empresa). */
export function mascararDocumentoContratante(v: string | null | undefined): string {
  const c = so(v);
  if (c.length === 14)
    return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  return mascararCpfBeneficiario(c) ?? '';
}

/** Nome para a busca pelo início: maiúsculas, sem acento, espaços simples (até 60 caracteres). */
export function nomeDeBusca(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}
