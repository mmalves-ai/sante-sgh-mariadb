// Rotas do portal do paciente, etapas 1, 2 e 4 do M50 (ficha, seção 7). As do portal (`/paciente/*`) ficam fora da casca e da
// sessão interna (meta pública e de dispositivo, como o portal de resultados do M26): a sessão do portal é conferida
// pelo servidor em cada pedido. A conferência dos responsáveis legais é tela interna com a permissão do catálogo.
import type { RouteRecordRaw } from 'vue-router';

export const rotasPortalPaciente: RouteRecordRaw[] = [
  {
    path: '/paciente/documentos',
    name: 'portal.documentos',
    component: () => import('./telas/PortalDocumentosTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/paciente/responsaveis',
    name: 'portal.responsaveis',
    component: () => import('./telas/PortalResponsaveisTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/paciente/privacidade',
    name: 'portal.privacidade',
    component: () => import('./telas/PortalPrivacidadeTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  // W0-10 (M1): a ouvidoria pelo portal (manifestação com protocolo, acompanhamento e resposta).
  {
    path: '/paciente/ouvidoria',
    name: 'portal.ouvidoria',
    component: () => import('./telas/PortalOuvidoriaTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  // W0-10 (M2): a cópia do prontuário pedida pelo titular ou pelo representante (etapa, prazo e o PDF entregue).
  {
    path: '/paciente/copia',
    name: 'portal.copia',
    component: () => import('./telas/PortalCopiaTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  // W0-10: a confirmação do e-mail novo pelo link (sem sessão; o token do link é a prova).
  {
    path: '/paciente/email/confirmar',
    name: 'portal.confirmarEmail',
    component: () => import('./telas/PortalConfirmarEmailTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/paciente/seguranca',
    name: 'portal.seguranca',
    component: () => import('./telas/PortalSegurancaTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  // M50, etapa 2: agendar, pré-check-in, pagamento e pesquisa (portal) e as telas internas da agenda online e da
  // conferência do pré-check-in.
  {
    path: '/paciente/agendar',
    name: 'portal.agendar',
    component: () => import('./telas/PortalAgendarTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/paciente/pre-checkin/:tipo(consulta|exame)/:id(\\d+)',
    name: 'portal.precheckin',
    component: () => import('./telas/PortalPreCheckinTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/paciente/pagamentos',
    name: 'portal.pagamentos',
    component: () => import('./telas/PortalPagamentosTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  // M50, etapa 4: as teleconsultas do titular e a sala de espera virtual (portal).
  {
    path: '/paciente/teleconsulta',
    name: 'portal.teleconsultas',
    component: () => import('./telas/PortalTeleconsultasTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/paciente/teleconsulta/:id(\\d+)',
    name: 'portal.teleconsulta',
    component: () => import('./telas/PortalTeleconsultaTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/agenda/online',
    name: 'portal.agendaOnline',
    component: () => import('./telas/AgendaOnlineTela.vue'),
    meta: { permissao: 'agenda.online.ler' },
  },
  {
    path: '/recepcao/pre-checkin',
    name: 'portal.conferenciaPreCheckin',
    component: () => import('./telas/ConferenciaPreCheckinTela.vue'),
    meta: { permissao: 'recepcao.precheckin.conferir' },
  },
  // W0-10: a tesouraria das cobranças do portal (o item do menu é pedido ao W4-01).
  {
    path: '/tesouraria/portal',
    name: 'portal.tesouraria',
    component: () => import('./telas/TesourariaPortalTela.vue'),
    meta: { permissao: 'portal.pagamento.conciliar' },
  },
  {
    path: '/paciente/:estabelecimento([a-z0-9]{1,10})?',
    name: 'portal.paciente',
    component: () => import('./telas/PortalEntrarTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/portais/paciente',
    name: 'portal.interno',
    component: () => import('./telas/PortalPacienteInternoTela.vue'),
    meta: { permissao: 'portal.conta.ler' },
  },
  // W0-10 (M2): o balcão da cópia do prontuário (o item do menu é pedido ao W4-01).
  {
    path: '/portais/paciente/copias',
    name: 'portal.copias',
    component: () => import('./telas/CopiasProntuarioTela.vue'),
    meta: { permissao: 'portal.copia.conferir' },
  },
  {
    path: '/portais/paciente/responsaveis',
    name: 'portal.conferenciaVinculos',
    component: () => import('./telas/ConferenciaVinculosTela.vue'),
    meta: { permissao: 'portal.vinculo.conferir' },
  },
];
