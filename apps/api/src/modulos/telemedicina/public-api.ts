// Módulo telemedicina da API: a teleconsulta (sala de espera do portal, a sala do provedor, o atendimento aberto como
// consulta pelo executor do atendimento) e a teleinterconsulta, sobre a porta própria (MariaDB) ou a de memória.
export {
  type AtendimentoDoHistoricoClinico,
  type ContextoTelemedicina,
  ErroTelemedicina,
  type GravadorTelemedicina,
  PORTA_TELEMEDICINA,
  type PortaTelemedicina,
  type Teleconsulta,
} from './porta.js';
export {
  civilNoFuso,
  instanteNoFuso,
  type NucleoTelemedicina,
  portaTelemedicinaIndisponivel,
  PortaTelemedicinaPropria,
} from './porta-propria.js';
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
export { modulo, portaDaTelemedicina } from './modulo.js';
