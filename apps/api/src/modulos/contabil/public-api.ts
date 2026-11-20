// Módulo contabilidade da API (M54): na etapa 1 (F1), o plano de contas com o plano referencial, as regras de
// contabilização versionadas (simulação e publicação) e o acompanhamento dos fatos lidos dos módulos. As fatias F2 a F7
// acrescentam as delas.
export { ContabilController } from './contabil.controller.js';
export { LancamentosContabilController } from './lancamentos.controller.js';
export { DemonstracoesContabilController, GERADOR_PDF_CONTABIL } from './demonstracoes.controller.js';
export { PORTA_CONTABIL, type PortaContabil } from './porta.js';
export { portaContabilIndisponivel, portaContabilLegado } from './porta-legado.js';
export { PortaContabilMemoria } from './porta-memoria.js';
