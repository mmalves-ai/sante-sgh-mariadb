// Permissões do módulo config (M02 a M04; convencoes.md §12). Recursos novos, sem opção no menu de origem:
// concedidos por perfil (ficha do M06, regra 3) ao Administrador do sistema (papel SBIS 1) pelo mapa
// SGH_ACESSO_MAPA_OPCAO; a revisão por área é do M10.
import type { DeclaracaoPermissao } from './tipos.js';

/** Forma antiga (M02 a M09), mantida para quem já a importava. */
export type PermissaoDeclarada = DeclaracaoPermissao;

const ADMIN = ['administrador-sistema'] as const;
/** M37: o comitê de coexistência (administrador do sistema) e o gestor de acessos. */
const COMITE = ['administrador-sistema', 'gestor-acessos'] as const;

export const PERMISSOES_CONFIG_COEXISTENCIA = [
  {
    codigo: 'config.schema.ler',
    descricao: 'Ver a verificação de schema dos bancos',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: 'config.schema.verificar',
    descricao: 'Rodar a verificação de schema sob demanda',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: 'config.estabelecimento.ler',
    descricao: 'Ver os estabelecimentos da rede',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  // M03: tela "Testes de assinatura de dados (Sante SGH × legado)"; só leitura (a execução é pela esteira).
  {
    codigo: 'config.assinatura.ler',
    descricao: 'Ver os testes de assinatura de dados por operação e estabelecimento',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  // M04: "Conferência de gravação" e "Saúde das conexões e avisos de colisão"; só leitura.
  {
    codigo: 'config.gravacao.ler',
    descricao: 'Ver a conferência de gravação (receitas, triggers, estados e provas pós-escrita)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: 'config.conexao.ler',
    descricao: 'Ver a saúde das conexões e os avisos de colisão',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  // M35: "Prontidão por setor" (aba da tela de assinaturas) e o painel da consolidação; só leitura. Para a TI e o
  // responsável técnico (grupos MASTER e MASTER_SEM_FINANCEIRO): o perfil é proposto no mapa pelo
  // `pnpm prontidao:relatorio` e aprovado pelo gestor de acessos (D-PERM-35).
  {
    codigo: 'config.coexistencia.ler',
    descricao:
      'Ver a prontidão por setor e hospital, a consolidação da semana e o painel de migração gradual (setores, indicadores)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  // M37: "Migração gradual dos usuários" (setores, pessoas, treinamento, indicadores, condução, chamados). Recursos
  // novos, concedidos por perfil ao administrador do sistema (comitê, coordenador e TI) e ao gestor de acessos; a
  // proposta do perfil dos grupos MASTER e MASTER_SEM_FINANCEIRO segue no mapa (D-PERM-35). "Abrir chamado" é de
  // todos. A condução usa `acesso.opcao.revogar` e `acesso.opcao.conceder` (M10, opção de permissões do legado).
  {
    codigo: 'config.coexistenciaSetor.editar',
    descricao:
      'Mudar a situação e a composição do setor e aplicar ou recolher o lote de liberação (reautenticação)',

    concessaoPorPerfil: 'por-perfil',
    perfis: COMITE,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: 'config.coexistenciaPessoas.ler',
    descricao:
      'Ver a migração por pessoa (login, nome de usuário, trilha, último uso); a leitura vai à trilha',

    concessaoPorPerfil: 'por-perfil',
    perfis: COMITE,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'config.coexistenciaTreino.ler',
    descricao: 'Ver as trilhas por papel, as turmas e as conclusões do treinamento',

    concessaoPorPerfil: 'por-perfil',
    perfis: COMITE,
    categoria: 'tecnica',
  },
  {
    codigo: 'config.coexistenciaTreino.registrar',
    descricao:
      'Publicar a versão da trilha e registrar a conclusão do treinamento (instrutor e chave-usuário)',

    concessaoPorPerfil: 'por-perfil',
    perfis: COMITE,
    categoria: 'tecnica',
  },
  {
    codigo: 'config.chamado.ler',
    descricao: 'Ver os chamados por severidade e prazo',

    concessaoPorPerfil: 'por-perfil',
    perfis: COMITE,
    categoria: 'tecnica',
  },
  {
    codigo: 'config.chamado.triar',
    descricao: 'Triar o chamado: severidade, nível, situação, comandante (S1) e contorno (N1 e N2)',

    concessaoPorPerfil: 'por-perfil',
    perfis: COMITE,
    categoria: 'tecnica',
  },
  {
    codigo: 'config.chamado.abrir',
    descricao: 'Abrir um chamado de dentro do sistema (em que sistema aconteceu, severidade, descrição)',

    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'tecnica',
  },
] as const satisfies readonly DeclaracaoPermissao[];

/** Códigos das permissões do M37. */
export const PERMISSOES_M37 = {
  ler: 'config.coexistencia.ler',
  setorEditar: 'config.coexistenciaSetor.editar',
  pessoasLer: 'config.coexistenciaPessoas.ler',
  treinoLer: 'config.coexistenciaTreino.ler',
  treinoRegistrar: 'config.coexistenciaTreino.registrar',
  chamadoLer: 'config.chamado.ler',
  chamadoTriar: 'config.chamado.triar',
  chamadoAbrir: 'config.chamado.abrir',
  opcaoRevogar: 'acesso.opcao.revogar',
  opcaoConceder: 'acesso.opcao.conceder',
} as const;
