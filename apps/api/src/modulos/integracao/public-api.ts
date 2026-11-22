// Módulo integracao da API (M34): integrações novas (mensagem de saída → filas → parceiros), entrada idempotente,
// monitor de filas com reprocessamento, FHIR R4 e RNDS, HL7 v2 pelo motor de integração, comunicação com o paciente
// pela Hal-AI e o retorno do laboratório de apoio conferido pelo responsável técnico.
export { ARMAZEM_CONTEUDO, ESTABELECIMENTOS_ENTRADA, IntegracaoController } from './integracao.controller.js';
export { PORTA_INTEGRACAO, type PortaIntegracao, type TrilhaIntegracao } from './porta.js';
export { portaIntegracaoIndisponivel, PortaIntegracaoPropria } from './porta-propria.js';
export { EXAME_SINTETICO_APOIO, ORU_SINTETICO, PortaIntegracaoMemoria } from './porta-memoria.js';
export {
  type ArmazemConteudo,
  ArmazemConteudoMemoria,
  ArmazemConteudoArquivos,
  armazemConteudoIndisponivel,
  resumoSha256,
} from './infra/armazem-conteudo.js';
// M47 (etapa 3): a credencial do parceiro conferida também na entrada do status do exame (PACS).
export { lerAutorizacaoBasica, segredoConfere } from './aplicacao/credencial.js';
// M58-F4: a fachada da API de integração da Hal-AI (serviço com o contrato da API original, painel e configuração).
export { criarServicoFachada, FachadaController, SERVICO_FACHADA } from './fachada/fachada.controller.js';
export { PORTA_FACHADA, type PortaFachada } from './fachada/porta.js';
export { portaFachadaIndisponivel, PortaFachadaPropria } from './fachada/porta-propria.js';
export { PortaFachadaMemoria } from './fachada/porta-memoria.js';
export { type Repassador, ServicoFachada } from './fachada/servico.js';
export { moduloIntegracao, type OpcoesModuloIntegracao } from './modulo.js';
