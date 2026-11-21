import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_CONTRATUALIZACAO_CODIGOS = {
  ler: 'faturamento.contratualizacao.ler',
  editar: 'faturamento.contratualizacao.editar',
} as const;

export const PERMISSOES_CONTRATUALIZACAO_M55_F5: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_CONTRATUALIZACAO_CODIGOS.ler,
    descricao:
      'Consultar a contratualização SUS: contratos com o gestor, incentivos, metas, apurações e o painel produção × meta',

    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'normal',
    escopos: ['convenio'],
  },
  {
    codigo: PERMISSOES_CONTRATUALIZACAO_CODIGOS.editar,
    descricao:
      'Cadastrar e alterar o contrato SUS (orçamento, incentivos, habilitação), as metas quantitativas e qualitativas e registrar a apuração do período',

    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'sensivel',
    escopos: ['convenio'],
  },
];
