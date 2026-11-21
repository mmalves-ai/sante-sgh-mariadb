// Permissões do M19 (ficha, seção 7; convencoes.md §12): recepção, senhas, guichês, totens e painéis. Quem tem a
// opção no legado tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem (retrato
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

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

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
  ),
  p('recepcao.senha.emitir', 'Emitir senha no balcão (o totem emite pelo token do dispositivo)'),
  p(
    'recepcao.senha.chamar',
    'Abrir o guichê, chamar a próxima senha e conduzi-la (chamar de novo, suspender, não localizado, concluir)',
  ),
  p('recepcao.senha.encaminhar', 'Encaminhar o paciente entre locais de atendimento permitidos'),
  p(
    'recepcao.fluxo.registrar',
    'Registrar os eventos da senha no local de atendimento (chamar ao local, cancelar a chamada, não localizado, liberar)',
  ),
  p(
    'recepcao.checkin.registrar',
    'Registrar a chegada do paciente agendado (check-in) ligando a senha à marcação',
  ),
  p(
    'recepcao.guiche.liberar',
    'Fechar o guichê deixado aberto por outra pessoa (liberação de guichê bloqueado), com justificativa',

    { criticidade: 'sensivel' },
  ),
  p(
    'recepcao.supervisor.ler',
    'Ver o painel do supervisor da recepção (filas, esperas, guichês abertos e senhas mais antigas)',
  ),
  p(
    'recepcao.indicador.ler',
    'Consultar os indicadores da recepção (senhas por hora, serviço, prioridade e tempos de espera)',
  ),
  p('recepcao.dispositivo.ler', 'Consultar os totens e os painéis de TV cadastrados (sem o token)'),
  p(
    'recepcao.dispositivo.editar',
    'Cadastrar, renovar e revogar o token de totem e de painel de TV (o token aparece uma vez)',

    { criticidade: 'sensivel' },
  ),
  // W1-04 (mercado): termos de consentimento e LGPD. Sem opção própria na árvore (POL-1b): assinar e revogar com quem
  // registra a chegada; os modelos com quem cuida das tabelas do painel eletrônico.
  p(
    'recepcao.termo.assinar',
    'Colher a assinatura do termo de consentimento no balcão e revogar o termo assinado, com motivo',

    { criticidade: 'sensivel' },
  ),
  p(
    'recepcao.termo.editar',
    'Cadastrar os modelos de termo de consentimento (nova versão, inativar e excluir o nunca assinado)',

    { criticidade: 'sensivel' },
  ),
];
