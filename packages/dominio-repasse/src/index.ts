// @sgh/dominio-repasse (M33): regras puras do repasse médico, sem banco nem Nest. Usadas pela API (simulador, apuração,
// lançamento, RPA, extrato) e pelo teste dourado; as receitas de gravação (@sgh/legado) reconferem no banco, dentro da
// transação, o que vale (credenciamento, período não apurado no outro sistema, lançamento ainda sem RPA).
export * from './dinheiro.js';
export * from './regra.js';
export * from './resolver-regra.js';
export * from './base-calculo.js';
export * from './beneficiario.js';
export * from './adicionais.js';
export * from './calculo.js';
export * from './versao-regra.js';
export * from './apuracao.js';
export * from './rpa.js';
export * from './credor.js';
export * from './estorno.js';
export * from './dourado.js';
export * from './particular-integral.js';
export * from './producao.js';
export * from './producao-conta.js';
export * from './favorecido.js';
