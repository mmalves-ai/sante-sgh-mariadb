// Permissões do M59-F4 (saneamento dos grupos genéricos; ficha do M59, seção 7). A leitura usa a permissão de grupos
// do M10 (acesso.grupo.ler); sanear (decidir, aprovar pela área, aplicar e dissolver) é recurso novo, concedido por
// perfil ao gestor de acessos: o menu antigo não tem saneamento.
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_M59_F4_CODIGOS = {
  grupoSanear: 'acesso.grupo.sanear',
} as const;

export const PERMISSOES_M59_F4: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_M59_F4_CODIGOS.grupoSanear,
    descricao:
      'Sanear os grupos de acesso amplo: decidir o grupo de trabalho de cada usuário, aprovar pela área, aplicar e retirar as opções do grupo vazio',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestor-acessos'],
    categoria: 'tecnica',
    criticidade: 'critica',
  },
];
