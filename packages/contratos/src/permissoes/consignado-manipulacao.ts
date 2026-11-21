import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_CONSIGNADO_CODIGOS = {
  ler: 'suprimentos.consignado.ler',
  registrar: 'suprimentos.consignado.registrar',
} as const;

export const PERMISSOES_MANIPULACAO_CODIGOS = {
  ler: 'suprimentos.manipulacao.ler',
  abrir: 'suprimentos.manipulacao.abrir',
  conferir: 'suprimentos.manipulacao.conferir',
} as const;

export const PERMISSOES_CONSIGNADO_MANIPULACAO_M46: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_CONSIGNADO_CODIGOS.ler,
    descricao:
      'Consultar o saldo de consignados por fornecedor e item, as remessas, os consumos e as reposições',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: PERMISSOES_CONSIGNADO_CODIGOS.registrar,
    descricao:
      'Registrar a remessa em consignação, a reposição do consumido, o faturamento pela nota fiscal e a devolução ao fornecedor',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_MANIPULACAO_CODIGOS.ler,
    descricao: 'Consultar os itens a manipular, as ordens de manipulação e as capelas',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: PERMISSOES_MANIPULACAO_CODIGOS.abrir,
    descricao:
      'Abrir a ordem de manipulação do item validado (capela, insumo, lote e validade da sobra) e baixar o insumo do estoque',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_MANIPULACAO_CODIGOS.conferir,
    descricao:
      'Fazer a dupla conferência da ordem de manipulação preparada por outro farmacêutico: farmacêutico com o conselho ativo',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
    exigeConselho: true,
  },
];
