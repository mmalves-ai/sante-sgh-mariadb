// Módulo SADT da API (M26): laboratório, imagem, métodos gráficos, endoscopia, laudos e o portal de resultados.
export { AVISOS_SADT, SadtController, VIGIA_CRITICOS } from './sadt.controller.js';
export {
  CABECALHO_CSRF_PORTAL,
  COOKIE_CSRF_PORTAL,
  COOKIE_PORTAL,
  COOKIE_PORTAL_DEV,
  PortalController,
  SERVICO_PORTAL,
} from './portal.controller.js';
export { ligadaNoEstabelecimento } from './aplicacao/liberacao.js';
export { PORTA_SADT, type PortaSadt } from './porta.js';
export { portaSadtIndisponivel, PortaSadtPropria } from './porta-propria.js';
export { PortaSadtMemoria } from './porta-memoria.js';
export { type AcessoPortal, ServicoPortal } from './aplicacao/portal.js';
export { VigiaCriticos } from './aplicacao/vigia-criticos.js';
export { CENTRAL_AVISOS_SADT, type CentralDeAvisos } from './aplicacao/central-critico.js';
// M47 (etapa 3): a lista de trabalho DICOM e a integração com o PACS/RIS.
export { PacsController, SERVICO_PACS } from './pacs.controller.js';
export { PORTA_PACS, type PortaPacs } from './pacs-porta.js';
export { portaPacsIndisponivel, PortaPacsPropria } from './pacs-porta-propria.js';
export { PortaPacsMemoria } from './pacs-porta-memoria.js';
export { modoPacs, ServicoPacs } from './aplicacao/pacs.js';
export { moduloSadt, portasDoSadt } from './modulo.js';
// Laboratório de apoio (05-SADT linha 14): o retorno do resultado no item e na situação da remessa.
export { marcarRetornoNaRemessa, TABELAS_RETORNO_REMESSA } from './aplicacao/apoio-retorno-remessa.js';
