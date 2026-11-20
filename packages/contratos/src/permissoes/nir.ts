// Permissões do M44, etapa 2 (ficha, seção 7; convencoes.md §12): o NIR (solicitação de leito, fila priorizada,
// reserva, alta prevista e barreiras, quadro de permanência e os limites). Quem tem a opção no sistema anterior tem a
// permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json):
// Recepção interna › Internações 2342 › Leitos 2322 (Manutenção 2323, Painel de leitos 3990, Controle Central de Leitos
// 2483) — a coordenação de leitos opera por elas hoje; a "Regulação de leitos" (4574, 4565) está inativa e o módulo
// "Central de Regulação" não tem opção concedida a grupo (ficha, regra comum 9): ficam para a etapa 3 (regulação).
//   - pedir leito é ato médico (regra 9; ATO-01): as opções de gravação da evolução do PEP (quem registra no
//     prontuário) com o conselho exigido e a categoria de médico conferida na hora pelo vínculo da sessão; quem pede
//     também vê a fila e as altas previstas (o grupo dos médicos do pc não tem opção de leitos nem de altas: só a
//     evolução, 4580/4581, 5181), então as leituras do NIR aceitam as mesmas opções da evolução;
//   - operar a fila, reservar e confirmar é do NIR: o Controle Central de Leitos (e a manutenção de leitos para reservar);
//   - a exceção ao perfil do leito (regra 11) é do supervisor: crítica (reautenticação);
//   - a alta prevista é do médico (as opções da alta, como a alta médica do M21, e as da evolução do PEP, que são as que
//     os médicos têm de fato), com o conselho exigido e a categoria de médico conferida na hora;
//   - as barreiras são de quem cuida da alta (as alterações da internação e o controle central).
// Sem escopo próprio: o módulo `internacao` não usa escopo (como o M21). Conferir com o NIR na validação (DP-3).
import { OPCOES_INTERNACAO as O } from './internacao-adt.js';
import { OPCOES_PEP_EVOLUCAO_CRIAR } from './pep.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_NIR_CODIGOS = {
  solicitacaoLer: 'internacao.solicitacaoLeito.ler',
  solicitacaoCriar: 'internacao.solicitacaoLeito.criar',
  solicitacaoPriorizar: 'internacao.solicitacaoLeito.priorizar',
  solicitacaoAtender: 'internacao.solicitacaoLeito.atender',
  solicitacaoCancelar: 'internacao.solicitacaoLeito.cancelar',
  reservaLer: 'internacao.reservaLeito.ler',
  reservaCriar: 'internacao.reservaLeito.criar',
  reservaConfirmar: 'internacao.reservaLeito.confirmar',
  reservaCancelar: 'internacao.reservaLeito.cancelar',
  reservaExcecao: 'internacao.reservaLeito.excecao',
  altaPrevistaLer: 'internacao.altaPrevista.ler',
  altaPrevistaEditar: 'internacao.altaPrevista.editar',
  barreiraRegistrar: 'internacao.barreiraAlta.registrar',
  barreiraResolver: 'internacao.barreiraAlta.resolver',
  permanenciaLer: 'internacao.permanencia.ler',
  parametroEditar: 'internacao.parametro.editar',
  // Etapa 3: a regulação estadual (o número registrado à mão; o conector só com a DP-29).
  regulacaoLer: 'internacao.regulacao.ler',
  regulacaoRegistrar: 'internacao.regulacao.registrar',
} as const;

const C = PERMISSOES_NIR_CODIGOS;

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
  ...extra,
});

const LER_NIR = [O.leitos, O.painelLeitos, O.controleCentralLeitos, O.manutencaoConsultar];
const OPERAR_NIR = [O.controleCentralLeitos];
/**
 * Etapa 3: o módulo "Central de Regulação" do sistema anterior (17) não tem opção concedida a grupo; as opções
 * "Regulação › Central de Regulação" da recepção interna (6599, 6600) e da externa (6800, 6801) são concedidas a dois
 * grupos do pc (retrato). Quem as tem lê e registra a regulação no novo; o NIR (Controle Central de Leitos) também.
 */
const REGULACAO = [6599, 6600, 6800, 6801];

/** Quem registra a evolução (o médico que pede o leito ou a alta prevista) também lê a fila e as altas previstas. */
const LER_NIR_E_MEDICO = [...LER_NIR, ...OPCOES_PEP_EVOLUCAO_CRIAR];

export const PERMISSOES_NIR_M44: readonly DeclaracaoPermissao[] = [
  p(
    C.solicitacaoLer,
    'Ver a fila do NIR: as solicitações de leito com a prioridade, o prazo, a reserva e o histórico (lista com nomes)',
    LER_NIR_E_MEDICO,
    { criticidade: 'sensivel' },
  ),
  p(
    C.solicitacaoCriar,
    'Pedir leito para o paciente (indicação de internação ou de troca de leito): ato médico',
    [...OPCOES_PEP_EVOLUCAO_CRIAR],
    { categoria: 'clinica', exigeConselho: true },
  ),
  p(
    C.solicitacaoPriorizar,
    'Começar a análise da solicitação e mudar a prioridade dela na fila (NIR)',
    OPERAR_NIR,
  ),
  p(
    C.solicitacaoAtender,
    'Atender a solicitação: marcar o paciente a caminho e concluir pela admissão ou pela transferência (NIR)',
    OPERAR_NIR,
  ),
  p(C.solicitacaoCancelar, 'Cancelar ou rejeitar a solicitação de leito, com o motivo (NIR)', OPERAR_NIR, {
    criticidade: 'sensivel',
  }),
  p(C.reservaLer, 'Ver as reservas de leito com a validade, a confirmação e os conflitos', LER_NIR),
  p(C.reservaCriar, 'Reservar um leito livre compatível com o perfil para a solicitação (NIR)', [
    O.controleCentralLeitos,
    O.leitosManutencao,
  ]),
  p(C.reservaConfirmar, 'Confirmar a reserva do leito (o setor de destino aceitou o paciente)', [
    O.controleCentralLeitos,
    O.leitosManutencao,
  ]),
  p(C.reservaCancelar, 'Cancelar a reserva do leito, com o motivo (a solicitação volta à análise)', [
    O.controleCentralLeitos,
    O.leitosManutencao,
  ]),
  p(
    C.reservaExcecao,
    'Reservar leito fora do perfil (sexo, idade, isolamento ou tipo) com o motivo: exceção do supervisor',
    OPERAR_NIR,
    { criticidade: 'critica' },
  ),
  p(
    C.altaPrevistaLer,
    'Ver as altas previstas, as barreiras de alta e o quadro dos internados (lista com nomes)',
    [...LER_NIR_E_MEDICO, O.internacoes, O.altaConsultar],
    { criticidade: 'sensivel' },
  ),
  p(
    C.altaPrevistaEditar,
    'Registrar ou mudar a data provável de alta do internado (com o motivo da mudança): médico',
    [O.altaIncluir, O.altaAlterar, ...OPCOES_PEP_EVOLUCAO_CRIAR],
    { categoria: 'clinica', exigeConselho: true },
  ),
  p(
    C.barreiraRegistrar,
    'Registrar a barreira de alta (exame, parecer, OPME, transporte, família, social) com responsável e prazo',
    [O.manutencaoAlterar, O.alteracaoIncluir, O.controleCentralLeitos],
  ),
  p(C.barreiraResolver, 'Dar a barreira de alta por resolvida (ou cancelada, se registrada por engano)', [
    O.manutencaoAlterar,
    O.alteracaoAlterar,
    O.controleCentralLeitos,
  ]),
  p(
    C.permanenciaLer,
    'Ver o quadro de permanência (verde, amarelo, vermelho), a reunião de leitos e a calibragem dos limites',
    LER_NIR,
  ),
  p(
    C.parametroEditar,
    'Definir os limites de permanência por clínica, CID ou procedimento e aprovar o de-para das situações de regulação',
    OPERAR_NIR,
    { criticidade: 'sensivel' },
  ),
  p(
    C.regulacaoLer,
    'Ver a regulação estadual das solicitações de leito (número, central, situação e histórico) e a configuração de regulação',
    [...LER_NIR, ...REGULACAO],
    { criticidade: 'sensivel' },
  ),
  p(
    C.regulacaoRegistrar,
    'Registrar o número da regulação estadual e a situação informada pela central na solicitação de leito (NIR)',
    [...OPERAR_NIR, ...REGULACAO],
  ),
];
