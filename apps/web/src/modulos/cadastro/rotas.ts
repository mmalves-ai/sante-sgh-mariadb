// Rotas do cadastro (M11; ficha, seção 7): busca e ficha do paciente, linha do tempo, fila de duplicidades,
// pessoas, profissionais (lista, ficha, histórico, conselhos), solicitantes, prestadores e especialidades.
// Cada rota exige a permissão de leitura do catálogo (M06); o servidor confere de novo. As rotas fixas
// (novo, duplicidades, historico) vêm antes de :id.
import type { RouteRecordRaw } from 'vue-router';

const id = '(\\d+)';

export const rotasCadastro: RouteRecordRaw[] = [
  {
    // F3.1 (02-CAD linha 28): calendário de feriados e dias não úteis por abrangência.
    path: '/cadastros/estrutura/calendario',
    name: 'cadastro.calendario',
    component: () => import('./telas/CalendarioTela.vue'),
    meta: { permissao: 'organizacao.estrutura.ler' },
  },
  {
    // F8 (02-CAD linha 10): pacientes com acesso restrito ao prontuário e a marca de cada um, com a liberação nominal.
    path: '/cadastros/pacientes/acesso-restrito',
    name: 'cadastro.acessoRestrito',
    component: () => import('./telas/AcessoRestritoTela.vue'),
    meta: { permissao: 'cadastro.acessoRestrito.ler' },
  },
  {
    path: `/cadastros/pacientes/:id${id}/acesso-restrito`,
    name: 'cadastro.paciente.acessoRestrito',
    component: () => import('./telas/AcessoRestritoTela.vue'),
    props: true,
    meta: { permissao: 'cadastro.acessoRestrito.ler' },
  },
  {
    path: '/cadastros/pacientes',
    name: 'cadastro.pacientes',
    component: () => import('./telas/BuscaPacientesTela.vue'),
    meta: {
      permissao: 'cadastro.paciente.ler',
      menu: 'Cadastros > Pacientes (cadastro único) > Cadastro e busca de paciente',
    },
  },
  {
    path: '/cadastros/pacientes/novo',
    name: 'cadastro.paciente.novo',
    component: () => import('./telas/FichaPacienteTela.vue'),
    meta: { permissao: 'cadastro.paciente.criar' },
  },
  {
    path: '/cadastros/pacientes/pre-cadastros',
    name: 'cadastro.preCadastros',
    component: () => import('./telas/PreCadastrosTela.vue'),
    meta: {
      permissao: 'cadastro.paciente.ler',
      menu: 'Cadastros > Pacientes (cadastro único) > Pré-cadastro da marcação',
    },
  },
  {
    path: '/cadastros/pacientes/duplicidades',
    name: 'cadastro.duplicidades',
    component: () => import('./telas/DuplicidadesTela.vue'),
    meta: {
      permissao: 'cadastro.duplicidade.ler',
      menu: 'Cadastros > Pacientes (cadastro único) > Unificação de prontuários',
    },
  },
  {
    // F8 (02-CAD linha 11): painel e catálogo dos programas de saúde e linhas de cuidado; lista nominal com coordenar.
    path: '/cadastros/pacientes/linhas-cuidado',
    name: 'cadastro.linhasCuidado',
    component: () => import('./telas/LinhasCuidadoTela.vue'),
    meta: {
      permissao: 'cadastro.linhaCuidado.ler',
      // Quem mantém o catálogo (cadastro.linhaCuidado.editar, do administrador do sistema, que pela segregação não
      // recebe a leitura clínica) também abre a tela: vê o catálogo com as contagens, nunca a lista nominal.
      permissaoOu: ['cadastro.linhaCuidado.editar'],
      menu: 'Cadastros > Pacientes (cadastro único) > Programas e linhas de cuidado',
    },
  },
  {
    path: '/cadastros/pacientes/historico',
    name: 'cadastro.historico',
    component: () => import('./telas/HistoricoPacienteTela.vue'),
    meta: {
      permissao: 'cadastro.historico.ler',
      menu: 'Cadastros > Pacientes (cadastro único) > Histórico de alterações do cadastro',
    },
  },
  {
    path: `/cadastros/pacientes/:id${id}`,
    name: 'cadastro.paciente',
    component: () => import('./telas/FichaPacienteTela.vue'),
    props: true,
    meta: { permissao: 'cadastro.paciente.ler' },
  },
  {
    // F3.1 (02-CAD linha 2): campos obrigatórios do cadastro por módulo, tipo de atendimento e fonte pagadora.
    path: '/cadastros/regras-campo',
    name: 'cadastro.regras-campo',
    component: () => import('./telas/RegrasCampoTela.vue'),
    meta: { permissao: 'config.parametro.ler' },
  },
  {
    // F3.1 (02-CAD linhas 3 e 4): contatos e responsáveis do paciente.
    path: `/cadastros/pacientes/:id${id}/contatos`,
    name: 'cadastro.paciente.contatos',
    component: () => import('./telas/FichaComplementarTela.vue'),
    props: true,
    meta: { permissao: 'cadastro.paciente.ler' },
  },
  {
    // F3.1 (02-CAD linha 5): foto do paciente para a identificação positiva e a conferência na recepção.
    path: `/cadastros/pacientes/:id${id}/identificacao`,
    name: 'cadastro.paciente.identificacao',
    component: () => import('./telas/FotoIdentificacaoTela.vue'),
    props: true,
    meta: { permissao: 'cadastro.paciente.ler' },
  },
  {
    path: `/cadastros/pacientes/:id${id}/historico`,
    name: 'cadastro.paciente.historico',
    component: () => import('./telas/HistoricoPacienteTela.vue'),
    props: true,
    meta: { permissao: 'cadastro.historico.ler' },
  },
  {
    path: '/cadastros/pessoas',
    name: 'cadastro.pessoas',
    component: () => import('./telas/PessoasTela.vue'),
    meta: {
      permissao: 'cadastro.pessoa.ler',
      menu: 'Cadastros > Pacientes (cadastro único) > Pessoas (CPF/CNPJ)',
    },
  },
  {
    path: '/cadastros/profissionais',
    name: 'cadastro.profissionais',
    component: () => import('./telas/ProfissionaisTela.vue'),
    meta: {
      permissao: 'cadastro.profissional.ler',
      menu: 'Cadastros > Profissionais > Profissionais, registros (CBO, conselho) e especialidades',
    },
  },
  {
    // F8 (02-CAD linha 21): profissional provisório (atende antes do cadastro completo) e a regularização.
    path: '/cadastros/profissionais/provisorios',
    name: 'cadastro.profissionais.provisorios',
    component: () => import('./telas/ProfissionaisProvisoriosTela.vue'),
    meta: { permissao: 'cadastro.profissional.ler' },
  },
  {
    // F8 (02-CAD linha 22): equipes médicas e cooperativas do profissional (membros e cooperados com vigência).
    path: '/cadastros/profissionais/equipes',
    name: 'cadastro.profissionais.equipes',
    component: () => import('./telas/EquipesCooperativasTela.vue'),
    meta: { permissao: 'cadastro.profissional.ler' },
  },
  {
    path: '/cadastros/profissionais/conselhos',
    name: 'cadastro.conselhos',
    component: () => import('./telas/ConselhosTela.vue'),
    meta: { permissao: 'cadastro.conselho.ler' },
  },
  {
    path: '/cadastros/profissionais/historico',
    name: 'cadastro.profissionais.historico',
    component: () => import('./telas/HistoricoProfissionalTela.vue'),
    meta: {
      permissao: 'cadastro.historico.ler',
      menu: 'Cadastros > Profissionais > Histórico de alterações do profissional',
    },
  },
  {
    path: `/cadastros/profissionais/:id${id}`,
    name: 'cadastro.profissional',
    component: () => import('./telas/ProfissionalTela.vue'),
    props: true,
    meta: { permissao: 'cadastro.profissional.ler' },
  },
  {
    path: `/cadastros/profissionais/:id${id}/historico`,
    name: 'cadastro.profissional.historico',
    component: () => import('./telas/HistoricoProfissionalTela.vue'),
    props: true,
    meta: { permissao: 'cadastro.historico.ler' },
  },
  {
    path: '/cadastros/solicitantes',
    name: 'cadastro.solicitantes',
    component: () => import('./telas/SolicitantesTela.vue'),
    meta: {
      permissao: 'cadastro.solicitante.ler',
      menu: 'Cadastros > Profissionais > Médicos solicitantes externos',
    },
  },
  {
    // F3.1 (02-CAD linha 20): ficha do solicitante externo (alterar, inativar, códigos por fonte, parecidos).
    path: `/cadastros/solicitantes/:id${id}`,
    name: 'cadastro.solicitante',
    component: () => import('./telas/SolicitanteFichaTela.vue'),
    props: true,
    meta: { permissao: 'cadastro.solicitante.ler' },
  },
  {
    path: '/cadastros/prestadores',
    name: 'cadastro.prestadores',
    component: () => import('../config/telas/DominioTela.vue'),
    props: { modulo: 'cadastro', recurso: 'prestador' },
    meta: {
      permissao: 'cadastro.prestador.ler',
      menu: 'Cadastros > Profissionais > Prestadores de serviço terceiros',
    },
  },
  {
    path: '/cadastros/especialidades',
    name: 'cadastro.especialidades',
    component: () => import('./telas/EspecialidadesTela.vue'),
    meta: {
      permissao: 'cadastro.especialidade.ler',
      menu: 'Cadastros > Especialidades e procedimentos por especialidade',
    },
  },
  {
    // F3.1 (02-CAD linhas 26 e 27): estabelecimento, unidades e setores com ramais (manter, inativar sem apagar).
    // O caminho /cadastros/estrutura é da tela de rede, empresa e unidades (administração); dois registros no mesmo
    // caminho fazem o roteador abrir só o primeiro.
    path: '/cadastros/estrutura/estabelecimento',
    name: 'cadastro.estruturaGestao',
    component: () => import('./telas/EstruturaGestaoTela.vue'),
    meta: {
      permissao: 'cadastro.estrutura.editar',
      menu: 'Cadastros > Estrutura > Estabelecimento, unidades e setores',
    },
  },
  {
    // F3.1 (02-CAD linha 25): configuração TISS por fonte pagadora e faixas de números de guia.
    path: '/cadastros/tiss-configuracao',
    name: 'cadastro.tissConfiguracao',
    component: () => import('./telas/TissConfiguracaoTela.vue'),
    meta: {
      permissao: 'cadastro.tiss.editar',
      menu: 'Cadastros > Fontes pagadoras > Configuração TISS e numeração de guias',
    },
  },
];
