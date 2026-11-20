// Regra 3 do M08: a normalização e a busca de duplicidade moram em @sgh/contratos (a receita genérica do
// adaptador as usa dentro da transação; a tela, para avisar antes). Aqui, a reexportação para as regras do
// módulo config e o teste da regra (duplicidade.spec.ts).
export { mensagemDuplicidade, normalizarDescricao, procurarDuplicidade } from '@sgh/contratos';
export type { Duplicidade, ItemComparavel } from '@sgh/contratos';
