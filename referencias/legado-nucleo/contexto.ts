// Contexto rede + estabelecimento (ARQ-2; roteiro, seção 4.4; ADR 0011). Os códigos vêm da
// configuração (ARQ-1): nada de union fixa de códigos. A rede é resolvida pelo endereço de acesso (M05),
// nunca por dado enviado pelo cliente; cache, filas, arquivos e logs levam o código da rede.
import { FORMATO_CODIGO, FORMATO_REDE } from './estabelecimentos.js';

/** Código da rede (ex.: a Rede Santé); resolvido pelo endereço de acesso. */
export type CodigoRede = string;
/** Código do estabelecimento (ARQ-1), da sessão: escolhe o pool. */
export type CodigoEstabelecimento = string;

export interface ContextoLegado {
  readonly rede: CodigoRede;
  readonly hospital: CodigoEstabelecimento;
  /** TBUSERS.NOME de quem opera (sensível a maiúsculas); obrigatório nas escritas (M04/M05). */
  readonly usuarioLegado?: string;
  /** ID_TBEMPHOS ativo na sessão (M05). */
  readonly estabelecimento?: number;
  /** Obrigatório em operação de escrita chamada pela API (M04). */
  readonly idempotencyKey?: string;
  readonly traceId: string;
  /**
   * M59-F1 (regra 4): módulo do banco (o grupo do adaptador dono da receita ou da consulta). Com ele, a transação usa
   * a conta do módulo (`SGH_APP_<MODULO>`, papel `SGH_MOD_<MODULO>`) quando a TI já a configurou; sem ele, ou sem a
   * conta, a conta única do estabelecimento.
   */
  readonly modulo?: string;
}

export class ErroContexto extends Error {
  override readonly name = 'ErroContexto';
}

export function conferirContexto(ctx: Partial<ContextoLegado>): ContextoLegado {
  if (typeof ctx.rede !== 'string' || !FORMATO_REDE.test(ctx.rede)) {
    throw new ErroContexto('Contexto sem código de rede válido.');
  }
  if (typeof ctx.hospital !== 'string' || !FORMATO_CODIGO.test(ctx.hospital)) {
    throw new ErroContexto('Contexto sem código de estabelecimento válido.');
  }
  if (typeof ctx.traceId !== 'string' || ctx.traceId === '') {
    throw new ErroContexto('Contexto sem traceId.');
  }
  return ctx as ContextoLegado;
}

/** Resolve a rede pelo endereço de acesso (Host). null: endereço desconhecido (a requisição é recusada). */
export interface ResolvedorRede {
  resolver(host: string): CodigoRede | null;
}

const LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Implementação de dev: localhost → REDE_PADRAO. O cadastro de redes do deploy implementa a mesma interface. */
export function resolvedorRedeDev(redePadrao: CodigoRede | null): ResolvedorRede {
  return {
    resolver(host: string): CodigoRede | null {
      const semPorta = host.trim().toLowerCase().replace(/:\d+$/, '');
      return redePadrao !== null && LOCAIS.has(semPorta) ? redePadrao : null;
    },
  };
}

export type TipoChave = 'cache' | 'fila' | 'arquivo' | 'log' | 'trava';

/**
 * Chave de cache, fila, arquivo, trava ou log: sempre começa pelo código da rede (ARQ-2). Falha se a
 * rede faltar ou for inválida, para que nenhuma chave seja montada sem ela.
 */
export function chaveDaRede(
  rede: CodigoRede | undefined | null,
  tipo: TipoChave,
  ...partes: string[]
): string {
  if (typeof rede !== 'string' || !FORMATO_REDE.test(rede)) {
    throw new ErroContexto(`Chave de ${tipo} montada sem o código da rede.`);
  }
  if (partes.length === 0 || partes.some((p) => p === '' || /[\s/:]/.test(p))) {
    throw new ErroContexto(`Chave de ${tipo} com parte vazia ou com separador.`);
  }
  return tipo === 'arquivo' ? [rede, ...partes].join('/') : [rede, tipo, ...partes].join(':');
}

/** Chave do contexto (rede + estabelecimento + partes). */
export function chaveDoContexto(
  ctx: Pick<ContextoLegado, 'rede' | 'hospital'>,
  tipo: TipoChave,
  ...partes: string[]
): string {
  return chaveDaRede(ctx.rede, tipo, ctx.hospital, ...partes);
}

/** Campos fixos de log (pino): rede, estabelecimento e traceId; nunca dado pessoal. */
export function camposDeLog(
  ctx: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>,
): Record<string, string> {
  conferirContexto(ctx);
  return { rede: ctx.rede, estabelecimento: ctx.hospital, traceId: ctx.traceId };
}
