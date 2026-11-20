// Permissões do M59-F5 (pacote de evidências SBIS, autoavaliação, pré-auditoria e auditoria; termo das concessões e
// backup verificado; ficha do M59, seção 7). As telas leem com as permissões da ficha (auditoria.trilha.exportar,
// auditoria.backup.ler, config.coexistencia.ler); o resto é recurso só do novo, concedido por perfil: o menu antigo
// não tem certificação, termo de concessões nem registro de restauração. O responsável de conformidade (cap-13
// §13.6.4, na equipe de qualidade) conduz os ciclos pelo perfil gestao-qualidade; o Auditor só lê (a segregação do
// M06 retira dele todo verbo que não é de leitura); o termo é encerrado pelo administrador do sistema (comitê).
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_M59_F5_CODIGOS = {
  sbisLer: 'auditoria.sbis.ler',
  sbisAvaliar: 'auditoria.sbis.avaliar',
  concessaoEncerrar: 'auditoria.concessao.encerrar',
  backupRegistrar: 'auditoria.backup.registrar',
} as const;

export const PERMISSOES_M59_F5: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_M59_F5_CODIGOS.sbisLer,
    descricao:
      'Consultar a certificação: requisitos, pacote de evidências, autoavaliações, pré-auditorias e auditorias',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor', 'administrador-sistema', 'gestao-qualidade'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_M59_F5_CODIGOS.sbisAvaliar,
    descricao:
      'Conduzir a autoavaliação, registrar a pré-auditoria e a auditoria, as não conformidades e a correção de cada uma',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestao-qualidade'],
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: PERMISSOES_M59_F5_CODIGOS.concessaoEncerrar,
    descricao: 'Encerrar ou reabrir uma concessão da coexistência no termo, com a evidência do endurecimento',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: PERMISSOES_M59_F5_CODIGOS.backupRegistrar,
    descricao:
      'Registrar o relatório da restauração do backup (diária e mensal, com a verificação de integridade)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['operador-backup'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
];
