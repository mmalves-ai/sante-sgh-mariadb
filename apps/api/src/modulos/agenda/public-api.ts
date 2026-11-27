// Módulo da agenda de consultas (M17). Outros módulos falam com este só por aqui.
export { AgendasController } from './agendas.controller.js';
export { ApoioAgendaController } from './apoio.controller.js';
export { MarcacoesController } from './marcacoes.controller.js';
export { PORTA_AGENDA, type ContextoAgenda, type ContextoGravacao, type PortaAgenda } from './porta.js';
export { PortaAgendaPropria } from './porta-propria.js';
export {
  agendaMemoriaAtual,
  lembrarAgendaMemoria,
  PortaAgendaMemoria,
  relogioCivil,
  relogioLocal,
} from './porta-memoria.js';
export { moduloAgenda, portaAgendaIndisponivel } from './modulo.js';
export type * from './tipos.js';
