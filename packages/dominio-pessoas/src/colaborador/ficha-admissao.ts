// Ficha da admissão (C1-111, 07-RH; eSocial S-2200): o que o vínculo de trabalho exige da pessoa e do contrato além do
// CPF, do cargo e da lotação. Regras puras, conferidas na tela (na hora) e de novo no servidor antes de gravar:
// nascimento real e idade mínima para o trabalho na data da admissão (CF, art. 7º, XXXIII: 16 anos, 14 como aprendiz),
// grau de instrução no código oficial (01 a 12) e salário positivo. E a sugestão do tipo de dependente do eSocial
// (tabela 07) pela idade: o parentesco não basta (filho até 21 anos, universitário até 24), então a tela sugere e o
// usuário confirma.
import { diasEntre } from '../datas.js';

/** Idade mínima para qualquer vínculo (aprendiz); abaixo de 16 só como aprendiz, o que a categoria do eSocial diz. */
export const IDADE_MINIMA_TRABALHO = 14;
/** Grau de instrução: código oficial de 2 dígitos, 01 (analfabeto) a 12 (doutorado). */
export const CODIGOS_GRAU_INSTRUCAO = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
] as const;

export interface FichaAdmissao {
  readonly nascimento: string | null | undefined;
  readonly admissao: string;
  readonly grauInstrucao: string | null | undefined;
  readonly salario: number | null | undefined;
}

export type ResultadoFicha =
  | { readonly ok: true }
  | { readonly ok: false; readonly recusa: string; readonly mensagem: string; readonly campo: string };

/** Idade em anos completos no dia (datas ISO AAAA-MM-DD). */
export function idadeEm(nascimento: string, dia: string): number {
  const [an, mn, dn] = nascimento.split('-').map(Number) as [number, number, number];
  const [ad, md, dd] = dia.split('-').map(Number) as [number, number, number];
  return ad - an - (md < mn || (md === mn && dd < dn) ? 1 : 0);
}

/** Confere a ficha da admissão; a primeira falha volta com o campo (a tela marca o campo). */
export function conferirFichaAdmissao(f: FichaAdmissao): ResultadoFicha {
  const falha = (recusa: string, mensagem: string, campo: string): ResultadoFicha => ({
    ok: false,
    recusa,
    mensagem,
    campo,
  });
  if (!f.nascimento) return falha('nascimento-obrigatorio', 'Informe a data de nascimento.', 'nascimento');
  if (diasEntre(f.admissao, f.nascimento) >= 0)
    return falha('nascimento-invalido', 'O nascimento vem antes da admissão.', 'nascimento');
  if (idadeEm(f.nascimento, f.admissao) < IDADE_MINIMA_TRABALHO)
    return falha(
      'idade-minima',
      `Na admissão a pessoa precisa ter ao menos ${IDADE_MINIMA_TRABALHO} anos (aprendiz; 16 nos demais casos).`,
      'nascimento',
    );
  if (!f.grauInstrucao || !(CODIGOS_GRAU_INSTRUCAO as readonly string[]).includes(f.grauInstrucao))
    return falha('grau-instrucao-invalido', 'Escolha o grau de instrução.', 'grauInstrucao');
  if (f.salario === null || f.salario === undefined || !Number.isFinite(f.salario) || f.salario <= 0)
    return falha('salario-invalido', 'Informe o salário do contrato (maior que zero).', 'salario');
  if (Math.round(f.salario * 100) !== f.salario * 100)
    return falha('salario-invalido', 'O salário tem no máximo duas casas decimais.', 'salario');
  return { ok: true };
}

/** Sugestão do tipo de dependente (tabela 07 do eSocial) pela idade no dia; null: o parentesco escolhido serve. */
export interface SugestaoTipoDependente {
  readonly sugerido: string;
  readonly motivo: string;
}

export function sugerirTipoDependente(
  parentesco: string,
  nascimento: string,
  dia: string,
): SugestaoTipoDependente | null {
  const idade = idadeEm(nascimento, dia);
  if (parentesco === '03' && idade > 21)
    return {
      sugerido: '04',
      motivo: `Filho(a) com ${idade} anos: até 24 anos só como universitário(a) ou em escola técnica (tipo 04).`,
    };
  if (parentesco === '04' && idade <= 21)
    return { sugerido: '03', motivo: `Filho(a) com ${idade} anos é dependente pelo tipo 03.` };
  if (parentesco === '04' && idade > 24)
    return {
      sugerido: '11',
      motivo: `Filho(a) com ${idade} anos só segue dependente se incapaz, com tutela ou curatela (tipo 11).`,
    };
  if (parentesco === '10' && idade >= 18)
    return { sugerido: '99', motivo: `A guarda do menor acaba aos 18 anos (${idade} anos hoje).` };
  return null;
}
