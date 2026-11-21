// M47 (etapa 3): a chave `imagem.worklist` valendo no estabelecimento (com os pré-requisitos cumpridos). O ciclo de
// geração e o enviador da fila conferem a mesma regra: recolhida a chave, nada novo se cria e nada pendente vai ao PACS.
// Leitura pela porta própria (liberacao_chave e recurso_prerequisito do estabelecimento); a regra é a do domínio.
import { CHAVE_LIBERACAO_WORKLIST, recursoDesligado } from '@sgh/contratos';
import { recursoLigadoNoEstabelecimento } from '@sgh/dominio-config';
import type { Leitor } from '@sgh/nucleo';
import { type ChaveRecursoLida, lerChavesLiberacao, lerPrerequisitos, type PrerequisitoLido } from './porta-propria.js';

type ChaveDominio = Parameters<typeof recursoLigadoNoEstabelecimento>[0][number];
type PrerequisitoDominio = Parameters<typeof recursoLigadoNoEstabelecimento>[2][number];

/** Pura: a chave da lista de trabalho vale no estabelecimento, pelas chaves e pré-requisitos lidos. */
export function worklistLigada(
  chaves: readonly ChaveRecursoLida[],
  prerequisitos: readonly PrerequisitoLido[],
  agora: Date,
): boolean {
  const ch = chaves
    .filter((c) => c.chave === CHAVE_LIBERACAO_WORKLIST && c.tipo === 'recurso' && c.ligada !== null)
    .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }) as ChaveDominio);
  const declarados = recursoDesligado(CHAVE_LIBERACAO_WORKLIST)?.prerequisitos ?? [];
  const registrados = prerequisitos
    .filter((p) => p.recurso === CHAVE_LIBERACAO_WORKLIST)
    .map((p) => ({ tipo: p.tipo, situacao: p.situacao, validade: p.validade }) as PrerequisitoDominio);
  return recursoLigadoNoEstabelecimento(ch, declarados, registrados, agora);
}

/** Lê e confere a chave no estabelecimento. */
export async function worklistLigadaNoEstabelecimento(l: Leitor, cod: string, agora: Date): Promise<boolean> {
  return worklistLigada(
    await lerChavesLiberacao(l, cod, CHAVE_LIBERACAO_WORKLIST),
    await lerPrerequisitos(l, cod, CHAVE_LIBERACAO_WORKLIST),
    agora,
  );
}
