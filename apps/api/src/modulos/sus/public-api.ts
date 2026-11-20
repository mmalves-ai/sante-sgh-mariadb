// Módulo do faturamento SUS próprio da API (M51, etapa 1): competência SUS, crítica prévia e exportação da CIHA.
export { ARMAZEM_ARQUIVO_SUS, SusController } from './sus.controller.js';
export { SusAihController } from './sus-aih.controller.js';
export { ServicoSusAih } from './servico-aih.js';
export { dadosAihDoLegado } from './porta-aih-legado.js';
export { PORTA_SUS, type PortaSus } from './porta.js';
export {
  dadosCihaDoLegado,
  portaSusIndisponivel,
  portaSusLegado,
  portaSusNasTransacoes,
} from './porta-legado.js';
export { PortaSusMemoria, SIGTAP_SINTETICO } from './porta-memoria.js';
export { armazemSusMemoria, armazemSusS3 } from './armazem.js';
export { ServicoSus, type ArmazemArquivoSus, type SessaoSus } from './servico.js';
export { montarCihaDaCompetencia, type ParametrosSus } from './montagem.js';
