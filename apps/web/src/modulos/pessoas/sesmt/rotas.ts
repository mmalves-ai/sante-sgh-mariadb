// Rotas do SESMT (M52.5; ficha do M52, seção 7): ASO e exames ocupacionais, CAT, riscos e EPI, vacinação do
// colaborador. A rota exige a permissão de leitura da tela; o servidor confere de novo.
import type { RouteRecordRaw } from 'vue-router';

export const rotasSesmt: RouteRecordRaw[] = [
  {
    path: '/pessoas/sesmt/aso',
    name: 'pessoas.sesmt.aso',
    component: () => import('./AsoTela.vue'),
    meta: { permissao: 'pessoas.ocupacional.ler' },
  },
  {
    path: '/pessoas/sesmt/cat',
    name: 'pessoas.sesmt.cat',
    component: () => import('./CatTela.vue'),
    meta: { permissao: 'pessoas.acidente.ler' },
  },
  {
    path: '/pessoas/sesmt/riscos',
    name: 'pessoas.sesmt.riscos',
    component: () => import('./RiscosTela.vue'),
    meta: { permissao: 'pessoas.risco.ler' },
  },
  {
    path: '/pessoas/sesmt/vacinas',
    name: 'pessoas.sesmt.vacinas',
    component: () => import('./VacinasTela.vue'),
    meta: { permissao: 'pessoas.vacinacao.ler' },
  },
];
