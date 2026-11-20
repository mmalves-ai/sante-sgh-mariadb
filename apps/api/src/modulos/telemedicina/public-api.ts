// Módulo telemedicina da API (M50, etapa 4): a teleconsulta (sala de espera do portal, a sala do provedor, o
// atendimento aberto como consulta pela receita do M20) e a teleinterconsulta.
export { PORTA_TELEMEDICINA, type PortaTelemedicina } from './porta.js';
export {
  portaTelemedicinaIndisponivel,
  portaTelemedicinaLegado,
  portaTelemedicinaNaTransacao,
} from './porta-legado.js';
export { type MarcacaoSinteticaTele, PortaTelemedicinaMemoria } from './porta-memoria.js';
export {
  ProvedorIndisponivel,
  ProvedorSimulado,
  provedorDoAmbiente,
  type ProvedorTeleconsulta,
} from './provedor.js';
export {
  type GanchoTeleconsultaPortal,
  OPERACOES_TELEMEDICINA,
  PortaGravacaoTelemedicina,
  ServicoTelemedicina,
} from './servico.js';
export { SERVICO_TELEMEDICINA, TelemedicinaController } from './telemedicina.controller.js';
export { PortalTeleconsultaController } from './portal-teleconsulta.controller.js';
