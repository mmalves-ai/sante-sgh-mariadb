// Fronteira do módulo documento (M09): o que os outros módulos da API podem usar.
export { DocumentoController } from './documento.controller.js';
export { criarFonteDocumento, FONTE_DOCUMENTO, type FonteDocumento } from './fonte.js';
export { EmissaoService, politicaRetencao, type PedidoEmissao } from './aplicacao/emissao.service.js';
// M34: a conversão HTML → PDF/A da exportação dos relatórios e o S3 do conteúdo bruto das integrações.
export { converterHtmlEmPdfA } from './infra/gotenberg.js';
export { ClienteS3 } from './infra/s3.js';
