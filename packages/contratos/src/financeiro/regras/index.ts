// Regras puras do financeiro e fiscal (M32; ficha, seção 8). Moram em @sgh/contratos (subcaminho
// `@sgh/contratos/regras-financeiro`, fora do índice) porque o adaptador do legado também as confere antes de gravar
// (fronteira Nx: o legado só depende de contratos); os testes e a cobertura ficam em @sgh/dominio-financeiro.
export * from './recusa.js';
export * from './credor.js';
export * from './titulo-pagar.js';
export * from './situacao-titulo.js';
export * from './segregacao.js';
export * from './alcada.js';
export * from './classificacao.js';
export * from './titulo-receber.js';
export * from './glosa-titulo.js';
export * from './tipo-movimento.js';
