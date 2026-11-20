// @sgh/dominio-catalogo (M13): regras puras dos catálogos oficiais e importadores, sem banco. Usadas pela API
// (preparação, validação, comparação, decisão de publicar) e pelo worker (lotes, janela); a operação de
// gravação de cada catálogo (@sgh/legado) reconfere na transação o que vale no banco.
export * from './codigo.js';
export * from './charset.js';
export * from './leiautes/comum.js';
export * from './leiautes/csv-oficiais.js';
export * from './leiautes/posicoes.js';
export * from './leitura.js';
export * from './validacao.js';
export * from './comparacao.js';
export * from './carga/ciclo.js';
export * from './carga/janela.js';
export * from './edicao/vigencia.js';
export * from './carga/preparacao.js';
export * from './sinteticos.js';
