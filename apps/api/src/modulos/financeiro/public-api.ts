// Módulo do financeiro e fiscal da API (M32): contas a pagar (alçada, borderô, remessa), contas a receber (título da
// conta, glosa no título, baixa manual), tesouraria (movimento, extrato, conciliação, fluxo), gerencial (DRE) e fiscal
// (escrituração, NFS-e, DMED, EFD-REINF, exportação contábil).
export { FinanceiroController } from './financeiro.controller.js';
export { ARMAZEM_FINANCEIRO } from './simbolos.js';
export { PORTA_FINANCEIRO, type PortaFinanceiro } from './porta.js';
export {
  type NucleoFinanceiro,
  portaFinanceiroIndisponivel,
  PortaFinanceiroPropria,
} from './porta-propria.js';
export {
  type CatalogoOperacoesFinanceiro,
  contasBancariasSinteticasDoEscopo,
  PortaFinanceiroMemoria,
} from './porta-memoria.js';
export { type ArmazemFinanceiro, armazemFinanceiroLocal, armazemFinanceiroMemoria } from './armazem.js';
export { ServicoFinanceiro } from './servico.js';
export { ApoiosFinanceiro } from './apoios.js';
export {
  type EntradaTituloComposto,
  gravadorTituloPagar,
  type GravadorTituloPagar,
  TABELAS_TITULO_PAGAR,
  type TituloPagarGravado,
} from './operacoes.js';
// F3.8 (07-FIN linha 89): a venda em cartão do caixa grava a transação e as parcelas a receber da administradora.
export { gravarRecebivelCartao, TABELAS_RECEBIVEL_CARTAO, type VendaCartao } from './cartao-propria.js';
