// Permissões do portal do paciente, etapa 1 do M50 (ficha, seção 7; convencoes.md §12). Dois lados:
//   - telas internas (recepção, atendimento, privacidade): emitir o convite, ver a situação da conta, bloquear,
//     desbloquear e encerrar, conferir a prova de vínculo do responsável legal. Quem tem a opção no outro sistema tem a
//     permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json):
//     Termo de consentimento do cadastro de pacientes, ambulatório 6533 (Consultar 6534, Incluir 6535, Alterar 6536,
//     Ações 6537), pesquisa de pacientes 6538 (6539 a 6542) e internação 6589 (6590 a 6593); a área de privacidade
//     (Privacidade e proteção de dados, opção raiz do módulo de abertura, a mesma do M10). Não há opção de "portal do
//     paciente" no outro sistema: o portal de lá (PFPORTALLOGIN, 0 linha no pc) é do prestador credenciado.
//   - portal (identidade própria em SGH_POR_CONTA, nunca TBUSERS): o servidor do portal dá à SESSÃO DO PORTAL os perfis
//     `portal-paciente` (o titular) e `portal-responsavel` (quem tem vínculo vigente); a permissão nunca vem de usuário
//     interno, e o escopo do vínculo (documentos, consentimentos, pedidos) é conferido em cada pedido.
import { OPCOES_M10 } from './administracao.js';
import { OPCOES_FINANCEIRO_M32 as OF } from './financeiro.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_PORTAL = {
  termoAmbulatorio: 6533,
  termoAmbulatorioConsultar: 6534,
  termoAmbulatorioIncluir: 6535,
  termoAmbulatorioAlterar: 6536,
  termoAmbulatorioAcoes: 6537,
  termoPesquisa: 6538,
  termoPesquisaConsultar: 6539,
  termoPesquisaIncluir: 6540,
  termoPesquisaAlterar: 6541,
  termoPesquisaAcoes: 6542,
  termoInternacao: 6589,
  termoInternacaoConsultar: 6590,
  termoInternacaoIncluir: 6591,
  termoInternacaoAlterar: 6592,
  termoInternacaoAcoes: 6593,
} as const;

const O = OPCOES_PORTAL;

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

const LER = [
  O.termoAmbulatorio,
  O.termoAmbulatorioConsultar,
  O.termoPesquisa,
  O.termoPesquisaConsultar,
  O.termoInternacao,
  O.termoInternacaoConsultar,
];
const AGIR = [
  O.termoAmbulatorioIncluir,
  O.termoAmbulatorioAlterar,
  O.termoPesquisaIncluir,
  O.termoPesquisaAlterar,
  O.termoInternacaoIncluir,
  O.termoInternacaoAlterar,
];
const ACOES = [O.termoAmbulatorioAcoes, O.termoPesquisaAcoes, O.termoInternacaoAcoes];

const interna = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'sensivel',
  ...extra,
});

const doPortal = (codigo: string, descricao: string, perfis: readonly string[]): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado: [],
  concessaoPorPerfil: 'por-perfil',
  perfis,
  categoria: 'administrativa',
  criticidade: 'normal',
});

export const PERMISSOES_PORTAL_M50: readonly DeclaracaoPermissao[] = [
  interna(C.contaLer, 'Ver a situação da conta do portal do paciente (sem e-mail completo nem segredo)', [
    ...LER,
    OPCOES_M10.privacidade,
  ]),
  interna(
    C.contaConvidar,
    'Emitir o convite do portal para o paciente (código impresso, válido por prazo curto)',
    AGIR,
  ),
  interna(
    C.contaBloquear,
    'Bloquear ou desbloquear a conta do portal do paciente (e redefinir o segundo fator)',
    [...ACOES, OPCOES_M10.privacidade],
    { criticidade: 'critica' },
  ),
  interna(
    C.contaTrocarEmail,
    'Trocar o e-mail de acesso da conta do portal do paciente no balcão (com o documento conferido e a confirmação no e-mail novo)',
    [...ACOES, OPCOES_M10.privacidade],
    { criticidade: 'critica' },
  ),
  interna(
    C.contaEncerrar,
    'Encerrar a conta do portal do paciente (óbito, unificação, pedido do titular)',
    [OPCOES_M10.privacidade],
    { criticidade: 'critica' },
  ),
  interna(
    C.vinculoConferir,
    'Conferir a prova de vínculo do responsável legal e aprovar, recusar ou encerrar o acesso',
    [...ACOES, OPCOES_M10.privacidade],
    { criticidade: 'critica' },
  ),
  interna(
    C.copiaConferir,
    "Cópia do prontuário: abrir o pedido no balcão, conferir a legitimidade de quem pede, gerar o PDF com marca d'água e registrar a entrega",
    [OPCOES_M10.privacidade],
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
/** Opções do outro sistema citadas aqui (retrato tools/verificadores/dados/acesso-legado.pc.json). */
export const OPCOES_PORTAL_E2 = {
  agendaAcessar: 3310,
  agendaManutencao: 3311,
  agendaConsulta: 3313,
  geradorSenhas: 3308,
  atendimentosIncluir: 5745,
  sadtAtendimentos: 2728,
} as const;
const O2 = OPCOES_PORTAL_E2;

export const PERMISSOES_PORTAL_M50_E2: readonly DeclaracaoPermissao[] = [
  interna(
    E2.agendaOnlineLer,
    'Ver quais agendas aparecem no portal do paciente, com convênios, serviços, prazos e valor',
    [O2.agendaAcessar, O2.agendaManutencao, O2.agendaConsulta],
    { criticidade: 'normal' },
  ),
  interna(
    E2.agendaOnlineConfigurar,
    'Liberar ou retirar uma agenda do portal do paciente e definir convênios, serviços, prazos e valor',
    [O2.agendaManutencao],
  ),
  interna(
    E2.precheckinConferir,
    'Conferir o pré-check-in enviado pelo paciente (aprovar os dados para o cadastro ou recusar com o motivo)',
    [O2.atendimentosIncluir, O2.geradorSenhas, O2.sadtAtendimentos],
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
    [OF.extratoBancario, OF.creditosBaixa],
    { criticidade: 'sensivel' },
  ),
  interna(
    E2.pagamentoEstornar,
    'Tesouraria: estornar pelo gateway a cobrança do portal do paciente, com motivo (quem conciliou não estorna)',
    [OF.creditosBaixa, OF.bancarioIncluir],
    { criticidade: 'critica' },
  ),
  doPortal(
    E2.pesquisaResponder,
    'No portal: responder a pesquisa de satisfação depois do atendimento',
    PERFIS_SESSAO_PORTAL,
  ),
];
