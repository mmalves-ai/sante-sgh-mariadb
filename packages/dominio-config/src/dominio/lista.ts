// Regra 2 do M08 (cap-09 §9.7): lista, filtro e ordenação NO SERVIDOR, com teto; nunca a tabela inteira no
// cliente. O filtro por descrição é em JS normalizado (o banco, em charset NONE, não ignora acento); a
// leitura no banco ordena pela chave e para no teto (TETO_LISTA_DOMINIO).
import {
  type ConsultaLista,
  type ItemDominio,
  TETO_LISTA_DOMINIO,
  type ListaDominio,
  type ValorCampo,
} from '@sgh/contratos';
import { normalizarDescricao } from '@sgh/contratos';

export const POR_PAGINA_PADRAO = 25;

function comparar(a: ValorCampo | undefined, b: ValorCampo | undefined): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  return normalizarDescricao(a).localeCompare(normalizarDescricao(b), 'pt-BR');
}

/**
 * Filtra (busca em todas as palavras, sem acento), ordena por um campo permitido (padrão: o código, como
 * veio do banco) e pagina. `truncada`: a leitura parou no teto.
 */
export function montarLista(
  itens: readonly ItemDominio[],
  consulta: ConsultaLista,
  opcoes: {
    readonly camposOrdenaveis: readonly string[];
    readonly camposBusca: readonly string[];
    readonly truncada: boolean;
    readonly porPaginaPadrao?: number;
  },
): ListaDominio {
  const termos = normalizarDescricao(consulta.busca ?? '')
    .split(' ')
    .filter(Boolean);
  let r = itens.filter((i) => consulta.inativos === 'sim' || i.ativo);
  if (termos.length > 0) {
    r = r.filter((i) => {
      const alvo = [i.codigo, ...opcoes.camposBusca.map((c) => normalizarDescricao(i.valores[c]))].join(' ');
      return termos.every((t) => alvo.includes(t));
    });
  }
  if (consulta.ordem && opcoes.camposOrdenaveis.includes(consulta.ordem)) {
    const campo = consulta.ordem;
    const sinal = consulta.direcao === 'desc' ? -1 : 1;
    r = [...r].sort((a, b) => sinal * comparar(a.valores[campo], b.valores[campo]));
  } else if (consulta.direcao === 'desc') r = [...r].reverse();
  const porPagina = Math.min(consulta.porPagina ?? opcoes.porPaginaPadrao ?? POR_PAGINA_PADRAO, 100);
  const pagina = Math.max(1, Math.min(consulta.pagina ?? 1, Math.max(1, Math.ceil(r.length / porPagina))));
  return {
    itens: r.slice((pagina - 1) * porPagina, pagina * porPagina),
    total: r.length,
    truncada: opcoes.truncada,
    pagina,
    porPagina,
  };
}

/** A leitura trouxe mais que o teto? (lê-se TETO + 1 para saber). */
export function passouDoTeto(lidas: number): boolean {
  return lidas > TETO_LISTA_DOMINIO;
}
