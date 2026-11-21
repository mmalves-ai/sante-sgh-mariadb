// Permissões do M10 (ficha, seção 7): Administração › Acesso, Organização e parâmetros, Auditoria e
// privacidade e Cadastros › Estrutura. Códigos em camelCase de três partes (o catálogo do M06 recusa `_`): a
// ficha escreve `acesso.quebra_vidro.ler`, aqui `acesso.quebraVidro.ler` (decisão D3 do M12). Quem tem a opção
// no legado tem a permissão no novo (opções da árvore do menu de origem do módulo de abertura e do módulo Tabelas:
// retrato tools/verificadores/dados/acesso-legado.pc.json); permissão sem opção correspondente é recurso novo,
// concedido por perfil (mapa de opções do acesso). As de estrutura que são CRUD genérico (unidade, centro de
// custo, clínica, bloco, local, feriado, prioridade, local de conta e unidade de consumo) saem das declarações
// (permissoes/dominios.ts).
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_M10_CODIGOS = {
  usuarioLer: 'acesso.usuario.ler',
  usuarioCriar: 'acesso.usuario.criar',
  usuarioEditar: 'acesso.usuario.editar',
  usuarioBloquear: 'acesso.usuario.bloquear',
  escopoEditar: 'acesso.escopo.editar',
  opcaoConceder: 'acesso.opcao.conceder',
  opcaoRevogar: 'acesso.opcao.revogar',
  simuladorLer: 'acesso.simulador.ler',
  quebraVidroLer: 'acesso.quebraVidro.ler',
  termoLer: 'acesso.termo.ler',
  termoAceitar: 'acesso.termo.aceitar',
  alertaLer: 'config.alerta.ler',
  emailLer: 'config.email.ler',
  empresaLer: 'organizacao.empresa.ler',
  estruturaLer: 'organizacao.estrutura.ler',
  leitoLer: 'organizacao.leito.ler',
  leitoEditar: 'organizacao.leito.editar',
  trilhaExportar: 'auditoria.trilha.exportar',
  acessoProntuarioLer: 'auditoria.acessoProntuario.ler',
  lgpdLer: 'auditoria.lgpd.ler',
  pedidoTitularTratar: 'auditoria.pedidoTitular.tratar',
  backupLer: 'auditoria.backup.ler',
} as const;

const C = PERMISSOES_M10_CODIGOS;
const GESTOR = ['gestor-acessos'] as const;
const AUDITOR = ['auditor'] as const;
const ADMIN = ['administrador-sistema'] as const;

export const PERMISSOES_M10: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.usuarioLer,
    descricao: 'Consultar usuários: lista e ficha (grupo, escopos, papéis SBIS, flags, último acesso)',

    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
  },
  {
    codigo: C.usuarioCriar,
    descricao: 'Criar usuário (login exato; CPF não repetido; reautenticação)',

    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.usuarioEditar,
    descricao: 'Alterar o nome completo do usuário (reautenticação)',

    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.usuarioBloquear,
    descricao: 'Bloquear e desbloquear usuário (as sessões caem; ninguém bloqueia a si mesmo)',

    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.escopoEditar,
    descricao: 'Conceder e retirar escopos do usuário (unidade, local, convênio, agenda, prontuário, setor)',

    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.opcaoConceder,
    descricao: 'Conceder opções do menu a um grupo pela árvore de permissões (reautenticação)',

    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.opcaoRevogar,
    descricao: 'Retirar opções do menu de um grupo pela árvore de permissões (reautenticação)',

    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.simuladorLer,
    descricao: 'Simulador: o que um usuário pode fazer e por quê (só consulta)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestor-acessos', 'auditor', 'administrador-sistema'],
    categoria: 'tecnica',
  },
  {
    codigo: C.quebraVidroLer,
    descricao: 'Consultar os acessos por quebra de vidro e a revisão de cada um',

    concessaoPorPerfil: 'por-perfil',
    perfis: AUDITOR,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.termoLer,
    descricao: 'Consultar o termo de uso vigente e os aceites',

    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
  },
  {
    codigo: C.termoAceitar,
    descricao: 'Aceitar o termo de uso vigente (no primeiro acesso, uma vez por versão)',

    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  },
  {
    codigo: C.alertaLer,
    descricao: 'Consultar os alertas e gatilhos do sistema',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: C.emailLer,
    descricao: 'Consultar o servidor de e-mail e as notificações (credencial só "definida / não definida")',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: C.empresaLer,
    descricao: 'Consultar os dados fiscais da empresa e do hospital (sem credencial)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'administrativa',
  },
  {
    codigo: C.estruturaLer,
    descricao: 'Consultar a estrutura: empresa, hospital (CNES) e unidades',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'administrativa',
  },
  {
    codigo: C.leitoLer,
    descricao: 'Consultar blocos, acomodações e leitos e a conferência com o registro de conferência',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  {
    codigo: C.leitoEditar,
    descricao: 'Incluir, alterar e inativar acomodações e leitos (nunca a ocupação)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  {
    codigo: C.trilhaExportar,
    descricao: 'Exportar a trilha de auditoria (CSV, XML e HTML; só o papel Auditor)',

    concessaoPorPerfil: 'por-perfil',
    perfis: AUDITOR,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.acessoProntuarioLer,
    descricao: 'Consultar o registro de acesso ao prontuário (quem viu, quando e por qual tela)',

    concessaoPorPerfil: 'por-perfil',
    perfis: AUDITOR,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.lgpdLer,
    descricao: 'Consultar os pedidos do titular e os domínios de privacidade',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor', 'administrador-sistema'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.pedidoTitularTratar,
    descricao: 'Registrar e responder pedidos do titular (identidade, decisão e fundamento legal)',
    // O Auditor só consulta (segregação do M06: auditor não altera); quem trata o pedido é a área de
    // privacidade (opção raiz do legado) ou o administrador do sistema.

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.backupLer,
    descricao: 'Consultar a situação e os procedimentos de backup',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['operador-backup', 'auditor', 'administrador-sistema'],
    categoria: 'tecnica',
  },
];
