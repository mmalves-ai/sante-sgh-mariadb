// Fronteira do módulo documento (M09): o que os outros módulos da API podem usar.
export { DocumentoController } from './documento.controller.js';
export { criarFonteDocumento, FONTE_DOCUMENTO, type FonteDocumento } from './fonte.js';
export { EmissaoService, politicaRetencao, type PedidoEmissao } from './aplicacao/emissao.service.js';
// M34: a conversão HTML → PDF/A da exportação dos relatórios.
export { converterHtmlEmPdfA } from './infra/gotenberg.js';
// ADR 0004: a porta de arquivos escolhida pelo ambiente (catálogos, integrações e os demais módulos).
export {
  armazemArquivosDoAmbiente,
  estabelecimentoDoCliente,
  type ResolverEstabelecimento,
  ArmazemArquivosMemoria,
  armazemSobDemanda,
  idDoArquivo,
} from './infra/arquivos.js';
