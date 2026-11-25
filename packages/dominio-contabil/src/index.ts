// @sgh/dominio-contabil (M54): regras puras da contabilidade, sem banco nem Nest. Usadas pelo worker (leitura
// incremental dos fatos e contabilização), pela API (plano, regras, reprocessamento) e pelo `pnpm contabil:reprocessar`.
export * from './dinheiro.js';
export * from './plano.js';
export * from './fatos.js';
export * from './derivacao.js';
export * from './receita.js';
export * from './fontes.js';
export * from './depara.js';
export * from './partidas.js';
export * from './regra.js';
export * from './periodo.js';
export * from './reprocessamento.js';
export * from './registro.js';
export * from './ciclo.js';
export * from './lancamentos.js';
export * from './demonstracoes.js';
export * from './sped.js';
export * from './publicacao.js';
export * from './consolidacao.js';
