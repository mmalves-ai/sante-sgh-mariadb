// Módulo atendimento externo da API (M20): recepção ambulatorial, consultório, pronto atendimento (quadro, observação,
// desfecho), impressos e indicadores, sobre a mesma ficha e a mesma conta do outro sistema.
export { AtendimentoController, ApoiosAtendimento, encerrarPelaSessao } from './atendimento.controller.js';
export { PaController } from './pa.controller.js';
export {
  AVISOS_ATENDIMENTO,
  AvisosAtendimento,
  type RequisicaoBrutaAtendimento,
  type RespostaEventosAtendimento,
} from './avisos.js';
export { FONTE_RISCO_PA, type FonteRiscoPa, PORTA_ATENDIMENTO, type PortaAtendimento } from './porta.js';
export { portaAtendimentoIndisponivel, portaAtendimentoLegado } from './porta-legado.js';
export { PortaAtendimentoMemoria } from './porta-memoria.js';
