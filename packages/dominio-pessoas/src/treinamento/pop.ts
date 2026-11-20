// Ciência de POP versionado, fatia F6 (M52.6; ficha, regra 20; RDC 63/2011 (RDC63-05)): cada procedimento operacional
// padrão tem um código e versões numeradas; publicar uma versão nova substitui a anterior (que nunca é apagada) e exige
// a ciência de novo de todo colaborador alcançado (o estabelecimento inteiro ou a unidade do POP). A ciência é do
// próprio colaborador, de uma versão vigente, uma vez só; ela nunca é apagada (só inclusão).
import { diasEntre } from '../datas.js';
import { type RecusaSesmt, recusaSesmt } from '../sesmt/recusa.js';

export type SituacaoPop = 'vigente' | 'substituido' | 'revogado';

export interface PopVersaoLida {
  readonly id: number;
  readonly codigo: string;
  readonly versao: number;
  readonly unidade: number | null;
  readonly vigencia: string;
  readonly situacao: SituacaoPop;
}

/** A próxima versão do código: a maior + 1 (a primeira é 1). */
export function proximaVersaoPop(versoes: readonly Pick<PopVersaoLida, 'versao'>[]): number {
  return versoes.reduce((m, v) => Math.max(m, v.versao), 0) + 1;
}

/** A versão vigente do código (no máximo uma), ou null. */
export function vigenteDoCodigo<T extends PopVersaoLida>(versoes: readonly T[]): T | null {
  return versoes.find((v) => v.situacao === 'vigente') ?? null;
}

export interface EntradaVersaoPop {
  readonly vigencia: string;
  readonly unidade: number | null;
  readonly alteracoes: string | null;
}

/**
 * A versão nova: vigência a partir de hoje (até 30 dias para trás, a publicação atrasada de um POP já em uso) e não
 * antes da vigente; da segunda versão em diante, o resumo das alterações é obrigatório; a unidade do POP não muda
 * entre as versões (um POP de outra unidade é outro código).
 */
export function conferirVersaoPop(
  e: EntradaVersaoPop,
  versoes: readonly PopVersaoLida[],
  hoje: string,
): RecusaSesmt | null {
  if (diasEntre(e.vigencia, hoje) > 30)
    return recusaSesmt(
      'vigencia-passada',
      'A vigência fica mais de 30 dias no passado: confira a data.',
      'vigencia',
    );
  const atual = vigenteDoCodigo(versoes);
  if (atual && e.vigencia < atual.vigencia)
    return recusaSesmt(
      'vigencia-anterior',
      'A vigência da versão nova vem antes da vigência da versão atual.',
      'vigencia',
    );
  if (versoes.length > 0 && !(e.alteracoes && e.alteracoes.trim().length >= 10))
    return recusaSesmt(
      'alteracoes-obrigatorias',
      'Descreva o que mudou em relação à versão anterior (pelo menos 10 caracteres).',
      'alteracoes',
    );
  const primeira = versoes[0];
  if (primeira && primeira.unidade !== e.unidade)
    return recusaSesmt(
      'unidade-diferente',
      'A unidade do POP não muda entre as versões: um POP de outra unidade tem outro código.',
      'unidade',
    );
  return null;
}

/** Revogar: só a versão vigente, com motivo (o POP deixa de valer e ninguém mais precisa dar ciência). */
export function conferirRevogacaoPop(v: Pick<PopVersaoLida, 'situacao'>): RecusaSesmt | null {
  if (v.situacao !== 'vigente')
    return recusaSesmt('versao-nao-vigente', 'Só a versão vigente pode ser revogada.', 'pop');
  return null;
}

/** O POP alcança o colaborador: o do estabelecimento (sem unidade) alcança todos; o da unidade, só os lotados nela. */
export function popAlcanca(p: Pick<PopVersaoLida, 'unidade'>, unidade: number | null): boolean {
  return p.unidade === null || p.unidade === unidade;
}

export interface CienciaPedida {
  /** O vínculo é de quem está logado (a ciência é sempre do próprio colaborador). */
  readonly proprio: boolean;
  /** O colaborador já deu ciência nesta versão. */
  readonly jaCiente: boolean;
  readonly unidadeDoColaborador: number | null;
  readonly desligado: boolean;
}

/** A ciência: do próprio colaborador ativo, numa versão vigente que o alcança, uma vez só. */
export function conferirCienciaPop(
  p: Pick<PopVersaoLida, 'situacao' | 'unidade'>,
  c: CienciaPedida,
): RecusaSesmt | null {
  if (!c.proprio)
    return recusaSesmt('ciencia-so-propria', 'A ciência do POP é dada pelo próprio colaborador.', 'vinculo');
  if (c.desligado) return recusaSesmt('colaborador-desligado', 'O vínculo está desligado.', 'vinculo');
  if (p.situacao !== 'vigente')
    return recusaSesmt(
      'versao-nao-vigente',
      'Esta versão do POP não está mais vigente: abra a versão atual.',
      'pop',
    );
  if (!popAlcanca(p, c.unidadeDoColaborador))
    return recusaSesmt('pop-de-outra-unidade', 'Este POP é de outra unidade.', 'pop');
  if (c.jaCiente) return recusaSesmt('ja-ciente', 'Você já deu ciência nesta versão do POP.', 'pop');
  return null;
}

/** Os POPs vigentes que alcançam o colaborador e ainda não têm a ciência dele (na versão vigente). */
export function popsPendentes<T extends PopVersaoLida>(
  vigentes: readonly T[],
  unidade: number | null,
  cientes: ReadonlySet<number>,
): T[] {
  return vigentes.filter((p) => p.situacao === 'vigente' && popAlcanca(p, unidade) && !cientes.has(p.id));
}

/** A adesão de uma versão: ciências sobre alcançados, em contagem e percentual inteiro (para o painel do gestor). */
export function adesaoPop(
  alcancados: number,
  cientes: number,
): { alcancados: number; cientes: number; percentual: number } {
  const c = Math.min(cientes, alcancados);
  return { alcancados, cientes: c, percentual: alcancados > 0 ? Math.floor((c * 100) / alcancados) : 0 };
}
