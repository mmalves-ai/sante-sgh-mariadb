// Lista de problemas e diagnósticos (ficha do M23, campo 6; recurso só do novo): cada mudança é uma versão nova que
// aponta a anterior (correção nunca apaga, regra 17); a lista vigente são as versões que nenhuma outra substitui.
import type { SituacaoProblema } from '@sgh/contratos';

export interface VersaoProblema {
  readonly id: number;
  readonly anterior: number | null;
  readonly situacao: SituacaoProblema;
  readonly em: string;
}

/** As versões vigentes (folhas da cadeia), com quantas versões cada cadeia teve. */
export function problemasVigentes<T extends VersaoProblema>(
  versoes: readonly T[],
): (T & { versoes: number })[] {
  const substituidas = new Set(versoes.map((v) => v.anterior).filter((x): x is number => x !== null));
  const porId = new Map(versoes.map((v) => [v.id, v]));
  const contar = (v: T) => {
    let n = 1;
    let a = v.anterior;
    const vistos = new Set<number>([v.id]);
    while (a !== null && !vistos.has(a)) {
      vistos.add(a);
      n++;
      a = porId.get(a)?.anterior ?? null;
    }
    return n;
  };
  return versoes
    .filter((v) => !substituidas.has(v.id))
    .map((v) => ({ ...v, versoes: contar(v) }))
    .sort(
      (a, b) =>
        (a.situacao === 'ativo' ? 0 : 1) - (b.situacao === 'ativo' ? 0 : 1) || b.em.localeCompare(a.em),
    );
}

/** A mudança de situação vale? (descartado é final; resolvido pode voltar a ativo, recidiva.) */
export function mudancaValida(de: SituacaoProblema, para: SituacaoProblema): boolean {
  if (de === para) return false;
  if (de === 'descartado') return false;
  return true;
}
