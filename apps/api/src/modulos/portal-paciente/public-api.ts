// Módulo do portal do paciente da API (M50, etapa 1): conta própria com segundo fator, resultados e documentos
// assinados, responsável legal com prova, consentimentos, pedidos do titular e o relatório de acessos; e as telas
// internas da conta e da conferência dos vínculos. Só SGH_ (nenhuma tabela do legado).
export { PortalPacienteController, SERVICO_PORTAL_PACIENTE } from './portal-paciente.controller.js';
export { PortalPacienteInternoController } from './portal-paciente-interno.controller.js';
export { ServicoPortalPaciente, USUARIO_PORTAL } from './aplicacao/servico.js';
export { CanalHalai, CanalSimulador, canalDoAmbiente } from './aplicacao/canal.js';
export { type ArmazemProvas, ArmazemProvasMemoria, criarArmazemProvas } from './aplicacao/provas.js';
export { PORTA_PORTAL_PACIENTE, type PortaPortalPaciente } from './porta.js';
export { portaPortalIndisponivel, portaPortalLegado, portaPortalNaTransacao } from './porta-legado.js';
export {
  type DocumentoMemoriaPortal,
  PACIENTES_PORTAL_SINTETICOS,
  PortaPortalMemoria,
} from './porta-memoria.js';
// M50 etapa 2: agendamento online, pré-check-in, pagamento e pesquisa (portal) e as telas internas.
export { PortalAgendaController, SERVICO_AGENDA_PORTAL } from './agenda/portal-agenda.controller.js';
export { PortalAgendaInternoController } from './agenda/interno.controller.js';
export { ServicoAgendaPortal } from './agenda/servico.js';
export { GatewaySimulado, gatewayDoAmbiente, type GatewayPagamento } from './agenda/gateway.js';
export { PORTA_AGENDA_ONLINE, type PortaAgendaOnline } from './agenda/porta.js';
export {
  portaAgendaOnlineIndisponivel,
  portaAgendaOnlineLegado,
  portaAgendaOnlineNaTransacao,
} from './agenda/porta-legado.js';
export { PortaAgendaOnlineMemoria, sementeAgendaOnline } from './agenda/porta-memoria.js';
