// Permissões do M58 (ficha, seção 7): recursos novos, sem opção em TBOPCOES, concedidos por perfil ao Administrador do
// sistema (papel SBIS 1) pelo mapa SGH_ACESSO_MAPA_OPCAO. O painel "Prontidão do desligamento por hospital" é lido com
// `config.coexistencia.ler` (M35/M37) e o cartão "Plataforma do banco" com `config.schema.ler` (M02), como a ficha
// pede; o registro da checklist da M58-F1 é ação nova e crítica (reautenticação, SBIS-07), porque libera o passo de
// desligar (D-PERM-58). A fachada da sante-api (M58-F4, condicional) tem o par ler/configurar da ficha.
import type { DeclaracaoPermissao } from './tipos.js';

const ADMIN = ['administrador-sistema'] as const;

export const PERMISSOES_M58_CODIGOS = {
  painelLer: 'config.coexistencia.ler',
  plataformaLer: 'config.schema.ler',
  checklistRegistrar: 'config.desligamento.registrar',
  fachadaLer: 'integracao.fachada.ler',
  fachadaConfigurar: 'integracao.fachada.configurar',
} as const;

export const PERMISSOES_M58: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_M58_CODIGOS.checklistRegistrar,
    descricao:
      'Registrar, na checklist do desligamento, o substituto em uso ou o aceite de perder cada item do inventário, com a contingência e a evidência (reautenticação)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: PERMISSOES_M58_CODIGOS.fachadaLer,
    descricao: 'Ver o painel de estado da fachada de compatibilidade da API de integração da Hal-AI',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: PERMISSOES_M58_CODIGOS.fachadaConfigurar,
    descricao:
      'Configurar a fachada da API de integração da Hal-AI (superfícies, escopos de token e escrita, desligada por padrão; reautenticação)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
];
