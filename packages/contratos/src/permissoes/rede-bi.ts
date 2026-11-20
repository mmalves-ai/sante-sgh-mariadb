// Permissões do M57, etapa 3 (ficha, seção 7; regras 10 e 11; convencoes.md §12): o BI consolidado da Rede e o
// registro dos serviços compartilhados. Não há opção no outro sistema para uma visão entre os estabelecimentos (cada
// hospital tem o seu banco e o seu "Dashboard"): as duas são recursos só do novo, concedidos pelo perfil complementar
// `diretoria-rede` (concessão nominal pela gestão de acessos, SGH_ACESSO_PERFIL_USUARIO, ou pelo mapa aprovado), que
// não carrega NENHUMA permissão do prontuário (`pep.*`, regra 10): a diretoria da Rede vê o consolidado sem abrir
// prontuário. Os nomes da ficha (`relatorio.bi_rede.acessar`) seguem o formato de três partes em camelCase (D-PERM-NOMES-57).
import type { DeclaracaoPermissao } from './tipos.js';

/** Perfil complementar da diretoria da Rede (o BI consolidado e o registro dos serviços compartilhados). */
export const PERFIL_DIRETORIA_REDE = 'diretoria-rede';

export const PERMISSOES_REDE_BI_CODIGOS = {
  biRedeAcessar: 'relatorio.biRede.acessar',
  servicoRegistrar: 'rede.servico.registrar',
} as const;

export const PERMISSOES_REDE_BI_M57 = [
  {
    codigo: PERMISSOES_REDE_BI_CODIGOS.biRedeAcessar,
    descricao:
      'Ver o BI consolidado da Rede (indicadores com a mesma ficha técnica, painel operacional e financeiro, por estabelecimento e da Rede; só agregados) e os serviços compartilhados registrados',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: [PERFIL_DIRETORIA_REDE],
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_REDE_BI_CODIGOS.servicoRegistrar,
    descricao:
      'Registrar e alterar as oportunidades de serviços compartilhados da Rede (catálogo, fornecedores, compras, laudos), sem compromisso de escopo',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: [PERFIL_DIRETORIA_REDE],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
] as const satisfies readonly DeclaracaoPermissao[];
