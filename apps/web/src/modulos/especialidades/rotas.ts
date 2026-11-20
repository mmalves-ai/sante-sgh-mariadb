// Rotas das especialidades sob demanda e do lactário (M45, etapa 6; ficha, seção 7; DP-32). Toda rota declara
// meta.permissao; o servidor é quem decide (as gravações recusam também com a funcionalidade desligada).
import { PERMISSOES_ESPECIALIDADES_CODIGOS as P } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

const busca = () => import('./telas/BuscaInternacaoTela.vue');

export const rotasEspecialidades: RouteRecordRaw[] = [
  {
    path: '/pep/especialidades/oftalmologia',
    name: 'especialidades.oftalmologia',
    component: busca,
    meta: { permissao: P.oftalmologiaLer, especialidade: 'oftalmologia' },
  },
  {
    path: '/pep/especialidades/oftalmologia/:reg(\\d+)',
    name: 'especialidades.oftalmologia.paciente',
    component: () => import('./telas/OftalmologiaTela.vue'),
    meta: { permissao: P.oftalmologiaLer },
  },
  {
    path: '/pep/especialidades/oncologia',
    name: 'especialidades.oncologia',
    component: busca,
    meta: { permissao: P.oncologiaLer, especialidade: 'oncologia' },
  },
  {
    path: '/pep/especialidades/oncologia/protocolos',
    name: 'especialidades.oncologia.protocolos',
    component: () => import('./telas/ProtocolosOncologicosTela.vue'),
    meta: { permissao: P.oncologiaLer },
  },
  {
    path: '/pep/especialidades/oncologia/validacao',
    name: 'especialidades.oncologia.validacao',
    component: () => import('./telas/ValidacaoOncologicaTela.vue'),
    meta: { permissao: P.oncologiaValidar },
  },
  {
    path: '/pep/especialidades/oncologia/:reg(\\d+)',
    name: 'especialidades.oncologia.paciente',
    component: () => import('./telas/OncologiaTela.vue'),
    meta: { permissao: P.oncologiaLer },
  },
  {
    path: '/pep/especialidades/obstetricia',
    name: 'especialidades.obstetricia',
    component: busca,
    meta: { permissao: P.obstetriciaLer, especialidade: 'obstetricia' },
  },
  {
    path: '/pep/especialidades/obstetricia/:reg(\\d+)',
    name: 'especialidades.obstetricia.paciente',
    component: () => import('./telas/ObstetriciaTela.vue'),
    meta: { permissao: P.obstetriciaLer },
  },
  {
    path: '/nutricao/lactario',
    name: 'nutricao.lactario',
    component: () => import('./telas/LactarioTela.vue'),
    meta: { permissao: P.lactarioLer },
  },
];
