// Permissões do M52, fatia F1 (ficha, seção 7, tela "Colaboradores e admissão"; convencoes.md §12): consultar,
// admitir e desligar o colaborador. Quem tem a opção no outro sistema tem a permissão no novo (regra 1 do M06).
// Opções da árvore TBOPCOES (catalogo-legado.json, pc), módulo "Folha de pagamento" (351, 553, 4259):
//   - Tabelas 352 › Funcionário 358 (com o subitem 4224);
//   - Lançamentos 372 › Rescisão 388 e Afastamento 389.
// Decisão do preparo (D-PERM-52, POL-5): dependentes, mudança funcional e a validade do conselho são "agir" sobre o
// colaborador e usam `pessoas.colaborador.admitir`; o desligamento é crítico (bloqueia o acesso nos dois sistemas,
// SBIS-07: reautenticação recente).
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_PESSOAS = {
  moduloFolha: [351, 553, 4259],
  tabelasFolha: 352,
  funcionario: 358,
  funcionarioSubitem: 4224,
  lancamentosFolha: 372,
  rescisao: 388,
  afastamento: 389,
  /** Folha de pagamento › Tabelas › Cargo (W0-06, M1 cargos e salários). */
  cargo: 362,
  /** Ponto eletrônico › Solicitações e Gerenciamento › Autorização de trabalho/folga (W0-06, M3 autoatendimento). */
  solicitacoesPonto: 5069,
  autorizacaoPonto: 5074,
  /** Medicina do trabalho › Lançamentos › Exame (quem lê o ASO lê o CID do atestado; W0-06, M3). */
  exameOcupacional: 572,
} as const;

const O = OPCOES_PESSOAS;

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
  escopos: [],
  ...extra,
});

export const PERMISSOES_PESSOAS_M52_F1: readonly DeclaracaoPermissao[] = [
  p(
    'pessoas.colaborador.ler',
    'Consultar colaboradores: lista por setor, ficha, vínculos, dependentes, histórico e validade do conselho',
    [O.funcionario, O.funcionarioSubitem, O.rescisao, O.afastamento],
  ),
  p(
    'pessoas.colaborador.admitir',
    'Admitir colaborador, incluir dependente, registrar mudança funcional e a validade do conselho',
    [O.funcionario, O.funcionarioSubitem],
    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.colaborador.desligar',
    'Desligar o colaborador (bloqueia o acesso no mesmo dia, sem apagar o usuário)',
    [O.rescisao],
    { criticidade: 'critica' },
  ),
  // W0-06, parte 4 (M1 de mercado): cargos (CBO, requisitos, conselho), tabela salarial por faixa e nível e quadro de
  // vagas por centro de custo. Quem tem a tabela de cargos da folha no outro sistema tem as duas.
  p(
    'pessoas.cargos.ler',
    'Consultar cargos, tabela salarial e quadro de vagas por centro de custo, com o histórico das alterações',
    [O.cargo],
  ),
  p(
    'pessoas.cargos.gerir',
    'Incluir, alterar (com versão), inativar e excluir cargo, faixa da tabela salarial e vaga do quadro aprovado',
    [O.cargo],
    { criticidade: 'sensivel' },
  ),
  // W0-06, parte 5 (M2 de mercado): avaliação de desempenho e competências, alerta de experiência e PDI. Recurso só do
  // novo; quem tem o cadastro de funcionários da folha no outro sistema (358) lê e gere (D-W006-AVAL-PERMISSAO). A
  // ciência é de toda pessoa, e só da própria avaliação (o vínculo sai do login).
  p(
    'pessoas.avaliacao.ler',
    'Consultar competências, ciclos, avaliações de desempenho, alertas de experiência e o PDI dos colaboradores',
    [O.funcionario],
  ),
  p(
    'pessoas.avaliacao.gerir',
    'Manter competências e ciclos, abrir, lançar, finalizar, corrigir (versão nova) e excluir rascunho de avaliação, registrar a ciência colhida em papel e manter o PDI',
    [O.funcionario],
    { criticidade: 'sensivel' },
  ),
  p('pessoas.avaliacao.ciencia', 'Ver as próprias avaliações e dar ciência (só o próprio vínculo)', [], {
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  }),
  // W0-06, parte 6 (M3 de mercado): solicitações do autoatendimento com a fila do gestor. Pedir e desistir é de toda
  // pessoa, só do próprio vínculo; aprovar e recusar é de quem autoriza o ponto no outro sistema (Solicitações e
  // Autorização de trabalho/folga) e do perfil gestor da escala; o CID do atestado é restrito a quem lê o ASO
  // (D-W006-ATESTADO-LGPD: LGPD arts. 11 e 46, cada leitura na trilha).
  p(
    'pessoas.autoatendimento.solicitar',
    'Pedir férias, abono, ajuste de ponto, alteração cadastral e enviar atestado, e desistir do pedido pendente (só o próprio vínculo)',
    [],
    { concessaoPorPerfil: 'todos-os-perfis-de-pessoa' },
  ),
  p(
    'pessoas.autoatendimento.aprovar',
    'Aprovar ou recusar as solicitações dos colaboradores (férias, abono, ajuste de ponto, alteração cadastral e atestado sem o CID)',
    [O.solicitacoesPonto, O.autorizacaoPonto],
    { criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil', perfis: ['gestor-escala'] },
  ),
  p(
    'pessoas.atestado.verCid',
    'Ver o CID do atestado do colaborador e a trilha de quem leu (dado de saúde, cada leitura registrada)',
    [O.exameOcupacional],
    { criticidade: 'sensivel' },
  ),
  // W0-06, parte 7 (M4 de mercado): painel de indicadores de pessoas (só números agregados por setor, nenhum dado de
  // pessoa). Quem tem o cadastro de funcionários da folha no outro sistema (358) lê (D-W006-IND-PERMISSAO).
  p(
    'pessoas.indicadores.ler',
    'Consultar o painel de indicadores de pessoas por unidade e setor (turnover, absenteísmo, horas extras, horas de enfermagem por paciente-dia, treinamento e acidentes), com a ficha técnica e as parcelas',
    [O.funcionario],
  ),
];

// Permissões do M52, fatia F2 (ficha, seção 7, telas "Escala do setor" e "Regimes e banco de horas"; convencoes.md
// §12). Opções do Ponto eletrônico (novo) na árvore TBOPCOES (catalogo-legado.json, pc): Gerenciamento › Programação
// de Trabalho/Folga Quadro de escalas (5073) e Programação pendente (5072); Tabelas › Horário (5056), Horário por dia
// (5058) e Horários contratuais (5059). Decisão D-PERM-52.2 (POL-5): quem tem o quadro de escalas no outro sistema lê e
// monta a escala; a PUBLICAÇÃO é recurso só do novo (a ficha: "só SGH_ACESSO_MAPA_OPCAO"), concedida ao perfil
// `gestor-escala` por concessão nominal ou pelo mapa aprovado; o perfil também lê e monta.
export const OPCOES_ESCALA = {
  quadroEscalas: 5073,
  programacaoPendente: 5072,
  horario: 5056,
  horarioPorDia: 5058,
  horariosContratuais: 5059,
} as const;

const X = OPCOES_ESCALA;
const gestor = { concessaoPorPerfil: 'por-perfil' as const, perfis: ['gestor-escala'] };

export const PERMISSOES_PESSOAS_M52_F2: readonly DeclaracaoPermissao[] = [
  p(
    'pessoas.escala.ler',
    'Consultar a escala de plantão do setor (grade do mês, cobertura, furos e a trilha das mudanças)',
    [X.quadroEscalas, X.programacaoPendente],
    gestor,
  ),
  p(
    'pessoas.escala.montar',
    'Montar a escala: criar a escala do setor, incluir, alterar e cancelar plantões e a cobertura mínima',
    [X.quadroEscalas],
    { ...gestor, criticidade: 'sensivel' },
  ),
  p('pessoas.escala.publicar', 'Publicar a escala do setor (depois de publicada, só muda com motivo)', [], {
    ...gestor,
    criticidade: 'sensivel',
  }),
  p(
    'pessoas.regime.ler',
    'Consultar os modelos de regime e jornada e o regime de cada colaborador',
    [X.horario, X.horarioPorDia, X.horariosContratuais, X.quadroEscalas],
    gestor,
  ),
  p(
    'pessoas.regime.editar',
    'Incluir e alterar modelos de regime e jornada e atribuir o regime ao colaborador',
    [X.horario, X.horariosContratuais],
    { criticidade: 'sensivel' },
  ),
];

// Permissões do M52, fatia F3 (ficha, seção 7, telas "Trocas de plantão", "Quem está de plantão agora" e
// "Dimensionamento de enfermagem"; convencoes.md §12). Decisão D-PERM-52.3 (POL-5):
//   - pedir a troca: todo perfil de pessoa (cada um troca só o próprio plantão; a coordenação registra em nome do
//     colaborador sem acesso pelo `pessoas.escala.montar`) e, no outro sistema, o quadro de escalas (5073);
//   - aprovar a troca: recurso só do novo, pelo perfil `gestor-escala` (como a publicação);
//   - quem está de plantão agora: a agenda de plantão (4857, 4858) e o plantão médico da recepção (3398, 3400) do outro
//     sistema, o quadro de escalas (5073) e todo perfil de pessoa (a consulta é usada pelo prontuário, pelo NIR e pelo
//     pronto atendimento; mostra nome, conselho e especialidade de quem está de plantão, nada do paciente);
//   - acionar o sobreaviso: a manutenção do plantão médico (3399) e o quadro de escalas (5073) do outro sistema e o
//     perfil `gestor-escala`;
//   - dimensionamento: ler pelo quadro de escalas (5073) e pelo perfil; calcular e registrar só pelo perfil.
export const OPCOES_PLANTAO = {
  agendaPlantao: 4857,
  profissionaisAgendados: 4858,
  plantaoMedico: 3398,
  plantaoMedicoConsulta: 3400,
  plantaoMedicoManutencao: 3399,
} as const;

const Y = OPCOES_PLANTAO;

export const PERMISSOES_PESSOAS_M52_F3: readonly DeclaracaoPermissao[] = [
  p(
    'pessoas.troca.pedir',
    'Pedir a troca ou a cessão do próprio plantão a um colega, responder ao pedido de um colega e cancelar o próprio pedido',
    [X.quadroEscalas],
    { concessaoPorPerfil: 'todos-os-perfis-de-pessoa' },
  ),
  p(
    'pessoas.troca.aprovar',
    'Aprovar ou reprovar a troca de plantão aceita pelo colega (os plantões mudam de colaborador na escala publicada)',
    [],
    { ...gestor, criticidade: 'sensivel' },
  ),
  p(
    'pessoas.plantao.ler',
    'Consultar quem está de plantão agora (presencial, diarista e sobreaviso com o tempo de chegada)',
    [Y.agendaPlantao, Y.profissionaisAgendados, Y.plantaoMedico, Y.plantaoMedicoConsulta, X.quadroEscalas],
    { concessaoPorPerfil: 'todos-os-perfis-de-pessoa' },
  ),
  p(
    'pessoas.sobreaviso.acionar',
    'Acionar o profissional de sobreaviso, registrar a chegada e cancelar o acionamento feito por engano',
    [Y.plantaoMedicoManutencao, X.quadroEscalas],
    { ...gestor, criticidade: 'sensivel' },
  ),
  p(
    'pessoas.dimensionamento.ler',
    'Consultar o dimensionamento de enfermagem (COFEN 543/2017) das unidades, com as parcelas da conta',
    [X.quadroEscalas],
    gestor,
  ),
  p(
    'pessoas.dimensionamento.calcular',
    'Calcular e registrar o dimensionamento de enfermagem (a cobertura sugerida é aplicada na escala por quem monta a escala)',
    [],
    { ...gestor, criticidade: 'sensivel' },
  ),
];
