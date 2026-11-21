// M44, regra 6 (cap-12 §12.4, Nota): uma fonte de cor no pronto atendimento por estabelecimento e escopo. Ligar a
// classificação externa (M34) onde a própria (M44) está ligada é recusado; ligar a própria desliga, na MESMA mudança de
// configuração (uma transação com os dois lotes: a externa primeiro, a própria depois), a externa ligada nos
// mesmos escopos: nunca há duas fontes ligadas ao mesmo tempo, e se a segunda parte falhar nada muda. Puro sobre a
// fonte das chaves: a API usa a fonte de configuração; a integração, o escritor da cópia (transação desfeita).
import { CHAVE_CLASSIFICACAO_EXTERNA, CHAVE_LIBERACAO_CLASSIFICACAO } from '@sgh/contratos';
import { conferirFonteUnicaDeCor, planejarLote } from '@sgh/dominio-config';
import type { ChaveLiberacao } from './configuracao-fonte.js';
import { ErroProblema } from '../../problema.filter.js';

type Escopo = Parameters<typeof planejarLote>[1];

export interface FonteChavesCor {
  chaves(): Promise<readonly ChaveLiberacao[]>;
  /** Aplica o lote de UMA chave (o plano decidido sobre o estado relido com trava). */
  desligarExterna(
    planejar: (estado: { chaves: readonly ChaveLiberacao[] }) => ReturnType<typeof planejarLote>,
  ): Promise<{
    alteradas: number;
  }>;
}

/** A própria e a externa ligadas em algum dos escopos pedidos (ou no estabelecimento inteiro). */
export function fonteDeCor(
  chaves: readonly ChaveLiberacao[],
  escopo: string,
  valores: readonly string[],
): { propriaLigada: boolean; externaLigada: boolean } {
  const ligada = (chave: string) =>
    chaves.some(
      (c) =>
        c.chave === chave &&
        c.tipo === 'recurso' &&
        c.ligada === true &&
        ((c.escopo === 'hospital' && c.valor === '*') || (c.escopo === escopo && valores.includes(c.valor))),
    );
  return {
    propriaLigada: ligada(CHAVE_LIBERACAO_CLASSIFICACAO),
    externaLigada: ligada(CHAVE_CLASSIFICACAO_EXTERNA),
  };
}

/**
 * O plano da regra 6 antes de ligar uma chave de recurso: recusa a externa onde a própria está ligada (409
 * `fonte-de-cor-unica`); ao ligar a própria com a externa ligada nos mesmos escopos, devolve o planejamento do lote
 * que desliga a externa (decidido sobre o estado relido com trava na transação); senão, null. A decisão é a de
 * @sgh/dominio-config (conferirFonteUnicaDeCor), a mesma do comando `liberacao:ligar-tudo` (M61).
 */
export function planoDaFonteUnicaDeCor(
  chaves: readonly ChaveLiberacao[],
  pedido: { chave: string; escopo: Escopo; valores: readonly string[] },
): ((e: { chaves: readonly ChaveLiberacao[] }) => ReturnType<typeof planejarLote>) | null {
  const { recusa, desligarExterna } = conferirFonteUnicaDeCor(chaves, pedido);
  if (recusa)
    throw new ErroProblema(recusa.problema, recusa.status, recusa.titulo, recusa.motivo, {
      codigo: recusa.codigo ?? 'fonte-de-cor-unica',
    });
  if (!desligarExterna) return null;
  return (e) => planejarLote(e.chaves, pedido.escopo, pedido.valores, false).filter((m) => m.antes === true);
}

export async function aplicarFonteUnicaDeCor(
  fonte: FonteChavesCor,
  pedido: { chave: string; escopo: Escopo; valores: readonly string[] },
): Promise<number> {
  const plano = planoDaFonteUnicaDeCor(await fonte.chaves(), pedido);
  if (!plano) return 0;
  const r = await fonte.desligarExterna(plano);
  return r.alteradas;
}
