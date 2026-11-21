// Módulo do portal do médico externo da API (M50, etapa 3): extrato de produção e repasse, agenda cirúrgica e pedido de
// cirurgia pela sessão do portal de resultados do M26; a tela interna das contas e do vínculo com o corpo clínico.
export { PortalMedicoController, SERVICO_PORTAL_MEDICO } from './portal-medico.controller.js';
export { PortalMedicoInternoController } from './portal-medico-interno.controller.js';
export { type ContextoPortalMedico, PORTA_PORTAL_MEDICO, type PortaPortalMedico } from './porta.js';
export {
  OPERACOES_PENDENTES as OPERACOES_PENDENTES_PORTAL_MEDICO,
  portaPortalMedicoIndisponivel,
  PortaPortalMedicoPropria,
  portaPortalMedicoPropria,
} from './porta-propria.js';
export { CORPO_CLINICO_SINTETICO, PortaPortalMedicoMemoria } from './porta-memoria.js';
export { ServicoPortalMedico } from './aplicacao/servico.js';
export { CanalMedicoDesligado, CanalMedicoSimulador, canalMedicoDoAmbiente } from './aplicacao/canal.js';
export {
  type FonteAssinaturaPortalMedico,
  retornoDoPortalMedico,
  sessaoDaAssinaturaRemota,
} from './aplicacao/assinatura-remota.js';
export { moduloPortalMedico } from './modulo.js';
