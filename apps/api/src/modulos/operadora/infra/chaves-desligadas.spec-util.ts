// M61 (ADR 0034, liberação full na instalação): a cópia de dev pode estar com as chaves da operadora ligadas (o
// `liberacao:ligar-tudo` as liga). O teste que confere a fatia DESLIGADA não depende do estado da cópia: desliga as
// chaves no estabelecimento dentro de uma transação sempre desfeita (`desfazendoNaCopia`) e lê a situação sobre as
// chaves e os pré-requisitos relidos nessa transação (a fonte real lê fora dela e não as veria). Nada fica na cópia.
import { planejarLote } from '@sgh/dominio-config';
import { aplicarLoteLiberacao, lerChavesLiberacao, lerPrerequisitos, type NucleoLegado } from '@sgh/legado';
import { fonteConfiguracaoLegado } from '../../config/configuracao-fonte.js';
import { ServicoSituacaoOperadora } from '../aplicacao/situacao.js';

export async function situacaoComChavesDesligadas(
  nucleo: NucleoLegado,
  hospital: string,
  login: string,
  chaves: readonly string[],
): ReturnType<ServicoSituacaoOperadora['situacao']> {
  const correlacao = 'int-m61-desligadas';
  return nucleo.desfazendoNaCopia({ rede: nucleo.rede, hospital, traceId: correlacao }, async (e) => {
    for (const chave of chaves)
      await aplicarLoteLiberacao(
        e,
        {
          hospital,
          tipo: 'recurso',
          chave,
          planejar: ({ chaves: atuais }) => planejarLote(atuais, 'hospital', ['*'], false),
          justificativa: 'SGH M56: integração (desligada na transação desfeita)',
          autor: login,
        },
        {
          rede: nucleo.rede,
          hospital,
          usuario: login,
          evento: 'config.liberacao.alterada',
          recurso: 'config.liberacao',
          operacao: 'int',
          chaveNaturalAlvo: null,
          resultado: 'sucesso',
          estacao: 'integracao-m56',
          correlacao,
        },
      );
    const lidas = await lerChavesLiberacao(e, hospital);
    const fonte = {
      ...fonteConfiguracaoLegado(nucleo),
      chaves: async () => lidas,
      prerequisitos: async () => lerPrerequisitos(e, hospital),
    };
    return new ServicoSituacaoOperadora(fonte, null).situacao({
      rede: nucleo.rede,
      hospital,
      login,
      setor: null,
    });
  });
}
