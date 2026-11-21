import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_CODIGOS_PORTAL = {
  contaLer: 'portal.conta.ler',
  contaConvidar: 'portal.conta.convidar',
  contaBloquear: 'portal.conta.bloquear',
  contaEncerrar: 'portal.conta.encerrar',
  /** W0-10: registrar o e-mail novo da conta no balcão (vale com a confirmação no e-mail novo) ou cancelar o pedido. */
  contaTrocarEmail: 'portal.conta.trocarEmail',
  vinculoConferir: 'portal.vinculo.conferir',
  /** W0-10 (M2): a fila da cópia do prontuário: abrir no balcão, conferir a legitimidade, gerar o PDF e entregar. */
  copiaConferir: 'portal.copia.conferir',
  // Sessão do portal.
  documentoLer: 'portal.documento.ler',
  consentimentoRegistrar: 'portal.consentimento.registrar',
  pedidoRegistrar: 'portal.pedido.registrar',
  vinculoPedir: 'portal.vinculo.pedir',
  acessosLer: 'portal.acessos.ler',
} as const;

const C = PERMISSOES_CODIGOS_PORTAL;

/** Perfis da sessão do portal (dados pelo servidor do portal; nunca a usuário interno). */
export const PERFIS_SESSAO_PORTAL = ['portal-paciente', 'portal-responsavel'] as const;

const interna = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'sensivel',
  ...extra,
});

const doPortal = (codigo: string, descricao: string, perfis: readonly string[]): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: 'por-perfil',
  perfis,
  categoria: 'administrativa',
  criticidade: 'normal',
});

export const PERMISSOES_PORTAL_M50: readonly DeclaracaoPermissao[] = [
  interna(C.contaLer, 'Ver a situação da conta do portal do paciente (sem e-mail completo nem segredo)'),
  interna(
    C.contaConvidar,
    'Emitir o convite do portal para o paciente (código impresso, válido por prazo curto)',
  ),
  interna(
    C.contaBloquear,
    'Bloquear ou desbloquear a conta do portal do paciente (e redefinir o segundo fator)',

    { criticidade: 'critica' },
  ),
  interna(
    C.contaTrocarEmail,
    'Trocar o e-mail de acesso da conta do portal do paciente no balcão (com o documento conferido e a confirmação no e-mail novo)',

    { criticidade: 'critica' },
  ),
  interna(
    C.contaEncerrar,
    'Encerrar a conta do portal do paciente (óbito, unificação, pedido do titular)',

    { criticidade: 'critica' },
  ),
  interna(
    C.vinculoConferir,
    'Conferir a prova de vínculo do responsável legal e aprovar, recusar ou encerrar o acesso',

    { criticidade: 'critica' },
  ),
  interna(
    C.copiaConferir,
    "Cópia do prontuário: abrir o pedido no balcão, conferir a legitimidade de quem pede, gerar o PDF com marca d'água e registrar a entrega",

    { criticidade: 'critica' },
  ),
  doPortal(
    C.documentoLer,
    'No portal: ver os resultados liberados e os documentos assinados',
    PERFIS_SESSAO_PORTAL,
  ),
  doPortal(
    C.consentimentoRegistrar,
    'No portal: dar, negar ou revogar consentimento por finalidade',
    PERFIS_SESSAO_PORTAL,
  ),
  doPortal(
    C.pedidoRegistrar,
    'No portal: abrir e acompanhar pedidos do titular (LGPD art. 18)',
    PERFIS_SESSAO_PORTAL,
  ),
  doPortal(C.vinculoPedir, 'No portal: pedir acesso como responsável legal e revogar o acesso de outro', [
    'portal-paciente',
    'portal-responsavel',
  ]),
  doPortal(C.acessosLer, 'No portal: ver quem acessou o próprio prontuário', PERFIS_SESSAO_PORTAL),
];

// ── Etapa 2 do M50: agendamento online, pré-check-in, pagamento e pesquisa ─────────────────────────────────────────
// Telas internas: a configuração da agenda online pelas opções de manutenção da agenda (Recepção externa › Agenda ›
// Manutenção/criação 3311, a mesma do cadastro das agendas do M17; e a manutenção da agenda de exames do M18); a
// conferência do pré-check-in pelas opções da recepção externa (M19: Atendimentos › Incluir 5745, Gerador de senhas 3308
// e S.A.D.T. › Atendimentos 2728, as mesmas do check-in). Gravar o que foi conferido no cadastro exige também
// `cadastro.paciente.editar` (a receita do M11 roda com quem conferiu). Portal: os perfis da sessão do portal.
export const PERMISSOES_CODIGOS_PORTAL_E2 = {
  agendaOnlineLer: 'agenda.online.ler',
  agendaOnlineConfigurar: 'agenda.online.configurar',
  precheckinConferir: 'recepcao.precheckin.conferir',
  // Sessão do portal.
  agendamentoRegistrar: 'portal.agendamento.registrar',
  precheckinEnviar: 'portal.precheckin.enviar',
  pagamentoRegistrar: 'portal.pagamento.registrar',
  pesquisaResponder: 'portal.pesquisa.responder',
  /** W0-10: a tesouraria vê e concilia as cobranças do portal (baixa e divergência; quem cobrou não concilia). */
  pagamentoConciliar: 'portal.pagamento.conciliar',
  /** W0-10: o estorno da cobrança do portal pelo gateway (quem conciliou não estorna; crítica, com reautenticação). */
  pagamentoEstornar: 'portal.pagamento.estornar',
} as const;

const E2 = PERMISSOES_CODIGOS_PORTAL_E2;

export const PERMISSOES_PORTAL_M50_E2: readonly DeclaracaoPermissao[] = [
  interna(
    E2.agendaOnlineLer,
    'Ver quais agendas aparecem no portal do paciente, com convênios, serviços, prazos e valor',

    { criticidade: 'normal' },
  ),
  interna(
    E2.agendaOnlineConfigurar,
    'Liberar ou retirar uma agenda do portal do paciente e definir convênios, serviços, prazos e valor',
  ),
  interna(
    E2.precheckinConferir,
    'Conferir o pré-check-in enviado pelo paciente (aprovar os dados para o cadastro ou recusar com o motivo)',
  ),
  doPortal(
    E2.agendamentoRegistrar,
    'No portal: marcar, cancelar e remarcar consultas e exames nas agendas liberadas',
    PERFIS_SESSAO_PORTAL,
  ),
  doPortal(
    E2.precheckinEnviar,
    'No portal: enviar o pré-check-in (contato, documentos, carteirinha e termo)',
    PERFIS_SESSAO_PORTAL,
  ),
  doPortal(
    E2.pagamentoRegistrar,
    'No portal: pagar a consulta ou o exame particular (Pix ou cartão)',
    PERFIS_SESSAO_PORTAL,
  ),
  interna(
    E2.pagamentoConciliar,
    'Tesouraria: ver e conciliar as cobranças do portal do paciente com o extrato do gateway (quem cobrou não concilia)',

    { criticidade: 'sensivel' },
  ),
  interna(
    E2.pagamentoEstornar,
    'Tesouraria: estornar pelo gateway a cobrança do portal do paciente, com motivo (quem conciliou não estorna)',

    { criticidade: 'critica' },
  ),
  doPortal(
    E2.pesquisaResponder,
    'No portal: responder a pesquisa de satisfação depois do atendimento',
    PERFIS_SESSAO_PORTAL,
  ),
];
