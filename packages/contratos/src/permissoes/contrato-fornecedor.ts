import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_CONTRATO_CODIGOS = {
  ler: 'suprimentos.contrato.ler',
  editar: 'suprimentos.contrato.editar',
  aditar: 'suprimentos.contrato.aditar',
  avaliar: 'suprimentos.contrato.avaliar',
} as const;

export const PERMISSOES_CONTRATO_M55_F3: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_CONTRATO_CODIGOS.ler,
    descricao:
      'Consultar os contratos com fornecedores: vigência, valor, aditivos, saldo com os pedidos e títulos ligados e avaliações',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: PERMISSOES_CONTRATO_CODIGOS.editar,
    descricao:
      'Cadastrar e alterar o contrato (partes, objeto, garantias, gestor e fiscal), ligar pedidos e títulos, registrar ocorrências e anexos, encerrar e rescindir',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_CONTRATO_CODIGOS.aditar,
    descricao:
      'Registrar o termo aditivo, o reajuste pelo índice e a renovação, e aprovar a exceção para pedido em contrato vencido (alçada)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_CONTRATO_CODIGOS.avaliar,
    descricao: 'Avaliar e qualificar o fornecedor do contrato (qualidade, prazo, atendimento e documentação)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
];
