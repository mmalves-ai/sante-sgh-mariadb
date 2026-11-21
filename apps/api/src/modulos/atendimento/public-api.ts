// Módulo atendimento externo da API (M20): recepção ambulatorial, consultório, pronto atendimento (quadro, observação,
// desfecho), impressos e indicadores.
export { AtendimentoController, ApoiosAtendimento, encerrarPelaSessao } from './atendimento.controller.js';
export { PaController } from './pa.controller.js';
export {
  AVISOS_ATENDIMENTO,
  AvisosAtendimento,
  type RequisicaoBrutaAtendimento,
  type RespostaEventosAtendimento,
} from './avisos.js';
export {
  FONTE_RISCO_PA,
  type FonteRiscoPa,
  PORTA_ATENDIMENTO,
  type PortaAtendimento,
  portaAtendimentoIndisponivel,
} from './porta.js';
export { PortaAtendimentoMemoria } from './porta-memoria.js';
export { PortaAtendimentoPropria } from './porta-propria.js';
export { modulo } from './modulo.js';
