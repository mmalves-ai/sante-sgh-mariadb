// Rotas das integrações, do laboratório de apoio, da classificação externa e da prescrição digital externa (M34;
// ficha, seção 7). Cada rota exige a permissão de leitura do catálogo (M06); o servidor confere de novo e as ações
// aparecem só com a permissão de agir e a funcionalidade liberada.
import type { RouteRecordRaw } from 'vue-router';

export const rotasIntegracoes: RouteRecordRaw[] = [
  {
    path: '/admin/integracoes/endpoints',
    name: 'integracoes.endpoints',
    component: () => import('./telas/EndpointsTela.vue'),
    meta: { permissao: 'integracao.configuracao.ler' },
  },
  {
    path: '/admin/integracoes/fhir',
    name: 'integracoes.fhir',
    component: () => import('./telas/FhirRndsTela.vue'),
    meta: { permissao: 'integracao.fhir.ler' },
  },
  {
    // C2-085: os envios à RNDS por paciente (sumário de alta e resultado de exame, versões e retorno).
    path: '/admin/integracoes/rnds',
    name: 'integracoes.rndsEnvios',
    component: () => import('./telas/RndsEnviosTela.vue'),
    meta: { permissao: 'integracao.fhir.ler' },
  },
  {
    path: '/admin/integracoes/hl7',
    name: 'integracoes.hl7',
    component: () => import('./telas/Hl7MotorTela.vue'),
    meta: { permissao: 'integracao.hl7.ler' },
  },
  {
    path: '/admin/integracoes/parceiros',
    name: 'integracoes.parceiros',
    component: () => import('./telas/ParceirosTela.vue'),
    meta: { permissao: 'integracao.parceiro.ler' },
  },
  {
    path: '/admin/integracoes/mensagens',
    name: 'integracoes.mensagens',
    component: () => import('./telas/MensagensPacienteTela.vue'),
    meta: { permissao: 'integracao.mensagem.ler' },
  },
  {
    path: '/admin/integracoes/monitor',
    name: 'integracoes.monitor',
    component: () => import('./telas/MonitorIntegracoesTela.vue'),
    meta: { permissao: 'integracao.fila.ler' },
  },
  {
    // M58 (etapa 4): o painel de estado da fachada da API de integração da Hal-AI (condicional, DP-8).
    path: '/administracao/integracoes/fachada',
    name: 'integracoes.fachada',
    component: () => import('./telas/FachadaTela.vue'),
    meta: { permissao: 'integracao.fachada.ler' },
  },
  {
    path: '/pa/classificacao-externa',
    name: 'integracoes.classificacaoExterna',
    component: () => import('./telas/ClassificacaoExternaTela.vue'),
    meta: { permissao: 'integracao.hl7.ler' },
  },
  {
    path: '/sadt/laboratorio/interfaces',
    name: 'integracoes.interfaces',
    component: () => import('./telas/InterfacesEquipamentoTela.vue'),
    meta: { permissao: 'sadt.interface.ler' },
  },
  {
    path: '/sadt/laboratorio/apoio',
    name: 'integracoes.apoio',
    component: () => import('./telas/LaboratorioApoioTela.vue'),
    meta: { permissao: 'sadt.apoio.ler' },
  },
  {
    path: '/pep/prescricao-digital',
    name: 'integracoes.prescricaoDigital',
    component: () => import('./telas/PrescricaoDigitalTela.vue'),
    meta: { permissao: 'pep.prescricaoDigital.ler' },
  },
  {
    path: '/admin/integracoes/erp',
    name: 'integracoes.filaErp',
    component: () => import('./telas/FilaErpTela.vue'),
    meta: { permissao: 'integracao.filaErp.ler' },
  },
];
