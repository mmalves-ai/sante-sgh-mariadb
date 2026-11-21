// Permissões do M52, fatia F1 (ficha, seção 7, tela "Colaboradores e admissão"; convencoes.md §12): consultar,
// admitir e desligar o colaborador. Quem tem a opção no outro sistema tem a permissão no novo (regra 1 do M06).
// Opções da árvore do menu de origem (conector/mapa/permissoes.tsv), módulo "Folha de pagamento" (351, 553, 4259):
//   - Tabelas 352 › Funcionário 358 (com o subitem 4224);
//   - Lançamentos 372 › Rescisão 388 e Afastamento 389.
// Decisão do preparo (D-PERM-52, POL-5): dependentes, mudança funcional e a validade do conselho são "agir" sobre o
// colaborador e usam `pessoas.colaborador.admitir`; o desligamento é crítico (bloqueia o acesso nos dois sistemas,
// SBIS-07: reautenticação recente).
import type { DeclaracaoPermissao } from './tipos.js';

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
  escopos: [],
  ...extra,
});

export const PERMISSOES_PESSOAS_M52_F1: readonly DeclaracaoPermissao[] = [
  p(
    'pessoas.colaborador.ler',
    'Consultar colaboradores: lista por setor, ficha, vínculos, dependentes, histórico e validade do conselho',
  ),
  p(
    'pessoas.colaborador.admitir',
    'Admitir colaborador, incluir dependente, registrar mudança funcional e a validade do conselho',

    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.colaborador.desligar',
    'Desligar o colaborador (bloqueia o acesso no mesmo dia, sem apagar o usuário)',

    { criticidade: 'critica' },
  ),
  // W0-06, parte 4 (M1 de mercado): cargos (CBO, requisitos, conselho), tabela salarial por faixa e nível e quadro de
  // vagas por centro de custo. Quem tem a tabela de cargos da folha no outro sistema tem as duas.
  p(
    'pessoas.cargos.ler',
    'Consultar cargos, tabela salarial e quadro de vagas por centro de custo, com o histórico das alterações',
  ),
  p(
    'pessoas.cargos.gerir',
    'Incluir, alterar (com versão), inativar e excluir cargo, faixa da tabela salarial e vaga do quadro aprovado',

    { criticidade: 'sensivel' },
  ),
  // W0-06, parte 5 (M2 de mercado): avaliação de desempenho e competências, alerta de experiência e PDI. Recurso só do
  // novo; quem tem o cadastro de funcionários da folha no outro sistema (358) lê e gere (D-W006-AVAL-PERMISSAO). A
  // ciência é de toda pessoa, e só da própria avaliação (o vínculo sai do login).
  p(
    'pessoas.avaliacao.ler',
    'Consultar competências, ciclos, avaliações de desempenho, alertas de experiência e o PDI dos colaboradores',
  ),
  p(
    'pessoas.avaliacao.gerir',
    'Manter competências e ciclos, abrir, lançar, finalizar, corrigir (versão nova) e excluir rascunho de avaliação, registrar a ciência colhida em papel e manter o PDI',

    { criticidade: 'sensivel' },
  ),
  p('pessoas.avaliacao.ciencia', 'Ver as próprias avaliações e dar ciência (só o próprio vínculo)', {
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  }),
  // W0-06, parte 6 (M3 de mercado): solicitações do autoatendimento com a fila do gestor. Pedir e desistir é de toda
  // pessoa, só do próprio vínculo; aprovar e recusar é de quem autoriza o ponto no outro sistema (Solicitações e
  // Autorização de trabalho/folga) e do perfil gestor da escala; o CID do atestado é restrito a quem lê o ASO
  // (D-W006-ATESTADO-LGPD: LGPD arts. 11 e 46, cada leitura na trilha).
  p(
    'pessoas.autoatendimento.solicitar',
    'Pedir férias, abono, ajuste de ponto, alteração cadastral e enviar atestado, e desistir do pedido pendente (só o próprio vínculo)',

    { concessaoPorPerfil: 'todos-os-perfis-de-pessoa' },
  ),
  p(
    'pessoas.autoatendimento.aprovar',
    'Aprovar ou recusar as solicitações dos colaboradores (férias, abono, ajuste de ponto, alteração cadastral e atestado sem o CID)',

    { criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil', perfis: ['gestor-escala'] },
  ),
  p(
    'pessoas.atestado.verCid',
    'Ver o CID do atestado do colaborador e a trilha de quem leu (dado de saúde, cada leitura registrada)',

    { criticidade: 'sensivel' },
  ),
  // W0-06, parte 7 (M4 de mercado): painel de indicadores de pessoas (só números agregados por setor, nenhum dado de
  // pessoa). Quem tem o cadastro de funcionários da folha no outro sistema (358) lê (D-W006-IND-PERMISSAO).
  p(
    'pessoas.indicadores.ler',
    'Consultar o painel de indicadores de pessoas por unidade e setor (turnover, absenteísmo, horas extras, horas de enfermagem por paciente-dia, treinamento e acidentes), com a ficha técnica e as parcelas',
  ),
];
const gestor = { concessaoPorPerfil: 'por-perfil' as const, perfis: ['gestor-escala'] };

export const PERMISSOES_PESSOAS_M52_F2: readonly DeclaracaoPermissao[] = [
  p(
    'pessoas.escala.ler',
    'Consultar a escala de plantão do setor (grade do mês, cobertura, furos e a trilha das mudanças)',

    gestor,
  ),
  p(
    'pessoas.escala.montar',
    'Montar a escala: criar a escala do setor, incluir, alterar e cancelar plantões e a cobertura mínima',

    { ...gestor, criticidade: 'sensivel' },
  ),
  p('pessoas.escala.publicar', 'Publicar a escala do setor (depois de publicada, só muda com motivo)', {
    ...gestor,
    criticidade: 'sensivel',
  }),
  p(
    'pessoas.regime.ler',
    'Consultar os modelos de regime e jornada e o regime de cada colaborador',

    gestor,
  ),
  p(
    'pessoas.regime.editar',
    'Incluir e alterar modelos de regime e jornada e atribuir o regime ao colaborador',

    { criticidade: 'sensivel' },
  ),
];

export const PERMISSOES_PESSOAS_M52_F3: readonly DeclaracaoPermissao[] = [
  p(
    'pessoas.troca.pedir',
    'Pedir a troca ou a cessão do próprio plantão a um colega, responder ao pedido de um colega e cancelar o próprio pedido',

    { concessaoPorPerfil: 'todos-os-perfis-de-pessoa' },
  ),
  p(
    'pessoas.troca.aprovar',
    'Aprovar ou reprovar a troca de plantão aceita pelo colega (os plantões mudam de colaborador na escala publicada)',

    { ...gestor, criticidade: 'sensivel' },
  ),
  p(
    'pessoas.plantao.ler',
    'Consultar quem está de plantão agora (presencial, diarista e sobreaviso com o tempo de chegada)',

    { concessaoPorPerfil: 'todos-os-perfis-de-pessoa' },
  ),
  p(
    'pessoas.sobreaviso.acionar',
    'Acionar o profissional de sobreaviso, registrar a chegada e cancelar o acionamento feito por engano',

    { ...gestor, criticidade: 'sensivel' },
  ),
  p(
    'pessoas.dimensionamento.ler',
    'Consultar o dimensionamento de enfermagem (COFEN 543/2017) das unidades, com as parcelas da conta',

    gestor,
  ),
  p(
    'pessoas.dimensionamento.calcular',
    'Calcular e registrar o dimensionamento de enfermagem (a cobertura sugerida é aplicada na escala por quem monta a escala)',

    { ...gestor, criticidade: 'sensivel' },
  ),
];
