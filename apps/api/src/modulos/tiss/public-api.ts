// Módulo do pós-fechamento da API (M31): guias, lotes TISS 04.03.00 e protocolo, prazos, competências,
// demonstrativos, retorno e glosa, webservices por operadora e o painel de glosas.
export {
  ARMAZEM_XML_TISS,
  GERADOR_PDF_TISS,
  type GeradorPdfTiss,
  TissController,
} from './tiss.controller.js';
export { PORTA_TISS, type PortaTiss } from './porta.js';
export { type NucleoTiss, portaTissIndisponivel, PortaTissPropria } from './porta-propria.js';
export { type FonteContasMemoria, PortaTissMemoria } from './porta-memoria.js';
export { type ArmazemXmlTiss, armazemXmlLocal, armazemXmlMemoria } from './armazem-xml.js';
export { modulo, type OpcoesModuloTiss, portaDoTiss } from './modulo.js';
