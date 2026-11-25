// Códigos do contrato da tela que não são a situação: o grupo de prioridade legal por número (GRUPOS_PRIORIDADE) ↔ o
// código do cadastro, a prioridade '0'/'1'/'2' (PRIORIDADES_SENHA), o tipo do gerador '0'/'5' (TIPOS_GERADOR) e o
// guichê 0 = nenhum. A situação da senha é nominal dos dois lados (SITUACOES_SENHA = senha_emitida.situacao) e não
// passa por tradução nenhuma.
import type { SenhaRecepcao, TipoServico } from './tipos.js';

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
    situacao: s.situacao,
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
