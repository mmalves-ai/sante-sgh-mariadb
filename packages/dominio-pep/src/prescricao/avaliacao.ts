// Do item da tela ao que o motor de alertas avalia (uma linha por produto do item: o medicamento, os componentes da
// solução, os produtos da escala de insulina) e as conferências de entrada que não dependem do banco: frequência
// conhecida, "se necessário" com condição objetiva, quem prescreve o quê.
import type { CategoriaPrescritor, ItemPrescricao, TipoItemPrescricao } from '@sgh/contratos';
import type { ItemAvaliado, ProdutoAlerta } from '../alertas/tipos.js';
import { dosesNoPeriodo, frequencia, NATUREZAS_A_CRITERIO, podePrescrever } from './catalogo.js';

export function tipoDoItem(i: ItemPrescricao): TipoItemPrescricao {
  return i.detalhe.tipo;
}

/** Produtos do item com a dose (os componentes da solução e as faixas da escala, cada um). */
export function produtosDoItem(
  i: ItemPrescricao,
): { produto: number; dose: number | null; unidade: string | null }[] {
  const d = i.detalhe;
  switch (d.tipo) {
    case 'medicamento':
      return [{ produto: d.item.produto, dose: d.dose, unidade: d.unidade }];
    case 'solucao':
      return d.componentes.map((c) => ({ produto: c.produto, dose: c.dose, unidade: c.unidade }));
    case 'glicemia': {
      // Cada produto da escala uma vez, com a maior dose das faixas (o pior caso para a faixa de dose).
      const m = new Map<number, { produto: number; dose: number; unidade: string }>();
      for (const f of d.faixas) {
        const x = m.get(f.produto);
        if (!x || f.dose > x.dose) m.set(f.produto, { produto: f.produto, dose: f.dose, unidade: f.unidade });
      }
      return [...m.values()];
    }
    default:
      return [];
  }
}

export function viaDoItem(i: ItemPrescricao): string | null {
  const d = i.detalhe;
  if (d.tipo === 'medicamento' || d.tipo === 'solucao') return d.via;
  if (d.tipo === 'glicemia') return d.faixas[0]?.via ?? null;
  return null;
}

export function frequenciaDoItem(i: ItemPrescricao): number | null {
  return 'frequencia' in i.detalhe ? i.detalhe.frequencia : null;
}

export function itemAvaliado(
  i: ItemPrescricao,
  produtos: ReadonlyMap<number, ProdutoAlerta>,
  existente = false,
): ItemAvaliado {
  const f = frequencia(frequenciaDoItem(i));
  const relativos =
    i.detalhe.tipo === 'medicamento' || i.detalhe.tipo === 'procedimento' ? i.detalhe.relativos.length : 0;
  const sn =
    i.detalhe.tipo === 'medicamento' || i.detalhe.tipo === 'procedimento'
      ? (i.detalhe.seNecessario ?? null)
      : null;
  return {
    chave: i.chave,
    tipo: i.detalhe.tipo,
    produtos: produtosDoItem(i)
      .map((p) => {
        const produto = produtos.get(p.produto);
        return produto ? { produto, dose: p.dose, unidade: p.unidade } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    via: viaDoItem(i),
    dosesNoPeriodo: f ? dosesNoPeriodo(f, relativos) : 1,
    intervaloHoras: f?.intervaloHoras ?? null,
    aCriterio: f ? NATUREZAS_A_CRITERIO.includes(f.natureza) && i.detalhe.tipo === 'medicamento' : false,
    seNecessario: sn,
    fichaAntimicrobiano: i.antimicrobiano !== undefined,
    existente,
  };
}

/** Itens que a categoria de quem prescreve não pode prescrever (regra 10). */
export function foraDaCategoria(itens: readonly ItemPrescricao[], categoria: CategoriaPrescritor): string[] {
  return itens.filter((i) => !podePrescrever(categoria, i.detalhe.tipo)).map((i) => i.chave);
}

/** Frequências desconhecidas no item (fora das oferecidas). */
export function frequenciasDesconhecidas(itens: readonly ItemPrescricao[]): string[] {
  return itens.filter((i) => frequencia(frequenciaDoItem(i)) === null).map((i) => i.chave);
}
