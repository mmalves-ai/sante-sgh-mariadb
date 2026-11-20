// Módulo dos catálogos oficiais (M13). Outros módulos falam com este só por aqui.
export { CatalogosController } from './catalogos.controller.js';
export {
  FONTE_CATALOGOS,
  type CtxCatalogos,
  type FonteCatalogos,
  fonteCatalogosIndisponivel,
  fonteCatalogosLegado,
} from './fonte.js';
export { FonteCatalogosMemoria } from './fonte-memoria.js';
export { SERVICO_CATALOGOS, ServicoCatalogos } from './servico.js';
