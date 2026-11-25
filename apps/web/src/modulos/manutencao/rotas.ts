// Rotas da manutenção e engenharia clínica (M55, etapa 1; ficha, seção 7). Toda rota declara meta.permissao; o servidor
// é quem decide (as gravações recusam também com a funcionalidade desligada). O item do menu abre as ordens de serviço
// (todo perfil de pessoa abre OS para o seu setor); os equipamentos e a preventiva ficam na sua própria rota.
import { PERMISSOES_MANUTENCAO_CODIGOS as P } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasManutencao: RouteRecordRaw[] = [
  {
    path: '/manutencao/os',
    name: 'manutencao.os',
    component: () => import('./telas/OrdensServicoTela.vue'),
    meta: { permissao: P.osAbrir },
  },
  {
    path: '/manutencao/equipamentos',
    name: 'manutencao.equipamentos',
    component: () => import('./telas/EquipamentosTela.vue'),
    meta: { permissao: P.equipamentoLer },
  },
  {
    // C2-089: oficinas (pessoas, alçada do aprovador, serviços) e os equipamentos fora para conserto.
    path: '/manutencao/oficinas',
    name: 'manutencao.oficinas',
    component: () => import('./telas/OficinasTela.vue'),
    meta: { permissao: P.equipamentoLer },
  },
];
