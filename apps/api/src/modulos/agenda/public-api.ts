// Módulo agenda de consultas da API (M17): agendas, escala, grade, marcação, encaixe, remarcação, confirmação,
// falta, painel do dia, cancelamentos, bloqueios, lista de espera e indicadores.
export { AgendasController } from './agendas.controller.js';
export { ApoioAgendaController } from './apoio.controller.js';
export { MarcacoesController } from './marcacoes.controller.js';
export { PORTA_AGENDA, type PortaAgenda } from './porta.js';
export { portaAgendaIndisponivel, portaAgendaLegado } from './porta-legado.js';
export { PortaAgendaMemoria, relogioLocal } from './porta-memoria.js';
