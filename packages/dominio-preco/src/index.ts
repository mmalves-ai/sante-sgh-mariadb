// @sgh/dominio-preco (M12): regras puras do motor de preços e dos convênios, sem banco (o motor de conta é o
// do legado; cap-11 §11.3). Usadas pela API (propostas, consultas, importação) e testadas com 90% de
// cobertura; as receitas de gravação (@sgh/legado) reconferem no banco o que vale na transação.
export * from './vigencia.js';
export * from './modelo-valor.js';
export * from './impacto.js';
export * from './proposta-reajuste.js';
export * from './comparacao-importacao.js';
export * from './convenio-aceita-atendimento.js';
export * from './busca.js';
export * from './saneamento.js';
export * from './preco-particular.js';
export * from './credenciamento.js';
export * from './cobranca-fonte.js';
export * from './regras-acordo.js';
export * from './regras-acordo-calculo.js';
export * from './indice-cobranca.js';
export * from './simulacao-reajuste-item.js';
