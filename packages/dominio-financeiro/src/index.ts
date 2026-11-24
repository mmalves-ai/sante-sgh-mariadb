// @sgh/dominio-financeiro: financeiro e fiscal (M32). Regras puras: sem banco, sem HTTP. As regras que o adaptador do
// legado também confere moram em `@sgh/contratos/regras-financeiro` (reexportadas aqui); estas são as do novo: DRE com
// duas réguas, fluxo de caixa, conciliação por regra, extrato, NFS-e, DMED e EFD-REINF, lote contábil, remessa e os
// indicadores.
export * from '@sgh/contratos/regras-financeiro';
export * from './dre.js';
export * from './fluxo-caixa.js';
export * from './conciliacao.js';
export * from './extrato.js';
export * from './nfse.js';
export * from './declaracoes.js';
export * from './lote-contabil.js';
export * from './remessa.js';
export * from './adiantamento.js';
export * from './indicadores.js';
export * from './orcamento.js';
export * from './prorrogacao.js';
