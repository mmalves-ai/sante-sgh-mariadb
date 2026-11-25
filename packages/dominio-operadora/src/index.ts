// @sgh/dominio-operadora (M56): regras puras da operadora própria, sem banco nem Nest. Etapa F0: chaves por fatia
// (regra 1), natureza do produto e registro na ANS (regras 2 e 3), destino dos envios e das mensagens (regras 6 e 7)
// e a conferência do inventário dos domínios. F1 (M56.2): documentos, operadora, plano (RN 63 e carências), contrato,
// beneficiário, carteirinha e elegibilidade. Etapa 4 (F3): a rede credenciada (documento, CNES, município, contrato,
// movimento do RPS e descredenciamento). As demais fatias acrescentam cobrança, autorização, contas médicas (XSD
// TISS) e os leiautes da ANS. Etapa 5 (F4): a autorização de guias e a auditoria médica (protocolo, prazo, críticas,
// decisão, junta e senha).
export * from './liberacao.js';
export * from './produto.js';
export * from './documentos.js';
export * from './plano.js';
export * from './contrato.js';
export * from './beneficiario.js';
export * from './carteirinha.js';
export * from './elegibilidade.js';
export * from './sinteticos.js';
export * from './rede.js';
export * from './cobranca.js';
// F7 (08-SGO L96, C1-086): índice de reajuste, agrupamento do coletivo pequeno e regra por sinistralidade.
export * from './reajuste-coletivo.js';
// F7 (08-SGO linha 98): coparticipação com tetos por evento, mês e ano.
export * from './coparticipacao.js';
export * from './autorizacao.js';
// Etapa 6 (F5): as contas médicas recebidas (protocolo, críticas e glosa automática, revisão, recurso e pagamento).
export * from './conta.js';
export * from './conta-conferencia.js';
// Etapa 7 (F6): as obrigações com a ANS (SIB, SIP, DIOPS, TPS, monitoramento TISS e ressarcimento ao SUS).
export * from './ans/envio.js';
export * from './ans/comum.js';
export * from './ans/sib.js';
export * from './ans/sip.js';
export * from './ans/diops.js';
export * from './ans/tps.js';
export * from './ans/monitoramento.js';
export * from './ans/ressarcimento.js';
export * from './ans/retorno.js';
export * from './ans/declaracoes.js';
// Etapa 8 (F7): o atendimento ao beneficiário com protocolo e o acesso ao portal do prestador.
export * from './atendimento.js';
// F7 (08-SGO linhas 93 a 95): responsáveis, setores, parâmetros, aditivo, cancelamento, abrangência, carência e cartão.
export * from './cadastro-complementar.js';
