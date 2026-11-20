// M47 (etapa 3): a chave `imagem.worklist` valendo no estabelecimento (com os pré-requisitos cumpridos). O ciclo de
// geração e o enviador da outbox conferem a mesma regra: recolhida a chave, nada novo se cria e nada pendente vai ao PACS.
import { CHAVE_LIBERACAO_WORKLIST, recursoDesligado } from '@sgh/contratos';
import { recursoLigadoNoEstabelecimento } from '@sgh/dominio-config';
import { lerChavesLiberacao, lerPrerequisitos, type Leitor } from '@sgh/legado';

type Chaves = Awaited<ReturnType<typeof lerChavesLiberacao>>;
type Prerequisitos = Awaited<ReturnType<typeof lerPrerequisitos>>;

/** Pura: a chave da lista de trabalho vale no estabelecimento, pelas chaves e pré-requisitos lidos. */
export function worklistLigada(chaves: Chaves, prerequisitos: Prerequisitos, agora: Date): boolean {
  const ch = chaves
    .filter((c) => c.chave === CHAVE_LIBERACAO_WORKLIST && c.tipo === 'recurso' && c.ligada !== null)
    .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
  const declarados = recursoDesligado(CHAVE_LIBERACAO_WORKLIST)?.prerequisitos ?? [];
  const registrados = prerequisitos.filter((p) => p.recurso === CHAVE_LIBERACAO_WORKLIST);
  return recursoLigadoNoEstabelecimento(ch, declarados, registrados, agora);
}

/** Lê e confere a chave no estabelecimento. */
export async function worklistLigadaNoEstabelecimento(l: Leitor, cod: string, agora: Date): Promise<boolean> {
  return worklistLigada(await lerChavesLiberacao(l, cod), await lerPrerequisitos(l, cod), agora);
}
