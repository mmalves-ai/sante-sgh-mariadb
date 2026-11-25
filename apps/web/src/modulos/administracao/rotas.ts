// Rotas do M10 (acesso, organização e auditoria; ficha seção 7). Toda rota exige a permissão de leitura do
// catálogo (M06); o servidor confere de novo. A rota fixa `usuarios` vem antes de `usuarios/:login`.
import {
  PERMISSOES_ACESSO,
  PERMISSOES_M10_CODIGOS as C,
  PERMISSOES_M59_CODIGOS,
  PERMISSOES_M59_F5_CODIGOS,
} from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

const LocaisTela = () => import('./telas/LocaisTela.vue');

export const rotasAdministracao: RouteRecordRaw[] = [
  // ── Acesso ──
  {
    path: '/administracao/acesso/usuarios',
    name: 'adm.usuarios',
    component: () => import('./telas/UsuariosTela.vue'),
    meta: { permissao: C.usuarioLer },
  },
  {
    // M59-F1: contas do banco de dados e privilégio mínimo por módulo (só consulta; abre de Permissões).
    path: '/administracao/acesso/contas-banco',
    name: 'adm.contasBanco',
    component: () => import('./telas/ContasBancoTela.vue'),
    meta: { permissao: PERMISSOES_M59_CODIGOS.contaBancoLer },
  },
  {
    // 01-ADM L59: dar a uma conta existente o acesso a este estabelecimento, ou encerrá-lo (abre da ficha).
    path: '/administracao/acesso/vinculo-conta',
    name: 'adm.vinculoConta',
    component: () => import('./telas/VinculoContaTela.vue'),
    meta: { permissao: C.usuarioLer },
  },
  {
    path: '/administracao/acesso/usuarios/:login',
    name: 'adm.usuario',
    component: () => import('./telas/FichaUsuarioTela.vue'),
    props: true,
    meta: { permissao: C.usuarioLer },
  },
  {
    path: '/administracao/acesso/permissoes',
    name: 'adm.permissoes',
    component: () => import('./telas/PermissoesTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.permissaoLer },
  },
  {
    path: '/administracao/acesso/simulador',
    name: 'adm.simulador',
    component: () => import('./telas/SimuladorTela.vue'),
    meta: { permissao: C.simuladorLer },
  },
  {
    path: '/administracao/acesso/quebras-de-vidro',
    name: 'adm.quebras',
    component: () => import('./telas/QuebrasVidroTela.vue'),
    meta: { permissao: C.quebraVidroLer },
  },
  {
    path: '/administracao/acesso/termo',
    name: 'adm.termo',
    component: () => import('./telas/TermoTela.vue'),
    meta: { permissao: C.termoLer },
  },
  // ── Organização e parâmetros ──
  {
    path: '/administracao/alertas',
    name: 'adm.alertas',
    component: () => import('./telas/AlertasTela.vue'),
    meta: { permissao: C.alertaLer },
  },
  {
    path: '/administracao/notificacoes',
    name: 'adm.notificacoes',
    component: () => import('./telas/NotificacoesTela.vue'),
    meta: { permissao: C.emailLer },
  },
  {
    path: '/administracao/empresa',
    name: 'adm.empresa',
    component: () => import('./telas/EmpresaTela.vue'),
    meta: { permissao: C.empresaLer },
  },
  // ── Auditoria e privacidade ──
  {
    path: '/administracao/auditoria/trilha',
    name: 'adm.trilha',
    component: () => import('./telas/TrilhaTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.trilhaLer },
  },
  {
    // M59 (etapa 5): a certificação SBIS (requisitos, pacote de evidências e ciclos), ligada a partir da trilha.
    path: '/administracao/auditoria/sbis',
    name: 'adm.sbis',
    component: () => import('./telas/CertificacaoSbisTela.vue'),
    meta: { permissao: PERMISSOES_M59_F5_CODIGOS.sbisLer },
  },
  {
    // M59 (etapa 5): o backup verificado (restaurações diária e mensal), ligado a partir de "Backup e restauração".
    path: '/administracao/auditoria/backup',
    name: 'adm.backupVerificado',
    component: () => import('./telas/BackupVerificadoTela.vue'),
    meta: { permissao: C.backupLer },
  },
  {
    path: '/administracao/privacidade',
    name: 'adm.privacidade',
    component: () => import('./telas/PrivacidadeTela.vue'),
    meta: { permissao: C.lgpdLer },
  },
  {
    path: '/administracao/backup',
    name: 'adm.backup',
    component: () => import('./telas/BackupTela.vue'),
    meta: { permissao: C.backupLer },
  },
  // ── Cadastros › Estrutura ──
  {
    path: '/cadastros/estrutura',
    name: 'adm.estrutura',
    component: () => import('./telas/EstruturaTela.vue'),
    meta: { permissao: C.estruturaLer },
  },
  {
    path: '/cadastros/estrutura/leitos',
    name: 'adm.leitos',
    component: () => import('./telas/LeitosTela.vue'),
    meta: { permissao: C.leitoLer },
  },
  {
    path: '/cadastros/estrutura/centros-custo',
    name: 'adm.centros-custo',
    component: LocaisTela,
    props: { subitem: 'estruturaCentrosCusto', titulo: 'dominios.subitens.estruturaCentrosCusto' },
    // A permissão do domínio principal (gerada da declaração), não a do índice, que todo perfil tem.
    meta: { permissao: 'organizacao.centroCusto.ler' },
  },
  {
    path: '/cadastros/estrutura/locais',
    name: 'adm.locais',
    component: LocaisTela,
    props: { subitem: 'estruturaLocais', titulo: 'dominios.subitens.estruturaLocais' },
    meta: { permissao: 'organizacao.local.ler' },
  },
  {
    path: '/cadastros/estrutura/locais-conta',
    name: 'adm.locais-conta',
    component: LocaisTela,
    props: { subitem: 'estruturaLocaisConta', titulo: 'dominios.subitens.estruturaLocaisConta' },
    meta: { permissao: 'organizacao.localConta.ler' },
  },
];
