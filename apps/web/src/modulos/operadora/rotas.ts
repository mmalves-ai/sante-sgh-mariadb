// Rotas da operadora própria (M56; ficha, seção 7). Etapa F0: Envios à ANS com a consulta dos catálogos da ANS (os
// envios chegam na F6). F1 (M56.2): beneficiários, planos e contratos. Os demais itens da árvore da operadora abrem a
// consulta do item com os domínios embutidos até a fatia de cada um. A rota exige a permissão de leitura; o servidor confere de novo.
import type { RouteRecordRaw } from 'vue-router';

export const rotasOperadora: RouteRecordRaw[] = [
  // M56.2 (fatia F1): beneficiários, planos e contratos.
  {
    path: '/operadora/beneficiarios',
    name: 'operadora.beneficiarios',
    component: () => import('./telas/BeneficiariosOperadoraTela.vue'),
    meta: { permissao: 'operadora.beneficiario.ler' },
  },
  {
    path: '/operadora/ans',
    name: 'operadora.ans',
    component: () => import('./telas/AnsOperadoraTela.vue'),
    meta: { permissao: 'operadora.ans.ler' },
  },
  // M56 (etapa 3, F2): a cobrança e as mensalidades.
  {
    path: '/operadora/cobranca',
    name: 'operadora.cobranca',
    component: () => import('./telas/CobrancaOperadoraTela.vue'),
    meta: { permissao: 'operadora.cobranca.ler' },
  },
  // 08-SGO L96 (C1-086): índice com vigência, agrupamento do coletivo pequeno e reajuste por sinistralidade.
  {
    path: '/operadora/reajustes-coletivos',
    name: 'operadora.reajustes-coletivos',
    component: () => import('./telas/ReajusteColetivoTela.vue'),
    meta: { permissao: 'operadora.cobranca.ler' },
  },
  // 08-SGO L97 (C3-028): desconto em folha da mensalidade (remessa à contratante, arquivo, retorno com baixa, conferência).
  {
    path: '/operadora/desconto-folha',
    name: 'operadora.desconto-folha',
    component: () => import('./telas/DescontoFolhaOperadoraTela.vue'),
    meta: { permissao: 'operadora.cobranca.ler' },
  },
  // 08-SGO L98 (C2-116): regras de coparticipação do plano e do contrato (escopo por guia, grupo, procedimento; tetos).
  {
    path: '/operadora/coparticipacao-regras',
    name: 'operadora.coparticipacao-regras',
    component: () => import('./telas/RegrasCoparticipacaoTela.vue'),
    meta: { permissao: 'operadora.beneficiario.ler' },
  },
  // 08-SGO L106 (C2-047): reembolso ao beneficiário (pedido, análise com glosa, pagamento, tabela por município).
  {
    path: '/operadora/reembolsos',
    name: 'operadora.reembolsos',
    component: () => import('./telas/ReembolsoOperadoraTela.vue'),
    meta: { permissao: 'operadora.reembolso.ler' },
  },
  // 08-SGO L100 (C2-095): comercial (proposta de adesão, força de venda, metas, campanhas, comissão com estorno).
  {
    path: '/operadora/comercial',
    name: 'operadora.comercial',
    component: () => import('./telas/ComercialOperadoraTela.vue'),
    meta: { permissao: 'operadora.comercial.ler' },
  },
  // M56 (etapa 4, F3): a rede credenciada e prestadora.
  {
    path: '/operadora/rede',
    name: 'operadora.rede',
    component: () => import('./telas/RedeOperadoraTela.vue'),
    meta: { permissao: 'operadora.prestador.ler' },
  },
  // M56 (etapa 5, F4): a autorização de guias e a auditoria médica.
  {
    path: '/operadora/autorizacoes',
    name: 'operadora.autorizacoes',
    component: () => import('./telas/AutorizacoesOperadoraTela.vue'),
    // Os domínios do item valem para todo perfil da operadora; as guias aparecem só com operadora.autorizacao.ler.
    meta: { permissao: 'operadora.dominio.ler' },
  },
  // M56 (etapa 6, F5): as contas médicas dos prestadores (atalho das telas da rede, da autorização e da cobrança; os
  // lotes só a quem lê as contas e o pagamento só à área financeira da operadora).
  {
    path: '/operadora/contas',
    name: 'operadora.contas',
    component: () => import('./telas/ContasOperadoraTela.vue'),
    meta: { permissao: 'operadora.dominio.ler' },
  },
  // M56 (etapa 8, F7): o portal do prestador credenciado, lado da operadora (contas do portal e domínios do item; as
  // contas só a quem lê a rede). O atendimento com protocolo entra na tela das autorizações.
  // 08-SGO L107 (C2-061): trocas TISS com os prestadores (recebidas e enviadas; receber a mensagem em arquivo).
  {
    path: '/operadora/troca-tiss',
    name: 'operadora.trocaTiss',
    component: () => import('./telas/TrocaTissOperadoraTela.vue'),
    meta: { permissao: 'operadora.conta.ler' },
  },
  {
    path: '/operadora/portal-prestador',
    name: 'operadora.portalPrestador',
    component: () => import('./telas/PortalPrestadorOperadoraTela.vue'),
    meta: { permissao: 'operadora.dominio.ler' },
  },
  // Correção do M56.1 (D-ANS-HOSPITAL-56): os catálogos da ANS para o hospital, pelo atalho da consulta de TISS/TUSS.
  {
    path: '/cadastros/catalogos/ans',
    name: 'catalogos.ans',
    component: () => import('./telas/CatalogosAnsTela.vue'),
    meta: { permissao: 'catalogo.ans.ler' },
  },
];
