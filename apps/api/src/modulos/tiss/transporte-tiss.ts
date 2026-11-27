// Transporte da saída TISS pelo serviço web da operadora (C2-070, 06-FAT linha 26; C1-108, 04-INT linha 80; C3-007,
// 08-INTG L128). A consulta de elegibilidade e a comunicação de internação e alta (comunicação de beneficiário) perguntam
// à central de integrações externas (decisão 53, entrada `operadora-tiss-webservice`) pelo helper único
// modoDaIntegracao, e só vão à outbox quando o transmissor do worker vai entregá-las (regra do domínio
// `transporteTissDisponivel`):
// - fora de produção: o simulador da central (destino do worker sem rede, recibo determinístico pelo contrato TISS);
//   o real ligado na tela fica neutralizado e o simulador segue respondendo;
// - em produção: só com o modo Real da central e o transporte real escrito. O real depende da definição do webservice
//   de cada operadora (aviso na tela da central: passe a definição à equipe de desenvolvimento), por isso
//   TRANSPORTE_TISS_REAL_ESCRITO é `false`: em produção nada vai à outbox e a recepção registra à mão, sem ficar presa
//   num 'aguardando' sem fim. Quando o cliente SOAP entrar, a constante e o destino de produção do worker mudam juntos.
import type { EstadoIntegracaoNaFuncao } from '@sgh/contratos';
import { transporteTissDisponivel } from '@sgh/dominio-faturamento';
import { modoDaIntegracao } from '../integracao/externas/servico.js';

export const INTEGRACAO_OPERADORA_TISS = 'operadora-tiss-webservice';
export const TRANSPORTE_TISS_REAL_ESCRITO = false;

export async function transporteTissDaCentral(
  env: NodeJS.ProcessEnv = process.env,
): Promise<EstadoIntegracaoNaFuncao> {
  const m = await modoDaIntegracao(INTEGRACAO_OPERADORA_TISS);
  return {
    integracao: INTEGRACAO_OPERADORA_TISS,
    modo: m.modo,
    neutralizado: m.neutralizado,
    transmite: transporteTissDisponivel({
      transmissorLigado: (env['TRANSMISSOR_TISS'] ?? '').trim() !== 'desligado',
      producao: (env['AMBIENTE'] ?? '').trim() === 'producao',
      transporteProducao: m.modo === 'real' && TRANSPORTE_TISS_REAL_ESCRITO,
    }),
    dependeDefinicaoFornecedor: true,
  };
}
