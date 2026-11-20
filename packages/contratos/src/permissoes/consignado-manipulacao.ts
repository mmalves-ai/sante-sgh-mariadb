// Permissões do M46, etapa 4 (ficha, seção 7; convencoes.md §12): consignados e manipulação. Quem tem a opção no
// sistema anterior tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato
// tools/verificadores/dados/acesso-legado.pc.json), do módulo Gestão de estoque:
//   - Consignados 4467 (cadastro) e 1946 (relatório), "para Fornecedor consignado" 4482 (a devolução ao fornecedor) e a
//     Entrada de nota fiscal 5722 (o faturamento liga a nota da entrada ao consumo);
//   - Manipulação 1769 (Ordem de manipulação 1770, Capela/Grupos 1771), o relatório Manipulação 1952 (Pacientes/itens a
//     manipular 1954) e Liberar capelas bloqueadas 4499.
// A dupla conferência é do farmacêutico com a opção da ordem que não preparou a ordem (regra do domínio, no banco também).
import { OPCOES_SUPRIMENTOS } from './suprimentos.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_CONSIGNADO_MANIPULACAO = {
  consignados: 4467,
  consignadosRelatorio: 1946,
  devolucaoFornecedorConsignado: 4482,
  manipulacao: 1769,
  ordemManipulacao: 1770,
  capelasGrupos: 1771,
  manipulacaoRelatorio: 1952,
  itensAManipular: 1954,
  liberarCapelas: 4499,
} as const;

export const PERMISSOES_CONSIGNADO_CODIGOS = {
  ler: 'suprimentos.consignado.ler',
  registrar: 'suprimentos.consignado.registrar',
} as const;

export const PERMISSOES_MANIPULACAO_CODIGOS = {
  ler: 'suprimentos.manipulacao.ler',
  abrir: 'suprimentos.manipulacao.abrir',
  conferir: 'suprimentos.manipulacao.conferir',
} as const;

const O = OPCOES_CONSIGNADO_MANIPULACAO;
const S = OPCOES_SUPRIMENTOS;

export const PERMISSOES_CONSIGNADO_MANIPULACAO_M46: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_CONSIGNADO_CODIGOS.ler,
    descricao:
      'Consultar o saldo de consignados por fornecedor e item, as remessas, os consumos e as reposições',
    opcoesLegado: [O.consignados, O.consignadosRelatorio],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: PERMISSOES_CONSIGNADO_CODIGOS.registrar,
    descricao:
      'Registrar a remessa em consignação, a reposição do consumido, o faturamento pela nota fiscal e a devolução ao fornecedor',
    opcoesLegado: [O.consignados, O.devolucaoFornecedorConsignado, S.entradaNota],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_MANIPULACAO_CODIGOS.ler,
    descricao: 'Consultar os itens a manipular, as ordens de manipulação e as capelas',
    opcoesLegado: [O.manipulacao, O.manipulacaoRelatorio, O.itensAManipular, O.capelasGrupos],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: PERMISSOES_MANIPULACAO_CODIGOS.abrir,
    descricao:
      'Abrir a ordem de manipulação do item validado (capela, insumo, lote e validade da sobra) e baixar o insumo do estoque',
    opcoesLegado: [O.ordemManipulacao],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_MANIPULACAO_CODIGOS.conferir,
    descricao:
      'Fazer a dupla conferência da ordem de manipulação preparada por outro farmacêutico: farmacêutico com o conselho ativo',
    opcoesLegado: [O.ordemManipulacao, O.liberarCapelas],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
    exigeConselho: true,
  },
];
