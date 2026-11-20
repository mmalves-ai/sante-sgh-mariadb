// Token do registrador da trilha (guarda, interceptor do @Auditar e handlers), fora dos dois para não haver
// importação circular.
export const REGISTRADOR_TRILHA = Symbol('REGISTRADOR_TRILHA');

/** ADR 0021: auditoria do "login como" (escritas recusadas pela guarda). */
export const AUDITORIA_COMO = Symbol('AUDITORIA_COMO');
