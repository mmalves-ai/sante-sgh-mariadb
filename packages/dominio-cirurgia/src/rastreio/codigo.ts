// Código anônimo do painel para familiares (ficha do M46, regra 5; seção 6, SGH_CC_PAINEL_CODIGO): sorteado (nunca
// derivado do paciente, do prontuário, do atendimento nem do agendamento), fácil de ler em voz alta e na TV: três letras
// e três algarismos ("KMR-482"), sem os caracteres que se confundem (0/O, 1/I/L, 5/S, 2/Z, 8/B). Único no dia do
// estabelecimento (a chave do banco confere; colidiu, sorteia de novo). Válido até o fim do dia da entrada no bloco.
const LETRAS = 'ACDEFGHJKMNPQRTUVWXY';
const ALGARISMOS = '3479';
const ALGARISMOS_TODOS = '34679';

/** Fonte de aleatoriedade (o servidor passa crypto.randomBytes; o teste, uma sequência fixa). */
export type Sorteio = (n: number) => Uint8Array;

export const FORMATO_CODIGO_PAINEL = /^[ACDEFGHJKMNPQRTUVWXY]{3}-[34679]{3}$/;

export function gerarCodigoPainel(sortear: Sorteio): string {
  const b = sortear(6);
  const l = (i: number) => LETRAS[b[i]! % LETRAS.length]!;
  const d = (i: number, alfabeto: string) => alfabeto[b[i]! % alfabeto.length]!;
  return `${l(0)}${l(1)}${l(2)}-${d(3, ALGARISMOS)}${d(4, ALGARISMOS_TODOS)}${d(5, ALGARISMOS_TODOS)}`;
}

/** O fim do dia (a validade do código): "AAAA-MM-DDT23:59". */
export function validadeDoCodigo(dia: string): string {
  return `${dia}T23:59`;
}
