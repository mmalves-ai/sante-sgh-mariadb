// Rotas da assinatura ICP-Brasil, etapas 1 a 3 (M49; ficha, seção 7). Cada rota exige a permissão de leitura do catálogo
// (M06); o servidor confere de novo e as ações aparecem só com a permissão de agir.
import type { RouteRecordRaw } from 'vue-router';

export const rotasAssinatura: RouteRecordRaw[] = [
  // Etapa 2: assinar os documentos emitidos, um a um ou em lote (prévia exata, provedor ou agente local), pendências,
  // reprocessamento, avisos e o PDF assinado.
  {
    path: '/pep/assinaturas',
    name: 'assinatura.documentos',
    component: () => import('./telas/AssinarDocumentosTela.vue'),
    meta: { permissao: 'documento.assinatura.assinar' },
  },
  {
    path: '/conta/certificado',
    name: 'assinatura.certificado',
    component: () => import('./telas/MeuCertificadoTela.vue'),
    meta: { permissao: 'documento.certificado.vincular' },
  },
  {
    path: '/administracao/assinatura/politica',
    name: 'assinatura.politica',
    component: () => import('./telas/PoliticaAssinaturaTela.vue'),
    meta: { permissao: 'documento.politica.ler' },
  },
  {
    path: '/administracao/assinatura/provedores',
    name: 'assinatura.provedores',
    component: () => import('./telas/ProvedoresTela.vue'),
    meta: { permissao: 'documento.provedor.ler' },
  },
  // Etapa 3: os cadastros da assinatura digital (CRUD genérico embutido), o painel do verificador e o verificador
  // público (sem login e sem a casca: o QR do documento assinado aponta para /verificar/<código>).
  {
    path: '/administracao/assinatura/oids',
    name: 'assinatura.cadastros',
    component: () => import('./telas/CadastrosAssinaturaTela.vue'),
    meta: { permissao: 'documento.cadastro.ler' },
  },
  {
    path: '/portais/verificador',
    name: 'assinatura.painelVerificador',
    component: () => import('./telas/PainelVerificadorTela.vue'),
    meta: { permissao: 'documento.verificador.ler' },
  },
  {
    path: '/verificar/:codigo([A-Za-z0-9_-]{16,64})?',
    name: 'assinatura.verificar',
    component: () => import('./telas/VerificarDocumentoTela.vue'),
    props: true,
    meta: { publica: true, dispositivo: true },
  },
];
