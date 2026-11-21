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

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'normal',
  ...extra,
});

export const PERMISSOES_NIR_M44: readonly DeclaracaoPermissao[] = [
  p(
    C.solicitacaoLer,
    'Ver a fila do NIR: as solicitações de leito com a prioridade, o prazo, a reserva e o histórico (lista com nomes)',

    { criticidade: 'sensivel' },
  ),
  p(
    C.solicitacaoCriar,
    'Pedir leito para o paciente (indicação de internação ou de troca de leito): ato médico',

    { categoria: 'clinica', exigeConselho: true },
  ),
  p(C.solicitacaoPriorizar, 'Começar a análise da solicitação e mudar a prioridade dela na fila (NIR)'),
  p(
    C.solicitacaoAtender,
    'Atender a solicitação: marcar o paciente a caminho e concluir pela admissão ou pela transferência (NIR)',
  ),
  p(C.solicitacaoCancelar, 'Cancelar ou rejeitar a solicitação de leito, com o motivo (NIR)', {
    criticidade: 'sensivel',
  }),
  p(C.reservaLer, 'Ver as reservas de leito com a validade, a confirmação e os conflitos'),
  p(C.reservaCriar, 'Reservar um leito livre compatível com o perfil para a solicitação (NIR)'),
  p(C.reservaConfirmar, 'Confirmar a reserva do leito (o setor de destino aceitou o paciente)'),
  p(C.reservaCancelar, 'Cancelar a reserva do leito, com o motivo (a solicitação volta à análise)'),
  p(
    C.reservaExcecao,
    'Reservar leito fora do perfil (sexo, idade, isolamento ou tipo) com o motivo: exceção do supervisor',

    { criticidade: 'critica' },
  ),
  p(
    C.altaPrevistaLer,
    'Ver as altas previstas, as barreiras de alta e o quadro dos internados (lista com nomes)',

    { criticidade: 'sensivel' },
  ),
  p(
    C.altaPrevistaEditar,
    'Registrar ou mudar a data provável de alta do internado (com o motivo da mudança): médico',

    { categoria: 'clinica', exigeConselho: true },
  ),
  p(
    C.barreiraRegistrar,
    'Registrar a barreira de alta (exame, parecer, OPME, transporte, família, social) com responsável e prazo',
  ),
  p(C.barreiraResolver, 'Dar a barreira de alta por resolvida (ou cancelada, se registrada por engano)'),
  p(
    C.permanenciaLer,
    'Ver o quadro de permanência (verde, amarelo, vermelho), a reunião de leitos e a calibragem dos limites',
  ),
  p(
    C.parametroEditar,
    'Definir os limites de permanência por clínica, CID ou procedimento e aprovar o de-para das situações de regulação',

    { criticidade: 'sensivel' },
  ),
  p(
    C.regulacaoLer,
    'Ver a regulação estadual das solicitações de leito (número, central, situação e histórico) e a configuração de regulação',

    { criticidade: 'sensivel' },
  ),
  p(
    C.regulacaoRegistrar,
    'Registrar o número da regulação estadual e a situação informada pela central na solicitação de leito (NIR)',
  ),
];
