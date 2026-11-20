// Módulo manutenção e engenharia clínica da API (M55, etapa 1): equipamentos, ordens de serviço corretivas e prediais
// com prioridade e prazo, plano de manutenção com laudo, contratos de manutenção e indicadores.
export { GERADOR_PDF_MANUTENCAO, ManutencaoController } from './manutencao.controller.js';
export { PORTA_MANUTENCAO, type PortaManutencao } from './porta.js';
export {
  portaManutencaoIndisponivel,
  portaManutencaoLegado,
  portaManutencaoNaTransacao,
} from './porta-legado.js';
export { PortaManutencaoMemoria } from './porta-memoria.js';
