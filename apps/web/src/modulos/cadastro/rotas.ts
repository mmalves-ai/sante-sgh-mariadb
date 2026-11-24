// Rotas do cadastro (M11; ficha, seção 7): busca e ficha do paciente, linha do tempo, fila de duplicidades,
// pessoas, profissionais (lista, ficha, histórico, conselhos), solicitantes, prestadores e especialidades.
// Cada rota exige a permissão de leitura do catálogo (M06); o servidor confere de novo. As rotas fixas
// (novo, duplicidades, historico) vêm antes de :id.
import type { RouteRecordRaw } from 'vue-router';

const id = '(\\d+)';

export const rotasCadastro: RouteRecordRaw[] = [
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
    // F3.1 (02-CAD linhas 3 e 4): contatos e responsáveis do paciente.
    path: `/cadastros/pacientes/:id${id}/contatos`,
    name: 'cadastro.paciente.contatos',
    component: () => import('./telas/FichaComplementarTela.vue'),
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
];
