// Rotas do módulo acesso (M05/M07/M06). Toda rota declara meta.permissao (ou publica); o servidor é quem decide.
import { PERMISSOES_ACESSO, PERMISSOES_M59_F2_CODIGOS } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasAcesso: RouteRecordRaw[] = [
  {
    path: '/entrar',
    name: 'entrar',
    component: () => import('./telas/EntrarTela.vue'),
    meta: { publica: true },
  },
  // W1-01 (parte 7): "Esqueci a senha" (pedido e o link do e-mail com o token de uso único).
  {
    path: '/recuperar-senha',
    name: 'recuperar-senha',
    component: () => import('./telas/RecuperarSenhaTela.vue'),
    meta: { publica: true },
  },
  // modulos-proprios-3 (acesso-ligacao): "Esqueci a senha" da conta da plataforma (pedido pelo e-mail e o link).
  {
    path: '/plataforma/recuperar-senha',
    name: 'plataforma.recuperar-senha',
    component: () => import('./telas/RecuperarSenhaPlataformaTela.vue'),
    meta: { publica: true },
  },
  {
    path: '/senha',
    name: 'senha',
    component: () => import('./telas/SenhaTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.senhaTrocar },
  },
  {
    path: '/preferencias',
    name: 'preferencias',
    component: () => import('./telas/PreferenciasTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.preferenciaLer },
  },
  // M59-F2 (ficha do M59, seção 7): a segurança da conta (o próprio segundo fator). O endereço antigo redireciona.
  {
    path: '/preferencias/seguranca',
    name: 'seguranca',
    component: () => import('./telas/SegurancaTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.segundoFatorGerir },
  },
  { path: '/preferencias/segundo-fator', redirect: '/preferencias/seguranca' },
  {
    path: '/administracao/acesso/2fa',
    name: 'acesso.politica2fa',
    component: () => import('./telas/PoliticaSegundoFatorTela.vue'),
    meta: { permissao: PERMISSOES_M59_F2_CODIGOS.politica2faLer },
  },
  // W1-01 (parte 5): a política de senha do Sante por versão com vigência (gestor de acessos).
  {
    path: '/administracao/acesso/politica-senha',
    name: 'acesso.politicaSenha',
    component: () => import('./telas/PoliticaSenhaTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.perfilGerir },
  },
  // W1-01 (parte 9b2b): contas dormentes (prévia, exceções justificadas, rodar agora), gestor de acessos.
  {
    path: '/administracao/acesso/contas-dormentes',
    name: 'acesso.contasDormentes',
    component: () => import('./telas/ContasDormentesTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.perfilGerir },
  },
  // W1-01 (parte 9c2b): recertificação de acessos (campanhas, manter/retirar, encerrar), gestor de acessos.
  {
    path: '/administracao/acesso/recertificacao',
    name: 'acesso.recertificacao',
    component: () => import('./telas/RecertificacaoTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.perfilGerir },
  },
  // W1-01 (parte 10c): pedidos de acesso — a própria pessoa (aberta também pelo botão da tela "Sem permissão") e a
  // aprovação em dois níveis pelo gestor de acessos.
  {
    path: '/preferencias/pedidos-acesso',
    name: 'acesso.meusPedidos',
    component: () => import('./telas/MeusPedidosAcessoTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.preferenciaLer },
  },
  {
    path: '/administracao/acesso/pedidos',
    name: 'acesso.pedidos',
    component: () => import('./telas/PedidosAcessoTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.perfilGerir },
  },
  // W1-01 (parte 11a3): tarefas do RH (criar, revisar, suspender acesso) e mapa cargo → perfil, gestor de acessos.
  {
    path: '/administracao/acesso/rh',
    name: 'acesso.rh',
    component: () => import('./telas/TarefasRhTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.perfilGerir },
  },
  // M06 (ficha, seção 7): consultas de leitura; as telas de edição são do M10.
  {
    path: '/administracao/acesso/grupos',
    name: 'acesso.grupos',
    component: () => import('./telas/GruposTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.grupoLer },
  },
  // M59-F4 (ficha do M59, seção 7): o saneamento dos grupos de acesso amplo, aberto da tela de grupos.
  {
    path: '/administracao/acesso/grupos/saneamento',
    name: 'acesso.saneamento',
    component: () => import('./telas/SaneamentoGruposTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.grupoLer },
  },
  {
    path: '/administracao/acesso/mapa',
    name: 'acesso.mapa',
    component: () => import('./telas/MapaPermissoesTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.permissaoLer },
  },
  // ADR 0022: "Perfis e permissões" (efetivas com a origem, perfis do Sante SGH, mapa, permissões do legado).
  {
    path: '/administracao/acesso/perfis',
    name: 'acesso.perfis',
    component: () => import('./telas/PerfisPermissoesTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.perfilGerir },
  },
  {
    path: '/sobre',
    name: 'sobre',
    component: () => import('./telas/SobreTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.sobreLer },
  },
];
