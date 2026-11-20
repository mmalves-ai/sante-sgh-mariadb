// Permissões dos recursos novos do M09 (convencoes.md §12): painéis de saúde e documentos de prova. Recursos
// só do novo, sem opção em TBOPCOES: concedidos por perfil (ficha do M06, regra 3) ao Administrador do
// sistema (papel SBIS 1) pelo mapa SGH_ACESSO_MAPA_OPCAO.
import type { DeclaracaoPermissao } from './tipos.js';

const ADMIN = ['administrador-sistema'] as const;

export const PERMISSOES_M09 = [
  {
    codigo: 'sistema.saude.ler',
    descricao: 'Ver a saúde do sistema e do banco (painéis do Grafana)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: 'documento.emissao.criar',
    descricao: 'Emitir documento de prova (fora de produção)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: 'documento.emissao.reemitir',
    descricao: 'Emitir 2ª via de documento, com motivo',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: 'documento.etiqueta.imprimir',
    descricao: 'Imprimir pulseira ou etiqueta de prova',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
] as const satisfies readonly DeclaracaoPermissao[];
