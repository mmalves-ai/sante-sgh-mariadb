// Módulo da assinatura ICP-Brasil da API (M49, etapa 1): serviço isolado (o hash, nunca o documento), provedor em
// nuvem por OAuth 2.0 + PKCE, agente local A1/A3, validação no servidor, carimbo do tempo, política por tipo de
// documento e o cofre dos segredos dos provedores; o simulador do provedor, da ACT e da LCR só em dev/ci.
export { AssinaturaIcpController, CONFIG_ASSINATURA_ICP } from './assinatura.controller.js';
export { type ConfigServicoAssinatura, ServicoAssinaturaIcp } from './aplicacao/servico.js';
export { configAssinaturaDoAmbiente, modoAssinaturaIcp } from './infra/ambiente.js';
// M59-F3: o mesmo cofre guarda as credenciais de parceiro que substituem os segredos das tabelas do banco.
export { type Cofre, CofreMemoria, cofreDoAmbiente, cofreIndisponivel } from './infra/cofre.js';
export {
  type ContextoAssinatura,
  PORTA_ASSINATURA_ICP,
  type PortaAssinaturaIcp,
  portaAssinaturaIndisponivel,
} from './porta.js';
export { type NucleoAssinatura, PortaAssinaturaPropria } from './porta-propria.js';
export { modulo, type OpcoesModuloAssinatura } from './modulo.js';
export type * from './tipos.js';
export { ErroAssinatura, TIPOS_DOCUMENTO_ICP } from './tipos.js';
export { PortaAssinaturaMemoria } from './porta-memoria.js';
export { SimuladorIcp } from './infra/simulador.js';
// M49, etapa 2: documentos emitidos (prévia exata, lote, pendências e reprocessamento, selo e PDF assinado, SNCR).
export {
  AssinaturaDocumentosController,
  reprocessamentoLigado,
  sessaoDoAgendador,
} from './assinatura-documentos.controller.js';
export {
  type ArmazemPdfIcp,
  type ClienteSncr,
  type ConfigDocumentosIcp,
  type ConteudoIcp,
  type FonteConteudoIcp,
  ServicoAssinaturaDocumentos,
} from './aplicacao/documentos.js';
export {
  ARMAZEM_PDF_ICP,
  CONFIG_DOCUMENTOS_ICP,
  FONTE_CONTEUDO_ICP,
  SERVICO_ASSINATURA_ICP,
} from './simbolos.js';
export { type DocumentosMemoriaIcp } from './porta-memoria.js';
export { SimuladorSncr } from './infra/simulador-sncr.js';
export {
  armazemPdfIcp,
  configDocumentosIcpDoAmbiente,
  politicaDoAmbiente,
} from './infra/documentos-ambiente.js';
// M49, etapa 3: verificador público (sem login, limite de taxa) e o painel interno das consultas.
export { SERVICO_VERIFICADOR, VerificadorController } from './verificador.controller.js';
export {
  type ConfigVerificador,
  estabelecimentosDoVerificador,
  ServicoVerificador,
  TETO_GLOBAL_VERIFICADOR_POR_MINUTO,
} from './aplicacao/verificador.js';
// M49, etapa 3: a entrada com certificado A1/A3 (a conferência; a porta de entrada abre a sessão).
export { ServicoLoginCertificado } from './aplicacao/login-certificado.js';
