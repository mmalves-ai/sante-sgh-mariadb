// Contexto de quem opera: cliente (o banco), estabelecimento, usuário e correlação. Vocabulário neutro (AGENTS,
// regra 3): ids numéricos, sem códigos do sistema de origem. O cliente escolhe o banco (cliente_<codigo>); o
// estabelecimento e o usuário vão à trilha e às colunas de auditoria.

/** Código do cliente na plataforma (plataforma.cliente.codigo). */
export const FORMATO_CLIENTE = /^[a-z][a-z0-9_]{1,39}$/;

export interface ContextoNucleo {
  readonly cliente: string;
  /** Estabelecimento ativo na sessão (estabelecimento.id); null para ações do cliente inteiro. */
  readonly estabelecimento: number | null;
  /** Usuário que opera (usuario.id); null para processo automático. */
  readonly usuario: number | null;
  /** Identificador da requisição ou da operação (até 64 caracteres). */
  readonly correlacao: string;
  readonly enderecoIp?: string;
}

export class ErroContexto extends Error {
  override readonly name = 'ErroContexto';
}

export function idPositivo(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

/** Confere o contexto (formato do cliente, ids e correlação); estabelecimento e usuário ausentes viram null. */
export function conferirContexto(ctx: Partial<ContextoNucleo>): ContextoNucleo {
  if (typeof ctx.cliente !== 'string' || !FORMATO_CLIENTE.test(ctx.cliente))
    throw new ErroContexto('Contexto sem cliente válido.');
  if (typeof ctx.correlacao !== 'string' || ctx.correlacao.trim() === '' || ctx.correlacao.length > 64)
    throw new ErroContexto('Contexto sem correlação válida (1 a 64 caracteres).');
  const estabelecimento = ctx.estabelecimento ?? null;
  const usuario = ctx.usuario ?? null;
  if (estabelecimento !== null && !idPositivo(estabelecimento))
    throw new ErroContexto('Estabelecimento do contexto inválido.');
  if (usuario !== null && !idPositivo(usuario)) throw new ErroContexto('Usuário do contexto inválido.');
  return {
    cliente: ctx.cliente,
    estabelecimento,
    usuario,
    correlacao: ctx.correlacao,
    ...(ctx.enderecoIp !== undefined ? { enderecoIp: ctx.enderecoIp } : {}),
  };
}

/** Campos de log do contexto (sem dado pessoal: só códigos e ids). */
export function camposDeLog(ctx: ContextoNucleo): Record<string, string | number | null> {
  return {
    cliente: ctx.cliente,
    estabelecimento: ctx.estabelecimento,
    usuario: ctx.usuario,
    correlacao: ctx.correlacao,
  };
}
