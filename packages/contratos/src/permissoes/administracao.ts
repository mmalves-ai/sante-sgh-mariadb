// Permissões do M10 (ficha, seção 7): Administração › Acesso, Organização e parâmetros, Auditoria e
// privacidade e Cadastros › Estrutura. Códigos em camelCase de três partes (o catálogo do M06 recusa `_`): a
// ficha escreve `acesso.quebra_vidro.ler`, aqui `acesso.quebraVidro.ler` (decisão D3 do M12). Quem tem a opção
// no legado tem a permissão no novo (opções da árvore de TBOPCOES do módulo de abertura e do módulo Tabelas:
// retrato tools/verificadores/dados/acesso-legado.pc.json); permissão sem opção correspondente é recurso novo,
// concedido por perfil (SGH_ACESSO_MAPA_OPCAO). As de estrutura que são CRUD genérico (unidade, centro de
// custo, clínica, bloco, local, feriado, prioridade, local de conta e unidade de consumo) saem das declarações
// (permissoes/dominios.ts).
import type { DeclaracaoPermissao } from './tipos.js';

/**
 * Opções do legado (TBOPCOES) usadas aqui, com o caminho no menu:
 * - 5429 Cadastro de usuários; 5433 › Gerenciamento de usuários; 5434 › Incluir; 5435 › Alterar; 5437 Permissões
 *   (módulo de abertura).
 * - 6397 Tabelas › Geral M–Z › Termo Concordância; 6400 › Consultar.
 * - 4887 Tabelas › Geral A–L › Controle de alertas; 5125 › Sistemas.
 * - 5418 Dados do hospital; 5760 › Consultar (módulo de abertura).
 * - 2323 Recepção interna › Leitos › Manutenção; 2325 › Listagens; 2341 › Visualização; 2340 › Manutenção ›
 *   Inatividade.
 * - 6511 Privacidade e proteção de dados; 6516 › Configurações › Consultar; 6519 › Anonimização › Consultar.
 */
export const OPCOES_M10 = {
  cadastroUsuarios: 5429,
  gerenciamentoUsuarios: 5433,
  incluirUsuario: 5434,
  alterarUsuario: 5435,
  permissoes: 5437,
  termo: 6397,
  termoConsultar: 6400,
  alertas: 4887,
  alertasSistemas: 5125,
  dadosHospital: 5418,
  dadosHospitalConsultar: 5760,
  leitosManutencao: 2323,
  leitosListagens: 2325,
  leitosVisualizacao: 2341,
  leitosInatividade: 2340,
  privacidade: 6511,
  privacidadeConsultar: 6516,
  anonimizacaoConsultar: 6519,
} as const;

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
const O = OPCOES_M10;
const GESTOR = ['gestor-acessos'] as const;
const AUDITOR = ['auditor'] as const;
const ADMIN = ['administrador-sistema'] as const;

export const PERMISSOES_M10: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.usuarioLer,
    descricao: 'Consultar usuários: lista e ficha (grupo, escopos, papéis SBIS, flags, último acesso)',
    opcoesLegado: [O.cadastroUsuarios, O.gerenciamentoUsuarios],
    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
  },
  {
    codigo: C.usuarioCriar,
    descricao: 'Criar usuário (login exato; CPF não repetido; reautenticação)',
    opcoesLegado: [O.incluirUsuario],
    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.usuarioEditar,
    descricao: 'Alterar o nome completo do usuário (reautenticação)',
    opcoesLegado: [O.alterarUsuario],
    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.usuarioBloquear,
    descricao: 'Bloquear e desbloquear usuário (as sessões caem; ninguém bloqueia a si mesmo)',
    opcoesLegado: [O.alterarUsuario],
    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.escopoEditar,
    descricao: 'Conceder e retirar escopos do usuário (unidade, local, convênio, agenda, prontuário, setor)',
    opcoesLegado: [O.alterarUsuario],
    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.opcaoConceder,
    descricao: 'Conceder opções do menu a um grupo pela árvore de permissões (reautenticação)',
    opcoesLegado: [O.permissoes],
    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.opcaoRevogar,
    descricao: 'Retirar opções do menu de um grupo pela árvore de permissões (reautenticação)',
    opcoesLegado: [O.permissoes],
    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.simuladorLer,
    descricao: 'Simulador: o que um usuário pode fazer e por quê (só consulta)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestor-acessos', 'auditor', 'administrador-sistema'],
    categoria: 'tecnica',
  },
  {
    codigo: C.quebraVidroLer,
    descricao: 'Consultar os acessos por quebra de vidro e a revisão de cada um',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: AUDITOR,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.termoLer,
    descricao: 'Consultar o termo de uso vigente e os aceites',
    opcoesLegado: [O.termo, O.termoConsultar],
    concessaoPorPerfil: 'por-perfil',
    perfis: GESTOR,
    categoria: 'tecnica',
  },
  {
    codigo: C.termoAceitar,
    descricao: 'Aceitar o termo de uso vigente (no primeiro acesso, uma vez por versão)',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  },
  {
    codigo: C.alertaLer,
    descricao: 'Consultar os alertas e gatilhos do sistema',
    opcoesLegado: [O.alertas, O.alertasSistemas],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: C.emailLer,
    descricao: 'Consultar o servidor de e-mail e as notificações (credencial só "definida / não definida")',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: C.empresaLer,
    descricao: 'Consultar os dados fiscais da empresa e do hospital (sem credencial)',
    opcoesLegado: [O.dadosHospital, O.dadosHospitalConsultar],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'administrativa',
  },
  {
    codigo: C.estruturaLer,
    descricao: 'Consultar a estrutura: empresa, hospital (CNES) e unidades',
    opcoesLegado: [O.dadosHospital, O.dadosHospitalConsultar],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'administrativa',
  },
  {
    codigo: C.leitoLer,
    descricao: 'Consultar blocos, acomodações e leitos e a conferência com o registro de conferência',
    opcoesLegado: [O.leitosManutencao, O.leitosListagens, O.leitosVisualizacao],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  {
    codigo: C.leitoEditar,
    descricao: 'Incluir, alterar e inativar acomodações e leitos (nunca a ocupação)',
    opcoesLegado: [O.leitosManutencao, O.leitosInatividade],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  {
    codigo: C.trilhaExportar,
    descricao: 'Exportar a trilha de auditoria (CSV, XML e HTML; só o papel Auditor)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: AUDITOR,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.acessoProntuarioLer,
    descricao: 'Consultar o registro de acesso ao prontuário (quem viu, quando e por qual tela)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: AUDITOR,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.lgpdLer,
    descricao: 'Consultar os pedidos do titular e os domínios de privacidade',
    opcoesLegado: [O.privacidade, O.privacidadeConsultar, O.anonimizacaoConsultar],
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
    opcoesLegado: [O.privacidade],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.backupLer,
    descricao: 'Consultar a situação e os procedimentos de backup',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['operador-backup', 'auditor', 'administrador-sistema'],
    categoria: 'tecnica',
  },
];
