// Módulo operadora da API (M56, operadora própria): na etapa F0, a situação das chaves do módulo e das fatias e a
// consulta dos catálogos da ANS; na etapa 3 (F2), a cobrança e as mensalidades; na etapa 4 (F3), a rede credenciada. As fatias F1 a F8 acrescentam as delas.
export { OperadoraController } from './operadora.controller.js';
export { BeneficiariosOperadoraController } from './beneficiarios.controller.js';
export { ServicoBeneficiariosOperadora } from './aplicacao/beneficiarios.js';
export { type GravadorOperadora, PORTA_OPERADORA, type PortaOperadora } from './porta.js';
export { portaOperadoraIndisponivel, portaOperadoraLegado } from './porta-legado.js';
export { PortaOperadoraMemoria } from './porta-memoria.js';
export { ServicoSituacaoOperadora, type SujeitoOperadora } from './aplicacao/situacao.js';
export { RedeOperadoraController } from './rede.controller.js';
export { PORTA_REDE_OPERADORA, type PortaRedeOperadora } from './rede-porta.js';
export { portaRedeOperadoraIndisponivel, portaRedeOperadoraLegado } from './rede-porta-legado.js';
export { PortaRedeOperadoraMemoria } from './rede-porta-memoria.js';
export { CobrancaOperadoraController } from './cobranca.controller.js';
export { PORTA_COBRANCA_OPERADORA, type PortaCobrancaOperadora } from './cobranca-porta.js';
export { portaCobrancaOperadoraIndisponivel, portaCobrancaOperadoraLegado } from './cobranca-porta-legado.js';
export { PortaCobrancaOperadoraMemoria } from './cobranca-porta-memoria.js';
// M56 (etapa 5, F4): a autorização de guias e a auditoria médica.
export { AutorizacaoOperadoraController } from './autorizacao.controller.js';
export { PORTA_AUTORIZACAO_OPERADORA, type PortaAutorizacaoOperadora } from './autorizacao-porta.js';
export {
  portaAutorizacaoOperadoraIndisponivel,
  portaAutorizacaoOperadoraLegado,
} from './autorizacao-porta-legado.js';
export { PortaAutorizacaoOperadoraMemoria } from './autorizacao-porta-memoria.js';
// M56 (etapa 6, F5): as contas médicas recebidas (XML TISS, glosa, recurso e pagamento ao prestador).
export { ContasOperadoraController } from './contas.controller.js';
export { PORTA_CONTAS_OPERADORA, type PortaContasOperadora } from './contas-porta.js';
export { portaContasOperadoraIndisponivel, portaContasOperadoraLegado } from './contas-porta-legado.js';
export { PortaContasOperadoraMemoria } from './contas-porta-memoria.js';
// M56 (etapa 7, F6): as obrigações com a ANS (SIB, SIP, DIOPS, TPS, monitoramento TISS e ressarcimento ao SUS).
export { AnsOperadoraController } from './ans.controller.js';
export { PORTA_ANS_OPERADORA, type PortaAnsOperadora } from './ans-porta.js';
export { portaAnsOperadoraIndisponivel, portaAnsOperadoraLegado } from './ans-porta-legado.js';
export { PortaAnsOperadoraMemoria } from './ans-porta-memoria.js';
// M56 (etapa 8, F7): o atendimento ao beneficiário com protocolo e o portal do prestador credenciado.
export { AtendimentoOperadoraController } from './atendimento.controller.js';
export { PORTA_ATENDIMENTO_OPERADORA, type PortaAtendimentoOperadora } from './atendimento-porta.js';
export {
  portaAtendimentoOperadoraIndisponivel,
  portaAtendimentoOperadoraLegado,
} from './atendimento-porta-legado.js';
export { PortaAtendimentoOperadoraMemoria } from './atendimento-porta-memoria.js';
export { PortalPrestadorController } from './portal-prestador.controller.js';
export { SERVICO_PORTAL_PRESTADOR, ServicoPortalPrestador } from './portal-prestador-servico.js';
