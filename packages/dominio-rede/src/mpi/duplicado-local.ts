// Duplicado dentro do mesmo estabelecimento (M57, regra 5; ref 01 §2.2; cap-07 §7.7.3): o CPF válido repetido em mais
// de um prontuário do mesmo banco (14 grupos no pc) NÃO é tratado pelo MPI da Rede. Vai para a fila de duplicidades do
// cadastro (M11, SGH_CAD_DUPLICIDADE) e para a unificação local. Aqui só se separa: os grupos locais saem do lote do
// MPI, e o lote do MPI segue com um representante por grupo (o de menor ID, como a fila do M11 ordena os pares).
import type { CadastroComparavelRede } from './cadastro.js';

export interface SeparacaoLocal {
  /** Grupos de IDs com o mesmo CPF no mesmo estabelecimento (para a fila de duplicidades do cadastro). */
  readonly gruposLocais: readonly { readonly estabelecimento: string; readonly ids: readonly number[] }[];
  /** Os cadastros que seguem para o pareamento entre estabelecimentos. */
  readonly paraARede: readonly CadastroComparavelRede[];
}

/** Separa os duplicados locais por CPF (só cadastros elegíveis; o inelegível nem entra). */
export function separarDuplicadosLocais(cadastros: readonly CadastroComparavelRede[]): SeparacaoLocal {
  const porChave = new Map<string, CadastroComparavelRede[]>();
  const semCpf: CadastroComparavelRede[] = [];
  for (const c of cadastros) {
    if (!c.elegivel) continue;
    if (!c.cpf) {
      semCpf.push(c);
      continue;
    }
    const k = `${c.estabelecimento}:${c.cpf}`;
    const g = porChave.get(k);
    if (g) g.push(c);
    else porChave.set(k, [c]);
  }
  const gruposLocais: { estabelecimento: string; ids: number[] }[] = [];
  const paraARede: CadastroComparavelRede[] = [...semCpf];
  for (const g of porChave.values()) {
    const ordenado = [...g].sort((x, y) => x.id - y.id);
    paraARede.push(ordenado[0] as CadastroComparavelRede);
    if (ordenado.length > 1)
      gruposLocais.push({ estabelecimento: ordenado[0]!.estabelecimento, ids: ordenado.map((c) => c.id) });
  }
  paraARede.sort((x, y) => x.estabelecimento.localeCompare(y.estabelecimento) || x.id - y.id);
  gruposLocais.sort((x, y) => x.estabelecimento.localeCompare(y.estabelecimento) || x.ids[0]! - y.ids[0]!);
  return { gruposLocais, paraARede };
}
