// Entrada validada pelo zod sem as chaves `undefined`: o campo opcional do esquema (`?: T | undefined`) passa a
// `?: T`, o formato das portas e do domínio com `exactOptionalPropertyTypes`. A chave ausente continua ausente.
// Vale também para os objetos dentro de listas e de outros objetos (os itens da lista do cadastro).

export type SemIndefinidos<T> = T extends readonly (infer I)[]
  ? SemIndefinidos<I>[]
  : T extends object
    ? { [K in keyof T]: SemIndefinidos<Exclude<T[K], undefined>> }
    : T;

/** Cópia de `o` sem as chaves cujo valor é `undefined`, em profundidade (o resto, inclusive `null`, fica igual). */
export function semIndefinidos<T>(o: T): SemIndefinidos<T> {
  return limpar(o) as SemIndefinidos<T>;
}

function limpar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(limpar);
  if (v === null || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => [k, limpar(x)]),
  );
}
