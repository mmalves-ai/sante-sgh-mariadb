import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_TRANSFUSAO_CODIGOS = {
  transfusaoLer: 'sadt.transfusao.ler',
  transfusaoRequisitar: 'sadt.transfusao.requisitar',
  transfusaoRegistrarAmostra: 'sadt.transfusao.registrarAmostra',
  transfusaoAdministrar: 'sadt.transfusao.administrar',
  transfusaoCancelar: 'sadt.transfusao.cancelar',
  reacaoLer: 'sadt.reacao.ler',
  reacaoRegistrar: 'sadt.reacao.registrar',
  agenciaCadastroLer: 'sadt.agenciaCadastro.ler',
  agenciaCadastroEditar: 'sadt.agenciaCadastro.editar',
  // Etapa 2 (DP-21; chave `agencia.completa`): imuno-hematologia, prova cruzada e estoque de bolsas.
  imunoLer: 'sadt.imuno.ler',
  imunoRegistrar: 'sadt.imuno.registrar',
  imunoLiberar: 'sadt.imuno.liberar',
  bolsaLer: 'sadt.bolsa.ler',
  bolsaReceber: 'sadt.bolsa.receber',
  bolsaMovimentar: 'sadt.bolsa.movimentar',
} as const;
const C = PERMISSOES_TRANSFUSAO_CODIGOS;
const ESCOPOS = ['unidade', 'vinculo'] as const;

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade: 'sensivel',
  escopos: ESCOPOS,
  ...extra,
});

export const PERMISSOES_TRANSFUSAO_M47: readonly DeclaracaoPermissao[] = [
  p(
    C.transfusaoLer,
    'Ver as prescrições de hemoterapia a atender, as requisições transfusionais, as amostras e os atos de transfusão',
  ),
  p(
    C.transfusaoRequisitar,
    'Requisitar a transfusão a partir do item de hemoterapia da prescrição (indicação, urgência, termo de consentimento)',

    { exigeConselho: true },
  ),
  p(
    C.transfusaoRegistrarAmostra,
    'Registrar a coleta da amostra pré-transfusional à beira do leito, com a leitura da pulseira',
  ),
  p(
    C.transfusaoAdministrar,
    'Iniciar, acompanhar e concluir a transfusão à beira do leito, com a dupla checagem da bolsa e os sinais vitais',

    { exigeConselho: true },
  ),
  p(
    C.transfusaoCancelar,
    'Cancelar a requisição transfusional ainda não atendida, com o motivo',

    { exigeConselho: true },
  ),
  p(C.reacaoLer, 'Ver as reações transfusionais e o painel de hemovigilância (indicadores e notificações)'),
  p(
    C.reacaoRegistrar,
    'Registrar a reação transfusional (tipo, gravidade, conduta, destino da bolsa) e sugerir a notificação',
  ),
  p(C.agenciaCadastroLer, 'Consultar os cadastros e parâmetros da agência transfusional', {
    categoria: 'administrativa',
    criticidade: 'normal',
  }),
  p(
    C.agenciaCadastroEditar,
    'Editar os cadastros e parâmetros da agência transfusional (só com agência própria)',

    { categoria: 'administrativa', criticidade: 'sensivel' },
  ),
  p(
    C.imunoLer,
    'Ver a tipagem ABO e Rh, a pesquisa de anticorpos irregulares e as provas cruzadas da agência transfusional',
  ),
  p(
    C.imunoRegistrar,
    'Registrar o resultado da tipagem ABO e Rh, da pesquisa de anticorpos e da prova cruzada (digitado)',
  ),
  p(
    C.imunoLiberar,
    'Conferir e liberar o resultado imuno-hematológico registrado por outro profissional (biomédico ou médico hemoterapeuta)',

    { exigeConselho: true },
  ),
  p(
    C.bolsaLer,
    'Ver o estoque de hemocomponentes (bolsas por tipo, validade e situação) e o histórico de cada bolsa',
  ),
  p(C.bolsaReceber, 'Receber a bolsa do hemocentro, com a inspeção e a temperatura de chegada'),
  p(C.bolsaMovimentar, 'Liberar, bloquear, reservar, devolver ou descartar a bolsa do estoque, com o motivo'),
];
