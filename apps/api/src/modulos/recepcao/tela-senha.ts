// Tradução da senha entre o vocabulário neutro da porta (situação nominal, guichê nulo, tipo do serviço por nome,
// grupo de prioridade por código) e o contrato da tela (SITUACOES_SENHA por letra, guichê 0 = nenhum, TIPOS_GERADOR
// '0'/'5', PRIORIDADES_SENHA '0'/'1'/'2', GRUPOS_PRIORIDADE por número). Só os serviços que montam a resposta da tela
// e as regras do contrato (decidirEvento, ordenarFila) usam esta tradução; a porta e o banco nunca.
// Pedido ao integrador (saida/01-01.json): trocar o contrato da tela pelo vocabulário neutro e apagar esta tradução.
import type { SenhaRecepcao, SituacaoSenha, TipoServico } from './tipos.js';

/**
 * Grupos de prioridade do contrato (GRUPOS_PRIORIDADE) ↔ o código do grupo no cadastro (grupo_prioridade_legal
 * .codigo). O grupo 2 (normal) não tem cadastro: senha sem prioridade.
 */
export const CODIGO_DO_GRUPO: Readonly<Record<number, string>> = {
  0: 'idoso_80',
  1: 'prioridade_legal',
  3: 'idoso_60',
  4: 'gestante',
  5: 'lactante',
  6: 'pessoa_deficiencia',
  7: 'crianca_colo',
  8: 'autismo',
  9: 'obesidade',
};
export const GRUPO_DO_CODIGO: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(CODIGO_DO_GRUPO).map(([g, c]) => [c, Number(g)]),
);

/** Grupo do contrato a partir do código do cadastro (sem par: null). */
export const grupoDaTela = (codigo: string | null): number | null =>
  codigo === null ? null : (GRUPO_DO_CODIGO[codigo] ?? null);

/** Prioridade do contrato ('0' acima de 80 anos, '1' prioridade legal, '2' normal). */
export function prioridadeDaTela(s: {
  readonly prioritaria: boolean;
  readonly grupo: string | null;
}): string {
  if (!s.prioritaria) return '2';
  return s.grupo === CODIGO_DO_GRUPO[0] ? '0' : '1';
}

/** Tipo do gerador no contrato (TIPOS_GERADOR): '5' serviços diversos; '0' os que abrem atendimento. */
export const tipoGeradorDaTela = (t: TipoServico): string => (t === 'diverso' ? '5' : '0');

/** Guichê no contrato (0 = nenhum). */
export const guicheDaTela = (g: number | null): number => g ?? 0;

/** Letra do contrato (SITUACOES_SENHA) a partir da situação nominal, do guichê e do local. */
export function letraDaSituacao(situacao: string, guiche: number | null, local: number | null): string {
  switch (situacao) {
    case 'aguardando':
      return 'G';
    case 'chamada':
      // Chamada pelo guichê continua "aguardando no guichê" (G com guichê); a chamada ao local é C.
      return (guiche ?? 0) > 0 || local === null ? 'G' : 'C';
    case 'em_atendimento':
    case 'encaminhada':
      return 'A';
    case 'suspensa':
    case 'nao_compareceu':
      return 'S';
    default:
      return 'L';
  }
}

/** Letra do contrato da senha. */
export const letraDaSenha = (s: Pick<SenhaRecepcao, 'situacao' | 'guiche' | 'local'>): string =>
  letraDaSituacao(s.situacao, s.guiche, s.local);

/** Situação nominal a gravar pela letra do efeito de um evento do contrato (decidirEvento). */
export function situacaoDaLetra(letra: string): SituacaoSenha {
  switch (letra) {
    case 'L':
      return 'atendida';
    case 'S':
      return 'suspensa';
    case 'A':
      return 'em_atendimento';
    case 'C':
      return 'chamada';
    default:
      return 'aguardando';
  }
}

/** A senha como as regras do contrato a veem (decidirEvento, ordenarFila e as listas da tela). */
export interface SenhaNaTela {
  readonly situacao: string;
  readonly guiche: number;
  readonly tipoGerador: string;
  readonly prioridade: string;
  readonly grupo: number | null;
}

export function senhaNaTela(s: SenhaRecepcao): SenhaNaTela {
  return {
    situacao: letraDaSenha(s),
    guiche: guicheDaTela(s.guiche),
    tipoGerador: tipoGeradorDaTela(s.tipoServico),
    prioridade: prioridadeDaTela(s),
    grupo: s.prioritaria ? grupoDaTela(s.grupo) : null,
  };
}

/** O serviço (gerador) no contrato da tela: tipo '0'/'5', limite e tempo-alvo 0 quando não há. */
export function geradorParaTela<
  G extends {
    readonly tipo: TipoServico;
    readonly limiteDia: number | null;
    readonly tempoAlvoMinutos: number | null;
  },
>(
  g: G,
): Omit<G, 'tipo' | 'limiteDia' | 'tempoAlvoMinutos'> & {
  tipo: string;
  limiteDia: number;
  tempoAlvoMinutos: number;
} {
  return {
    ...g,
    tipo: tipoGeradorDaTela(g.tipo),
    limiteDia: g.limiteDia ?? 0,
    tempoAlvoMinutos: g.tempoAlvoMinutos ?? 0,
  };
}
