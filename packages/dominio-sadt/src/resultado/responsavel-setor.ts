// Responsável pelo laudo do setor (F3.5, 05-SADT linha 25): o setor do diagnóstico pode nomear, com vigência, quem
// libera o resultado, para todos os exames do setor ou para um exame. Sem ninguém nomeado, vale só a habilitação pelo
// conselho e pelo CBO (o setor não fica travado). Com alguém nomeado para o exame, a nomeação do exame prevalece sobre a
// do setor; com alguém nomeado só para o setor, ela vale para todos os exames dele. Quem não está na lista que vale não
// libera nem retifica.

/** Uma nomeação vigente que libera resultado: exame nulo vale para o setor inteiro. */
export interface NomeacaoResponsavel {
  readonly profissional: number;
  readonly exame: number | null;
}

export type RecusaResponsavelSetor = 'fora-dos-responsaveis-setor';

export const MENSAGEM_RESPONSAVEL_SETOR: Readonly<Record<RecusaResponsavelSetor, string>> = {
  'fora-dos-responsaveis-setor':
    'Este exame só é liberado pelos responsáveis nomeados no setor. Peça a um deles ou ajuste a nomeação do setor.',
};

/** Os profissionais que podem liberar o exame; lista vazia: o setor não restringe (vale a habilitação). */
export function responsaveisQueValem(
  nomeacoes: readonly NomeacaoResponsavel[],
  exame: number,
): readonly number[] {
  const doExame = nomeacoes.filter((x) => x.exame === exame);
  const valem = doExame.length > 0 ? doExame : nomeacoes.filter((x) => x.exame === null);
  return [...new Set(valem.map((x) => x.profissional))];
}

/** Confere o profissional habilitado da sessão contra os responsáveis nomeados do setor para o exame. */
export function conferirResponsavelSetor(a: {
  readonly nomeacoes: readonly NomeacaoResponsavel[];
  readonly exame: number;
  readonly profissional: number | null;
}): RecusaResponsavelSetor | null {
  const valem = responsaveisQueValem(a.nomeacoes, a.exame);
  if (valem.length === 0) return null;
  return a.profissional !== null && valem.includes(a.profissional) ? null : 'fora-dos-responsaveis-setor';
}
