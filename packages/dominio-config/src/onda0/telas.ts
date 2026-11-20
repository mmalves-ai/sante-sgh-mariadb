// Situação das telas da onda 0 para quem pergunta (ficha do M38, campo 7, regra 3 e seção 12): a chave da tela
// ligada para a pessoa, o grupo ou o setor dela; ligada só para outros (fora do escopo da onda: a consulta é
// recusada com o aviso próprio); desligada no estabelecimento; ou à espera de pré-requisito. E se as ações de escrita
// da tela estão recusadas (só consulta nesta etapa). Regra pura: as chaves e os pré-requisitos vêm de quem chama.
import {
  CHAVES_QUE_TAMBEM_ABREM_A_LEITURA,
  type ChaveTelaOnda0,
  PERMISSOES_SOB_CHAVE_DE_TELA,
  type PrerequisitoDeclarado,
  type SituacaoTelaOnda0,
  type TelaOnda0,
  type TelaOnda0Situacao,
  ESCRITAS_TELAS_ONDA_0,
} from '@sgh/contratos';
import type { ChaveAtual } from '../liberacao/lote.js';
import type { PrerequisitoRegistrado } from '../liberacao/prerequisito-chave.js';
import { recursoLigado, type SujeitoLiberacao } from '../liberacao/recurso.js';

export interface EntradaSituacaoTela {
  /** As chaves de SGH_CFG_LIBERACAO desta tela (tipo `recurso`), já lidas. */
  readonly chaves: readonly ChaveAtual[];
  readonly declarados: readonly PrerequisitoDeclarado[];
  readonly registrados: readonly PrerequisitoRegistrado[];
  readonly sujeito: SujeitoLiberacao;
  readonly agora: Date;
}

/**
 * `fora-do-escopo`: a chave está ligada para alguém (pessoa, grupo ou setor) e não para quem pergunta (regra 3:
 * a onda 0 é de MASTER e MASTER_SEM_FINANCEIRO e dos papéis mapeados a eles). `desligada`: ninguém tem.
 */
export function situacaoDaChave(e: EntradaSituacaoTela): Exclude<SituacaoTelaOnda0, 'sem-chave'> {
  if (recursoLigado(e.chaves, e.declarados, e.registrados, e.sujeito, e.agora)) return 'ligada';
  if (recursoLigado(e.chaves, [], [], e.sujeito, e.agora)) return 'prerequisito';
  const hospital = e.chaves.find((c) => c.escopo === 'hospital' && c.valor === '*');
  if (hospital && hospital.ligada === false) return 'desligada';
  return e.chaves.some((c) => c.ligada === true) ? 'fora-do-escopo' : 'desligada';
}

/**
 * Uma linha da resposta de GET /api/onda0/telas. `podeEscrever(operacao)` diz se o executor aceitaria a gravação
 * para quem pergunta (catálogo e chave da operação); a tela sem escrita devolve `escritaLiberada: null`.
 */
export async function situacaoDaTela(
  tela: TelaOnda0,
  chave: EntradaSituacaoTela | null,
  podeEscrever: (operacao: string) => Promise<boolean>,
): Promise<TelaOnda0Situacao> {
  const situacao: SituacaoTelaOnda0 =
    tela.recurso === null || chave === null ? 'sem-chave' : situacaoDaChave(chave);
  const escritas = ESCRITAS_TELAS_ONDA_0[tela.id] ?? [];
  let escritaLiberada: boolean | null = null;
  if (escritas.length > 0) {
    escritaLiberada = false;
    for (const op of escritas)
      if (await podeEscrever(op)) {
        escritaLiberada = true;
        break;
      }
  }
  return { id: tela.id, recurso: tela.recurso, permissao: tela.permissao, situacao, escritaLiberada };
}

/** A chave de tela da onda 0 que abre a leitura com esta permissão (null: a permissão não está sob chave de tela). */
export function chaveDeTelaDaPermissao(permissao: string): ChaveTelaOnda0 | null {
  for (const [chave, permissoes] of Object.entries(PERMISSOES_SOB_CHAVE_DE_TELA))
    if (permissoes.includes(permissao)) return chave as ChaveTelaOnda0;
  return null;
}

/**
 * A leitura de uma rota com esta permissão, para quem pergunta (ficha do M38, regra 3 e seção 12): `null` quando a
 * permissão não está sob chave de tela; `ligada` quando a chave da tela vale para o sujeito, ou a de uma tela das
 * ondas seguintes que usa a mesma leitura (CHAVES_QUE_TAMBEM_ABREM_A_LEITURA); senão, a situação da chave da tela
 * (fora do escopo, desligada ou à espera de pré-requisito). `entrada(chave)` traz as chaves já lidas.
 */
export function situacaoDaLeitura(
  permissao: string,
  entrada: (chave: string) => EntradaSituacaoTela,
): Exclude<SituacaoTelaOnda0, 'sem-chave'> | null {
  const tela = chaveDeTelaDaPermissao(permissao);
  if (tela === null) return null;
  const situacao = situacaoDaChave(entrada(tela));
  if (situacao === 'ligada') return 'ligada';
  for (const outra of CHAVES_QUE_TAMBEM_ABREM_A_LEITURA[permissao] ?? [])
    if (situacaoDaChave(entrada(outra)) === 'ligada') return 'ligada';
  return situacao;
}
