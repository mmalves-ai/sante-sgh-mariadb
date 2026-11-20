// Permissões do portal do médico externo, etapa 3 do M50 (ficha, seção 7; regra 6; DP-43; convencoes.md §12). Dois
// lados:
//   - tela interna: ver as contas do portal do médico externo e ligar a conta ao profissional do corpo clínico (de onde
//     saem o extrato do repasse e a agenda do bloco). Quem aprova o autocadastro no outro sistema (opção "Web - acesso
//     do médico solicitante", 4748, a mesma do M26) tem as permissões no novo (regra 1 do M06);
//   - portal (identidade própria em SGH_SADT_PORTAL_ACESSO, nunca TBUSERS): a SESSÃO DO PORTAL do perfil
//     `portal-medico-externo` vê só o extrato e a agenda do profissional ligado e pede cirurgia; nunca vem de usuário
//     interno.
import { OPCOES_SADT } from './sadt.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_CODIGOS_PORTAL_MEDICO = {
  contasLer: 'portal.medicoExterno.ler',
  vincular: 'portal.medicoExterno.vincular',
  // W0-10: bloquear, desbloquear e encerrar a conta, com motivo e reautenticação.
  contaGerir: 'portal.medicoExterno.conta',
  // Sessão do portal.
  extratoLer: 'portal.medicoExtrato.ler',
  agendaLer: 'portal.medicoAgenda.ler',
  cirurgiaPedir: 'portal.medicoCirurgia.pedir',
  // W0-10 (M4): os pacientes com vínculo assistencial e o resumo do prontuário de cada um (acesso na trilha).
  pacientesLer: 'portal.medicoPacientes.ler',
  // W0-10 (M5): o aviso de resultado crítico dos próprios pacientes e a ciência (registro novo, com a conduta).
  criticoCiencia: 'portal.medicoCritico.ciencia',
  // W0-10 (M6): assinar remotamente, com o certificado em nuvem, os documentos pendentes do profissional ligado.
  assinaturaRemota: 'portal.medicoAssinatura.assinar',
} as const;

const C = PERMISSOES_CODIGOS_PORTAL_MEDICO;

/** O perfil da sessão do portal do médico externo (dado pelo servidor do portal). */
export const PERFIS_SESSAO_PORTAL_MEDICO = ['portal-medico-externo'] as const;

const doPortal = (codigo: string, descricao: string): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado: [],
  concessaoPorPerfil: 'por-perfil',
  perfis: PERFIS_SESSAO_PORTAL_MEDICO,
  categoria: 'administrativa',
  criticidade: 'normal',
});

export const PERMISSOES_PORTAL_MEDICO_M50: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.contasLer,
    descricao:
      'Ver as contas do portal do médico externo, o profissional ligado e os pedidos de cirurgia em aberto',
    opcoesLegado: [OPCOES_SADT.webAcessoMedicoSolicitante],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  {
    codigo: C.vincular,
    descricao:
      'Ligar ou desligar a conta do médico externo ao profissional do corpo clínico (extrato e agenda dele no portal)',
    opcoesLegado: [OPCOES_SADT.webAcessoMedicoSolicitante],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: C.contaGerir,
    descricao:
      'Bloquear, desbloquear ou encerrar com motivo a conta do médico externo (a conta que operou não se exclui)',
    opcoesLegado: [OPCOES_SADT.webAcessoMedicoSolicitante],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'critica',
  },
  doPortal(C.extratoLer, 'No portal do médico externo: ver o próprio extrato de produção e repasse'),
  doPortal(C.agendaLer, 'No portal do médico externo: ver a própria agenda cirúrgica e os próprios pedidos'),
  doPortal(
    C.cirurgiaPedir,
    'No portal do médico externo: pedir cirurgia (fica solicitada até a secretaria do bloco confirmar) e retirar o pedido',
  ),
  doPortal(
    C.pacientesLer,
    'No portal do médico externo: ver os próprios pacientes (vínculo assistencial) e abrir o resumo do prontuário de cada um',
  ),
  doPortal(
    C.criticoCiencia,
    'No portal do médico externo: ver os avisos de resultado crítico dos próprios pacientes e registrar a ciência com a conduta',
  ),
  doPortal(
    C.assinaturaRemota,
    'No portal do médico externo: assinar com o certificado em nuvem os documentos pendentes do profissional ligado à conta',
  ),
];
