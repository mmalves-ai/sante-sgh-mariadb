import type { DeclaracaoPermissao } from './tipos.js';

// Permissões do módulo acesso. M07 e M05: recursos só do novo, concedidos a todos os perfis de pessoa (não a
// painel, totem ou integração). M06 (ficha, seção 7): consulta dos grupos e do mapa (opções do módulo de
// segurança do legado, módulo de abertura) e quebra de vidro (recurso novo; perfis assistenciais com conselho).
export const PERMISSOES_ACESSO = {
  inicioLer: 'acesso.inicio.ler',
  preferenciaLer: 'acesso.preferencia.ler',
  preferenciaEditar: 'acesso.preferencia.editar',
  sobreLer: 'acesso.sobre.ler',
  // M05 (ficha, seção 7): a própria pessoa; sem opção legada.
  senhaTrocar: 'acesso.senha.trocar',
  segundoFatorGerir: 'acesso.segundofator.gerir',
  // M06 (ficha, seção 7).
  grupoLer: 'acesso.grupo.ler',
  permissaoLer: 'acesso.permissao.ler',
  emergenciaSolicitar: 'acesso.emergencia.solicitar',
  emergenciaRevisar: 'acesso.emergencia.revisar',
  trilhaLer: 'auditoria.trilha.ler',
  // ADR 0022: tela "Perfis e permissões" (efetivas com a origem, perfis do Sante SGH, mapa e as permissões do
  // próprio legado pelas receitas do M04).
  perfilGerir: 'acesso.perfil.gerir',
} as const;

export type PermissaoAcesso = (typeof PERMISSOES_ACESSO)[keyof typeof PERMISSOES_ACESSO];

/**
 * Opções do módulo de abertura (sghspd, módulo -1) que já administram usuários e permissões no legado:
 * 5429 "Cadastro de usuários", 5433 "Gerenciamento de usuários" e 5437 "Permissões" (ativas; as de
 * grupo e papel, 5425 e 3888, estão inativas e ficam fora do catálogo, regra 2).
 */
export const OPCOES_SEGURANCA_LEGADO = { cadastroUsuarios: 5429, gerenciamento: 5433, permissoes: 5437 };

export const CATALOGO_ACESSO: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_ACESSO.inicioLer,
    descricao: 'Ver a página inicial (fila de trabalho do perfil)',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  },
  {
    codigo: PERMISSOES_ACESSO.preferenciaLer,
    descricao: 'Ver as próprias preferências (tema, densidade, atalhos)',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  },
  {
    codigo: PERMISSOES_ACESSO.preferenciaEditar,
    descricao: 'Alterar as próprias preferências',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  },
  {
    codigo: PERMISSOES_ACESSO.sobreLer,
    descricao: 'Ver a tela Sobre o sistema (versões; SBIS-01)',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  },
  {
    codigo: PERMISSOES_ACESSO.senhaTrocar,
    descricao: 'Trocar a própria senha (primeiro acesso, senha sem cifra ou expirada)',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    criticidade: 'critica',
  },
  {
    codigo: PERMISSOES_ACESSO.segundoFatorGerir,
    descricao: 'Cadastrar ou remover o próprio segundo fator (TOTP)',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    criticidade: 'critica',
  },
  {
    codigo: PERMISSOES_ACESSO.grupoLer,
    descricao: 'Consultar os grupos de usuários e o perfil proposto',
    opcoesLegado: [OPCOES_SEGURANCA_LEGADO.cadastroUsuarios, OPCOES_SEGURANCA_LEGADO.gerenciamento],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestor-acessos'],
    categoria: 'tecnica',
  },
  {
    codigo: PERMISSOES_ACESSO.permissaoLer,
    descricao: 'Consultar o mapa opção de menu → permissão',
    opcoesLegado: [OPCOES_SEGURANCA_LEGADO.cadastroUsuarios, OPCOES_SEGURANCA_LEGADO.permissoes],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestor-acessos', 'administrador-sistema'],
    categoria: 'tecnica',
  },
  {
    codigo: PERMISSOES_ACESSO.emergenciaSolicitar,
    descricao: 'Abrir o prontuário fora do vínculo por quebra de vidro (acesso de emergência)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['assistencial-com-conselho'],
    categoria: 'clinica',
    criticidade: 'critica',
    exigeConselho: true,
  },
  {
    codigo: PERMISSOES_ACESSO.emergenciaRevisar,
    descricao: 'Revisar os acessos por quebra de vidro (justificado ou não)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor'],
    categoria: 'tecnica',
  },
  {
    codigo: PERMISSOES_ACESSO.trilhaLer,
    descricao: 'Ler e exportar as duas trilhas de auditoria (a consulta é do M10)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_ACESSO.perfilGerir,
    descricao:
      'Perfis e permissões: ver as efetivas de um usuário, conceder e revogar perfis, grupos e papéis (reautenticação)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestor-acessos'],
    categoria: 'tecnica',
    criticidade: 'critica',
  },
];
