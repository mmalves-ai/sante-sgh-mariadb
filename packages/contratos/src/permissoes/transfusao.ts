// Permissões do M47, etapa 1 (ficha, seção 7; convencoes.md §12): requisição transfusional e amostra, ato
// transfusional à beira do leito, reações e hemovigilância, e os cadastros da agência. Opções da árvore do módulo
// "Hemoterapia" (30) do outro sistema (retrato tools/verificadores/dados/acesso-legado.pc.json; 54 opções, NENHUMA
// concedida a grupo ou papel no pc):
//   - Lançamentos 3065 › Requisição 3071 (Hemocentro 3072, Paciente 3073), Pré-transfusão 3074, Transfusão 3075,
//     Solicitações do PEP 4823, Bolsa 3067, Transferência de bolsa 3068, Acerto de movimentação 4817, Pesquisas 4818;
//   - Tabelas 3048 › Parâmetros 3049, Cadastro 3050 (Doador 3051, Movimentação 3052, Reação 3053, Cliente 3054,
//     Entrevista 3055, Exames para triagem 3056, Estado final 3057, Técnico 3058, Hemocomponente 3059, Conduta 3060,
//     Local de armazenagem 3061, Intercorrência 3062, Motivo de devolução/perda 3063, Carta 4814);
//   - Relatórios 3076 › Transfusão 3079.
// Como ninguém tem essas opções, elas sozinhas não dariam a permissão a ninguém (D-PERM-47.1): a fonte de concessão de
// quem faz o trabalho hoje é a da prescrição (M24) e a da checagem da enfermagem (M25), e as opções da Hemoterapia
// entram como fonte a mais (quem um dia as tiver, passa a ter a permissão). O ato é do enfermeiro com a dupla checagem
// (o segundo profissional confere com o próprio login); a requisição é do médico (ato privativo, com conselho).
// Escopos do módulo sadt (unidade e vínculo).
import { OPCOES_ENFERMAGEM } from './enfermagem.js';
import { OPCOES_PRESCRICAO_CRIAR, OPCOES_PRESCRICAO_LER } from './pep.js';
import { OPCOES_SADT } from './sadt.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_HEMOTERAPIA = {
  modulo: 3047,
  tabelas: 3048,
  parametros: 3049,
  cadastro: 3050,
  cadastroMovimentacao: 3052,
  cadastroReacao: 3053,
  cadastroCliente: 3054,
  cadastroExamesTriagem: 3056,
  cadastroEstadoFinal: 3057,
  cadastroTecnico: 3058,
  cadastroHemocomponente: 3059,
  cadastroConduta: 3060,
  cadastroLocal: 3061,
  cadastroIntercorrencia: 3062,
  cadastroMotivoDevolucao: 3063,
  lancamentos: 3065,
  bolsa: 3067,
  transferenciaBolsa: 3068,
  requisicao: 3071,
  requisicaoHemocentro: 3072,
  requisicaoPaciente: 3073,
  preTransfusao: 3074,
  transfusao: 3075,
  relatorios: 3076,
  relatorioTransfusao: 3079,
  acertoMovimentacao: 4817,
  pesquisas: 4818,
  solicitacoesPep: 4823,
} as const;
const H = OPCOES_HEMOTERAPIA;
const E = OPCOES_ENFERMAGEM;

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

const LER_CHECAGEM = [E.checagem, E.checagemConsultar, E.checagemGeral];
const CHECAR = [E.checar, E.checarCodigoBarras, E.checarCodigoBarras2, E.gravar];
const CADASTROS = [
  H.tabelas,
  H.parametros,
  H.cadastro,
  H.cadastroMovimentacao,
  H.cadastroReacao,
  H.cadastroCliente,
  H.cadastroExamesTriagem,
  H.cadastroEstadoFinal,
  H.cadastroTecnico,
  H.cadastroHemocomponente,
  H.cadastroConduta,
  H.cadastroLocal,
  H.cadastroIntercorrencia,
  H.cadastroMotivoDevolucao,
];
const ESCOPOS = ['unidade', 'vinculo'] as const;
// Etapa 2 (D-PERM-47.2): quem faz a imuno-hematologia e cuida do estoque hoje é o laboratório (as opções da Hemoterapia
// não têm grupo no pc): a leitura soma a consulta dos resultados do laboratório, o registro a digitação, a liberação a
// liberação do resultado (responsável técnico habilitado) e o estoque a pré-transfusão e as bolsas.
const S = OPCOES_SADT;
const LAB_CONSULTAR = [S.labRegistroConsultar, S.labEspecialidadeConsultar];
const LAB_DIGITAR = [S.labRegistroIncluir, S.labRegistroAlterar];
const LAB_LIBERAR = [S.labRegistroAlterar, S.liberarResultadosWeb];
const BOLSAS = [H.bolsa, H.transferenciaBolsa, H.acertoMovimentacao];

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
  categoria: 'clinica',
  criticidade: 'sensivel',
  escopos: ESCOPOS,
  ...extra,
});

export const PERMISSOES_TRANSFUSAO_M47: readonly DeclaracaoPermissao[] = [
  p(
    C.transfusaoLer,
    'Ver as prescrições de hemoterapia a atender, as requisições transfusionais, as amostras e os atos de transfusão',
    [...OPCOES_PRESCRICAO_LER, ...LER_CHECAGEM, H.lancamentos, H.requisicao, H.solicitacoesPep, H.pesquisas],
  ),
  p(
    C.transfusaoRequisitar,
    'Requisitar a transfusão a partir do item de hemoterapia da prescrição (indicação, urgência, termo de consentimento)',
    [...OPCOES_PRESCRICAO_CRIAR, H.requisicao, H.requisicaoPaciente, H.requisicaoHemocentro],
    { exigeConselho: true },
  ),
  p(
    C.transfusaoRegistrarAmostra,
    'Registrar a coleta da amostra pré-transfusional à beira do leito, com a leitura da pulseira',
    [...CHECAR, H.preTransfusao],
  ),
  p(
    C.transfusaoAdministrar,
    'Iniciar, acompanhar e concluir a transfusão à beira do leito, com a dupla checagem da bolsa e os sinais vitais',
    [...CHECAR, H.transfusao],
    { exigeConselho: true },
  ),
  p(
    C.transfusaoCancelar,
    'Cancelar a requisição transfusional ainda não atendida, com o motivo',
    [...OPCOES_PRESCRICAO_CRIAR, H.requisicao],
    { exigeConselho: true },
  ),
  p(C.reacaoLer, 'Ver as reações transfusionais e o painel de hemovigilância (indicadores e notificações)', [
    ...LER_CHECAGEM,
    H.relatorios,
    H.relatorioTransfusao,
    H.pesquisas,
  ]),
  p(
    C.reacaoRegistrar,
    'Registrar a reação transfusional (tipo, gravidade, conduta, destino da bolsa) e sugerir a notificação',
    [...CHECAR, H.transfusao, H.cadastroReacao],
  ),
  p(C.agenciaCadastroLer, 'Consultar os cadastros e parâmetros da agência transfusional', CADASTROS, {
    categoria: 'administrativa',
    criticidade: 'normal',
  }),
  p(
    C.agenciaCadastroEditar,
    'Editar os cadastros e parâmetros da agência transfusional (só com agência própria)',
    CADASTROS,
    { categoria: 'administrativa', criticidade: 'sensivel' },
  ),
  p(
    C.imunoLer,
    'Ver a tipagem ABO e Rh, a pesquisa de anticorpos irregulares e as provas cruzadas da agência transfusional',
    [...LAB_CONSULTAR, H.lancamentos, H.preTransfusao, H.pesquisas],
  ),
  p(
    C.imunoRegistrar,
    'Registrar o resultado da tipagem ABO e Rh, da pesquisa de anticorpos e da prova cruzada (digitado)',
    [...LAB_DIGITAR, H.preTransfusao],
  ),
  p(
    C.imunoLiberar,
    'Conferir e liberar o resultado imuno-hematológico registrado por outro profissional (biomédico ou médico hemoterapeuta)',
    [...LAB_LIBERAR, H.preTransfusao],
    { exigeConselho: true },
  ),
  p(
    C.bolsaLer,
    'Ver o estoque de hemocomponentes (bolsas por tipo, validade e situação) e o histórico de cada bolsa',
    [...LAB_CONSULTAR, ...BOLSAS, H.lancamentos],
  ),
  p(C.bolsaReceber, 'Receber a bolsa do hemocentro, com a inspeção e a temperatura de chegada', [
    ...LAB_DIGITAR,
    ...BOLSAS,
  ]),
  p(
    C.bolsaMovimentar,
    'Liberar, bloquear, reservar, devolver ou descartar a bolsa do estoque, com o motivo',
    [...LAB_DIGITAR, ...BOLSAS],
  ),
];
