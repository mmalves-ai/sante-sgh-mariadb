// Rotas da agenda de sessões e recursos (M50, etapa 6; ficha, seção 7). Toda rota declara meta.permissao; o servidor é
// quem decide (as gravações recusam também com a funcionalidade desligada).
import { PERMISSOES_SESSOES as P } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasSessoes: RouteRecordRaw[] = [
  {
    path: '/agenda/sessoes',
    name: 'agenda.sessoes',
    component: () => import('./telas/AgendaSessoesTela.vue'),
    meta: { permissao: P.ler },
  },
  // C1-096 (03-PEP linha 146): reuso de dialisadores da hemodiálise (enfermagem da diálise; a agenda só consulta).
  {
    path: '/agenda/sessoes/dialisadores',
    name: 'agenda.sessoes.dialisadores',
    component: () => import('./telas/DialisadoresTela.vue'),
    meta: { permissao: 'enfermagem.horario.ler', permissaoOu: [P.ler] },
  },
];
