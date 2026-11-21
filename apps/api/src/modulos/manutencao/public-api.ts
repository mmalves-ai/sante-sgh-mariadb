// Módulo manutenção e engenharia clínica da API (M55): equipamentos, ordens de serviço corretivas e prediais com
// prioridade e prazo, plano de manutenção com laudo, contratos de manutenção e indicadores.
export { GERADOR_PDF_MANUTENCAO, ManutencaoController } from './manutencao.controller.js';
export { modulo, portaDaManutencao } from './modulo.js';
export { PORTA_MANUTENCAO, type PortaManutencao, portaManutencaoIndisponivel } from './porta.js';
export { type NucleoManutencao, PortaManutencaoPropria } from './porta-propria.js';
export { PortaManutencaoMemoria } from './porta-memoria.js';
export type * from './tipos.js';
