// Módulo dos catálogos oficiais (M13). Outros módulos falam com este só por aqui.
export { CatalogosController } from './catalogos.controller.js';
export {
  type CargaDeCatalogo,
  type CtxCatalogos,
  ErroCargaCatalogo,
  FONTE_CATALOGOS,
  type FonteCatalogos,
  fonteCatalogosIndisponivel,
  type TrilhaCatalogo,
} from './fonte.js';
export { FonteCatalogosMemoria } from './fonte-memoria.js';
export { FonteCatalogosPropria } from './porta-propria.js';
export { fonteDosCatalogos, modulo } from './modulo.js';
export { SERVICO_CATALOGOS, ServicoCatalogos } from './servico.js';
