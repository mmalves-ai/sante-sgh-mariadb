// Permissões do M19 (ficha, seção 7; convencoes.md §12): recepção, senhas, guichês, totens e painéis. Quem tem a
// opção no legado tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato
// tools/verificadores/dados/acesso-legado.pc.json):
//   - Recepção externa (módulo 8): Gerador de senhas 3308 (a emissão no balcão), Atendimentos 5739 (Incluir 5745,
//     Consultar 6026: o balcão chama a senha e abre o atendimento), Controle de encaminhamento e localização 6034
//     (Alterar 6035, Incluir 6036, Consultar 6038), Estatísticas 3293; S.A.D.T. (9): Atendimentos 2728,
//     Controle de atendimentos 2781;
//   - liberação de guichês bloqueados (fechar o guichê deixado aberto por outra pessoa): 5572 (Recepção externa),
//     5571 (Recepção interna), 5569 (S.A.D.T.);
//   - prontuário (23) › Localizar paciente 3900: Chamar paciente 5149, Liberar paciente 5147, Encaminhar 3907,
//     Desfazer 5148 (os eventos do local de atendimento);
//   - Painel de atendimento (32): Senha atendimento 3969 (o totem), Painel atendimento 3970 e Salvar configurações
//     3971 (a TV de chamada), Painel portal 3972 e 3973 (os painéis de outros setores);
//   - Tabelas › Painel eletrônico 3724 (Recepção 3725, Opções de geração de senha 3726, Fluxos de senha 6712).
// As telas de cadastro (recepções, geradores, painéis) usam as permissões geradas das declarações do CRUD genérico
// (`recepcao.recepcao.*`, `recepcao.gerador.*`, `recepcao.painel.*`, `relatorio.painel.*`). A ação → opção é
// inferida (POL-1b) quando a árvore não tem item próprio (supervisor, indicadores, check-in) e é conferida com os
// chave-usuários da recepção (DP-3). O totem e o painel de TV não têm login de pessoa: entram pelo token de
// dispositivo (perfil Painel/Totem, cap-08 §8.3), nunca por estas permissões.
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_RECEPCAO = {
  geradorSenhas: 3308,
  atendimentos: 5739,
  atendimentosIncluir: 5745,
  atendimentosConsultar: 6026,
  encaminhamento: 6034,
  encaminhamentoAlterar: 6035,
  encaminhamentoIncluir: 6036,
  encaminhamentoConsultar: 6038,
  estatisticas: 3293,
  sadtAtendimentos: 2728,
  sadtControle: 2781,
  liberarGuicheExterna: 5572,
  liberarGuicheInterna: 5571,
  liberarGuicheSadt: 5569,
  localizarPaciente: 3900,
  chamarPaciente: 5149,
  liberarPaciente: 5147,
  encaminharPaciente: 3907,
  desfazerChamada: 5148,
  senhaAtendimento: 3969,
  painelAtendimento: 3970,
  painelAtendimentoSalvar: 3971,
  painelPortal: 3972,
  painelPortalSalvar: 3973,
  painelEletronico: 3724,
} as const;

const O = OPCOES_RECEPCAO;
const LIBERAR_GUICHE = [O.liberarGuicheExterna, O.liberarGuicheInterna, O.liberarGuicheSadt];

export const PERMISSOES_RECEPCAO_CODIGOS = {
  senhaLer: 'recepcao.senha.ler',
  senhaEmitir: 'recepcao.senha.emitir',
  senhaChamar: 'recepcao.senha.chamar',
  senhaEncaminhar: 'recepcao.senha.encaminhar',
  fluxoRegistrar: 'recepcao.fluxo.registrar',
  checkinRegistrar: 'recepcao.checkin.registrar',
  guicheLiberar: 'recepcao.guiche.liberar',
  supervisorLer: 'recepcao.supervisor.ler',
  indicadorLer: 'recepcao.indicador.ler',
  dispositivoLer: 'recepcao.dispositivo.ler',
  dispositivoEditar: 'recepcao.dispositivo.editar',
  termoAssinar: 'recepcao.termo.assinar',
  termoEditar: 'recepcao.termo.editar',
} as const;

const p = (
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
  criticidade: 'normal',
  escopos: ['unidade', 'local'],
  ...extra,
});

export const PERMISSOES_RECEPCAO_M19: readonly DeclaracaoPermissao[] = [
  p(
    'recepcao.senha.ler',
    'Ver a fila de senhas do guichê e do local (nome do paciente só na tela do guichê)',
    [
      O.geradorSenhas,
      O.atendimentos,
      O.atendimentosConsultar,
      O.encaminhamento,
      O.encaminhamentoConsultar,
      O.sadtAtendimentos,
      O.sadtControle,
      O.localizarPaciente,
    ],
  ),
  p('recepcao.senha.emitir', 'Emitir senha no balcão (o totem emite pelo token do dispositivo)', [
    O.geradorSenhas,
    O.atendimentosIncluir,
    O.sadtAtendimentos,
  ]),
  p(
    'recepcao.senha.chamar',
    'Abrir o guichê, chamar a próxima senha e conduzi-la (chamar de novo, suspender, não localizado, concluir)',
    [O.atendimentos, O.atendimentosIncluir, O.sadtAtendimentos, O.sadtControle],
  ),
  p('recepcao.senha.encaminhar', 'Encaminhar o paciente entre locais de atendimento permitidos', [
    O.encaminhamento,
    O.encaminhamentoAlterar,
    O.encaminhamentoIncluir,
    O.encaminharPaciente,
  ]),
  p(
    'recepcao.fluxo.registrar',
    'Registrar os eventos da senha no local de atendimento (chamar ao local, cancelar a chamada, não localizado, liberar)',
    [O.localizarPaciente, O.chamarPaciente, O.liberarPaciente, O.desfazerChamada, O.encaminhamentoAlterar],
  ),
  p(
    'recepcao.checkin.registrar',
    'Registrar a chegada do paciente agendado (check-in) ligando a senha à marcação',
    [O.atendimentosIncluir, O.geradorSenhas, O.sadtAtendimentos],
  ),
  p(
    'recepcao.guiche.liberar',
    'Fechar o guichê deixado aberto por outra pessoa (liberação de guichê bloqueado), com justificativa',
    LIBERAR_GUICHE,
    { criticidade: 'sensivel' },
  ),
  p(
    'recepcao.supervisor.ler',
    'Ver o painel do supervisor da recepção (filas, esperas, guichês abertos e senhas mais antigas)',
    [...LIBERAR_GUICHE, O.estatisticas],
  ),
  p(
    'recepcao.indicador.ler',
    'Consultar os indicadores da recepção (senhas por hora, serviço, prioridade e tempos de espera)',
    [O.estatisticas, ...LIBERAR_GUICHE],
  ),
  p('recepcao.dispositivo.ler', 'Consultar os totens e os painéis de TV cadastrados (sem o token)', [
    O.painelEletronico,
    O.painelAtendimentoSalvar,
    O.painelPortalSalvar,
  ]),
  p(
    'recepcao.dispositivo.editar',
    'Cadastrar, renovar e revogar o token de totem e de painel de TV (o token aparece uma vez)',
    [O.painelAtendimentoSalvar, O.painelPortalSalvar],
    { criticidade: 'sensivel' },
  ),
  // W1-04 (mercado): termos de consentimento e LGPD. Sem opção própria na árvore (POL-1b): assinar e revogar com quem
  // registra a chegada; os modelos com quem cuida das tabelas do painel eletrônico.
  p(
    'recepcao.termo.assinar',
    'Colher a assinatura do termo de consentimento no balcão e revogar o termo assinado, com motivo',
    [O.atendimentosIncluir, O.geradorSenhas, O.sadtAtendimentos],
    { criticidade: 'sensivel' },
  ),
  p(
    'recepcao.termo.editar',
    'Cadastrar os modelos de termo de consentimento (nova versão, inativar e excluir o nunca assinado)',
    [O.painelEletronico],
    { criticidade: 'sensivel' },
  ),
];
