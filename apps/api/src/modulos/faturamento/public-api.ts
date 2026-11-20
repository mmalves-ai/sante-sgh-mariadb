// Módulo da conta do paciente, dos lançamentos e da auditoria de contas da API (M30).
export { FaturamentoController } from './faturamento.controller.js';
export { PORTA_FATURAMENTO, type PortaFaturamento } from './porta.js';
export {
  portaFaturamentoIndisponivel,
  portaFaturamentoLegado,
  portaFaturamentoNaTransacao,
} from './porta-legado.js';
export { PortaFaturamentoMemoria } from './porta-memoria.js';
