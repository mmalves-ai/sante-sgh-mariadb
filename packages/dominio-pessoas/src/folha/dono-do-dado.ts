// Dono de cada dado do colaborador (M53; ficha, regra 4; cap-07 §7.1.1). Enquanto a exportação para folha externa
// existir (M53-F0), o sistema externo é dono dos dados contratuais (salário, rubricas, encargos) e o Sante SGH dos
// assistenciais (conselho, escala, habilitação). Com a folha do Sante SGH ligada (chave `pessoas.folha`), o Sante SGH é
// dono de ambos. Quem não é dono só lê: a tela mostra o campo sem edição e o retorno não pode sobrescrevê-lo.

/** Grupos de dado do colaborador que a interface separa. */
export const GRUPOS_DADO_COLABORADOR = {
  contratual: ['salario', 'rubricas', 'encargos', 'matriculaExterna', 'liquido'],
  assistencial: ['conselho', 'escala', 'habilitacao', 'plantao', 'ponto', 'lotacao'],
} as const;
export type GrupoDadoColaborador = keyof typeof GRUPOS_DADO_COLABORADOR;
export type CampoDadoColaborador = (typeof GRUPOS_DADO_COLABORADOR)[GrupoDadoColaborador][number];

export type DonoDado = 'sante' | 'folha-externa';

/** Grupo do campo (todo campo pertence a exatamente um grupo). */
export function grupoDoCampo(campo: CampoDadoColaborador): GrupoDadoColaborador {
  return (GRUPOS_DADO_COLABORADOR.contratual as readonly string[]).includes(campo)
    ? 'contratual'
    : 'assistencial';
}

/** Regra 4: quem é dono do campo, conforme a folha do Sante SGH esteja ligada ou não. */
export function donoDoCampo(campo: CampoDadoColaborador, folhaPropriaLigada: boolean): DonoDado {
  if (folhaPropriaLigada) return 'sante';
  return grupoDoCampo(campo) === 'contratual' ? 'folha-externa' : 'sante';
}

/** O Sante SGH pode editar o campo? (só quando é o dono). */
export function santePodeEditar(campo: CampoDadoColaborador, folhaPropriaLigada: boolean): boolean {
  return donoDoCampo(campo, folhaPropriaLigada) === 'sante';
}

/**
 * Campos que um retorno da folha externa tentou trazer e que o Sante SGH não aceita dele (são do Sante SGH): a
 * importação recusa o lote inteiro se a lista não vier vazia.
 */
export function camposRecusadosNoRetorno(
  campos: readonly CampoDadoColaborador[],
  folhaPropriaLigada: boolean,
): CampoDadoColaborador[] {
  return campos.filter((c) => donoDoCampo(c, folhaPropriaLigada) === 'sante');
}
