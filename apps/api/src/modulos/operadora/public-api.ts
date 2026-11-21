// Módulo operadora da API (M56, operadora própria): situação das chaves e catálogos da ANS (F0), beneficiários (F1),
// cobrança (F2), rede credenciada (F3), autorização (F4), contas médicas (F5), obrigações com a ANS (F6), atendimento
// ao beneficiário e portal do prestador (F7). Outros módulos falam com este só por aqui. As portas são as próprias
// sobre o banco do cliente (F2.2); as de memória ficam para dev/ci e os testes; a montagem é a do modulo.ts.
export { modulo, moduloOperadora, type OpcoesModuloOperadora, portasDaOperadora } from './modulo.js';
export { OperadoraController } from './operadora.controller.js';
export { BeneficiariosOperadoraController } from './beneficiarios.controller.js';
export { ServicoBeneficiariosOperadora } from './aplicacao/beneficiarios.js';
export { ServicoSituacaoOperadora, type SujeitoOperadora } from './aplicacao/situacao.js';
export {
  type ContextoOperadora,
  type GravadorOperadora,
  PORTA_OPERADORA,
  type PortaOperadora,
  portaOperadoraIndisponivel,
} from './porta.js';
export { PortaOperadoraPropria } from './porta-propria.js';
export { PortaOperadoraMemoria } from './porta-memoria.js';
export { RedeOperadoraController } from './rede.controller.js';
export {
  type ContextoRede,
  PORTA_REDE_OPERADORA,
  type PortaRedeOperadora,
  type Prestador,
  portaRedeOperadoraIndisponivel,
} from './rede-porta.js';
export { PortaRedeOperadoraPropria } from './rede-porta-propria.js';
export { PortaRedeOperadoraMemoria } from './rede-porta-memoria.js';
export { CobrancaOperadoraController } from './cobranca.controller.js';
export { PORTA_COBRANCA_OPERADORA, type PortaCobrancaOperadora } from './cobranca-porta.js';
export { PortaCobrancaOperadoraPropria } from './cobranca-porta-propria.js';
export { PortaCobrancaOperadoraMemoria } from './cobranca-porta-memoria.js';
export { AutorizacaoOperadoraController } from './autorizacao.controller.js';
export { PORTA_AUTORIZACAO_OPERADORA, type PortaAutorizacaoOperadora } from './autorizacao-porta.js';
export { PortaAutorizacaoOperadoraPropria } from './autorizacao-porta-propria.js';
export { PortaAutorizacaoOperadoraMemoria } from './autorizacao-porta-memoria.js';
export { ContasOperadoraController } from './contas.controller.js';
export { PORTA_CONTAS_OPERADORA, type PortaContasOperadora } from './contas-porta.js';
export { PortaContasOperadoraPropria } from './contas-porta-propria.js';
export { PortaContasOperadoraMemoria } from './contas-porta-memoria.js';
export { AnsOperadoraController } from './ans.controller.js';
export { PORTA_ANS_OPERADORA, type PortaAnsOperadora } from './ans-porta.js';
export { PortaAnsOperadoraPropria } from './ans-porta-propria.js';
export { PortaAnsOperadoraMemoria } from './ans-porta-memoria.js';
export { AtendimentoOperadoraController } from './atendimento.controller.js';
export { PORTA_ATENDIMENTO_OPERADORA, type PortaAtendimentoOperadora } from './atendimento-porta.js';
export { PortaAtendimentoOperadoraPropria } from './atendimento-porta-propria.js';
export { PortaAtendimentoOperadoraMemoria } from './atendimento-porta-memoria.js';
export { PortalPrestadorController } from './portal-prestador.controller.js';
export { SERVICO_PORTAL_PRESTADOR, ServicoPortalPrestador } from './portal-prestador-servico.js';
