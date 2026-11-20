// Rotas da telemedicina na tela do médico (M50, etapa 4; ficha, seção 7: `PEP > Telemedicina (teleconsulta e
// teleinterconsulta)`). A rota do detalhe leva o identificador da teleconsulta (o atendimento só existe depois que o
// médico inicia; D-ROTA-50.4). A sala de espera do paciente fica no portal (`/paciente/teleconsulta/:id`).
import type { RouteRecordRaw } from 'vue-router';

export const rotasTelemedicina: RouteRecordRaw[] = [
  {
    path: '/pep/telemedicina',
    name: 'telemedicina.lista',
    component: () => import('./telas/TelemedicinaTela.vue'),
    meta: { permissao: 'atendimento.teleconsulta.ler' },
  },
  {
    path: '/pep/telemedicina/:id(\\d+)',
    name: 'telemedicina.detalhe',
    component: () => import('./telas/TeleconsultaMedicoTela.vue'),
    meta: { permissao: 'atendimento.teleconsulta.ler' },
  },
];
