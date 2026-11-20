// Rota da tela "Rubricas, incidências e tabelas legais" (M53.2, etapa F1; ficha, seção 7). A rota abre com a permissão
// da área (`pessoas.folha.abrir`, D-ABRIR-532); cada aba aparece com a sua (rubricas: `pessoas.rubrica.ler`; tabelas
// legais: `pessoas.tabelaLegalFolha.ler`). O servidor confere de novo, e a gravação (CRUD genérico) pede a de editar.
import type { RouteRecordRaw } from 'vue-router';

export const rotasRubricasFolha: RouteRecordRaw[] = [
  {
    path: '/pessoas/folha/rubricas',
    name: 'pessoas.folha.rubricas',
    component: () => import('./RubricasFolhaTela.vue'),
    meta: { permissao: 'pessoas.folha.abrir' },
  },
];
