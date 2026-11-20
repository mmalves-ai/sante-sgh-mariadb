// Rotas do portal do médico externo, etapa 3 do M50 (ficha, seção 7). As do portal (`/medico-externo/*`) ficam fora da
// casca e da sessão interna (meta pública e de dispositivo, como o portal de resultados do M26, de onde vem a sessão):
// o servidor confere a sessão do portal e o vínculo da conta em cada pedido. A tela interna das contas e do vínculo com o
// corpo clínico tem a permissão do catálogo.
import type { RouteRecordRaw } from 'vue-router';

export const rotasPortalMedico: RouteRecordRaw[] = [
  {
    path: '/medico-externo/extrato',
    name: 'portal.medico.extrato',
    component: () => import('./telas/PortalMedicoExtratoTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/medico-externo/agenda',
    name: 'portal.medico.agenda',
    component: () => import('./telas/PortalMedicoAgendaTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    // W0-10 (M4): meus pacientes (vínculo assistencial) e o resumo do prontuário.
    path: '/medico-externo/pacientes',
    name: 'portal.medico.pacientes',
    component: () => import('./telas/PortalMedicoPacientesTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    // W0-10 (M5): avisos de resultado crítico dos pacientes do médico e a ciência com a conduta.
    path: '/medico-externo/criticos',
    name: 'portal.medico.criticos',
    component: () => import('./telas/PortalMedicoCriticosTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    // W0-10 (M6): a fila de assinatura remota com o certificado em nuvem do profissional.
    path: '/medico-externo/assinaturas',
    name: 'portal.medico.assinaturas',
    component: () => import('./telas/PortalMedicoAssinaturasTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    // W0-10 (M6): a volta do provedor do certificado (PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA; state e código na URL).
    path: '/medico-externo/assinaturas/retorno',
    name: 'portal.medico.assinaturasRetorno',
    component: () => import('./telas/PortalMedicoAssinaturaRetornoTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/medico-externo/conta',
    name: 'portal.medico.conta',
    component: () => import('./telas/PortalMedicoContaTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    // W0-10: o link enviado ao e-mail novo (sem sessão: o token do link é a prova).
    path: '/medico-externo/email/confirmar',
    name: 'portal.medico.confirmarEmail',
    component: () => import('./telas/PortalMedicoConfirmarEmailTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/portais/medico-externo',
    name: 'portal.medico.interno',
    component: () => import('./telas/MedicoExternoInternoTela.vue'),
    meta: { permissao: 'portal.medicoExterno.ler' },
  },
];
