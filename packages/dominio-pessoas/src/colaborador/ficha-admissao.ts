// Ficha da admissão (C1-111, 07-RH; eSocial S-2200): o que o vínculo de trabalho exige da pessoa e do contrato além do
// CPF, do cargo e da lotação. Regras puras, conferidas na tela (na hora) e de novo no servidor antes de gravar:
// nascimento real e idade mínima para o trabalho na data da admissão (CF, art. 7º, XXXIII: 16 anos, 14 como aprendiz),
// grau de instrução no código oficial (01 a 12) e salário positivo. E a sugestão do tipo de dependente do eSocial
// (tabela 07) pela idade: o parentesco não basta (filho até 21 anos, universitário até 24), então a tela sugere e o
// usuário confirma.
import { diasEntre } from '../datas.js';

/** Idade mínima para o trabalho (CF, art. 7º, XXXIII): 16 anos; 14 só como aprendiz (categoria 103 do eSocial). */
export const IDADE_MINIMA_TRABALHO = 16;
export const IDADE_MINIMA_APRENDIZ = 14;
/** Código da categoria do trabalhador no eSocial (tabela 01) para o aprendiz. */
export const CATEGORIA_APRENDIZ = '103';
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
  /**
   * Código eSocial da categoria escolhida (tabela 01, ex. '101', '103'). undefined: ainda não escolhida; a idade de 14 a
   * 15 anos só passa com a categoria de aprendiz, conferida por {@link conferirIdadeCategoria} (o servidor sempre cruza).
   */
  readonly categoriaEsocial?: string | null | undefined;
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
  if (idadeEm(f.nascimento, f.admissao) < IDADE_MINIMA_APRENDIZ)
    return falha(
      'idade-minima',
      `Na admissão a pessoa precisa ter ao menos ${IDADE_MINIMA_APRENDIZ} anos (aprendiz; ${IDADE_MINIMA_TRABALHO} nos demais casos).`,
      'nascimento',
    );
  if (!f.grauInstrucao || !(CODIGOS_GRAU_INSTRUCAO as readonly string[]).includes(f.grauInstrucao))
    return falha('grau-instrucao-invalido', 'Escolha o grau de instrução.', 'grauInstrucao');
  if (f.salario === null || f.salario === undefined || !Number.isFinite(f.salario) || f.salario <= 0)
    return falha('salario-invalido', 'Informe o salário do contrato (maior que zero).', 'salario');
  // Duas casas conferidas com tolerância: em ponto flutuante 1024.09 * 100 não dá 102409 exato.
  if (Math.abs(Math.round(f.salario * 100) - f.salario * 100) > 1e-6)
    return falha('salario-invalido', 'O salário tem no máximo duas casas decimais.', 'salario');
  if (f.categoriaEsocial !== undefined) {
    const c = conferirIdadeCategoria(f.nascimento, f.admissao, f.categoriaEsocial);
    if (!c.ok) return c;
  }
  return { ok: true };
}

/**
 * Abaixo de 16 anos, só aprendiz (CF, art. 7º, XXXIII; categoria 103 do eSocial). A categoria vem do catálogo; sem ela
 * a pessoa de 14 ou 15 anos não passa.
 */
export function conferirIdadeCategoria(
  nascimento: string,
  admissao: string,
  categoriaEsocial: string | null,
): ResultadoFicha {
  if (idadeEm(nascimento, admissao) >= IDADE_MINIMA_TRABALHO || categoriaEsocial === CATEGORIA_APRENDIZ)
    return { ok: true };
  return {
    ok: false,
    recusa: 'idade-minima-aprendiz',
    mensagem: `Abaixo de ${IDADE_MINIMA_TRABALHO} anos a admissão só vale como aprendiz (categoria ${CATEGORIA_APRENDIZ} do eSocial).`,
    campo: 'categoria',
  };
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
