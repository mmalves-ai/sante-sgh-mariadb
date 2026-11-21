// A porta da integração da folha fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). A porta própria da integração
// (titulo_folha, depara_folha_financeiro) é do lote que migra porta-integracao.ts; pedido em saida/03-06.json.
import { portaIndisponivel } from '../../exames/public-api.js';
import { METODOS_PORTA_INTEGRACAO_FOLHA, type PortaIntegracaoFolha } from './porta-integracao.js';

export function portaIntegracaoFolhaIndisponivel(): PortaIntegracaoFolha {
  return portaIndisponivel<PortaIntegracaoFolha>(METODOS_PORTA_INTEGRACAO_FOLHA);
}
