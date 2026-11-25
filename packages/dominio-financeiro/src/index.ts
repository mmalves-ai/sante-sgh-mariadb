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
export * from './nfse-ciclo.js';
export * from './reinf-eventos.js';
export * from './escrituracao-entrada.js';
export * from './declaracoes.js';
export * from './lote-contabil.js';
export * from './depara-contabil.js';
export * from './retencao-regra.js';
export * from './apuracao-retido.js';
export * from './retencao-sofrida.js';
export * from './remessa.js';
export * from './retorno-pagamento.js';
export * from './chave-pix.js';
export * from './credor-conta.js';
export * from './pagamento-eletronico.js';
export * from './adiantamento.js';
export * from './indicadores.js';
export * from './orcamento.js';
export * from './orcamento-premissas.js';
export * from './baixa-pagar.js';
export * from './prorrogacao.js';
export * from './periodo-financeiro.js';
export * from './reclassificacao.js';
export * from './permissao-financeiro.js';
export * from './recebivel-cartao.js';
export * from './encontro-contas.js';
export * from './previsao-provisao.js';
export * from './nota-credito-cessao.js';
export * from './alteracao-titulo-pagar.js';
