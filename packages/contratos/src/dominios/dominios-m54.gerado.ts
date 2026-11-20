// GERADO por `pnpm contabil:dominios` (tools/matriz/src/cli/lote-m54.ts) a partir do levantamento do M14: não editar à mão.
// Parte pública das declarações do CRUD genérico da controladoria (M54, etapa F1): 9 domínios
// {"sistema":3,"editavel":6}, nos grupos contabil, custos, patrimonio e financeiro.
import type { DominioPublico } from './tipos.js';

/** Subitens do menu com os cadastros do M54 (chave curta → id do item da árvore). */
export const SUBITENS_M54 = {
  contabilPlanoContas: 'controladoria.contabilidade.plano-de-contas-e-plano-referencial',
  contabilSpedEcdEcf: 'controladoria.contabilidade.sped-ecd-ecf',
  patrimonioBens: 'controladoria.patrimonio.cadastro-de-bens-plaquetas-e-responsaveis',
  patrimonioParametros: 'controladoria.patrimonio.parametros-do-patrimonio',
} as const;

export const DOMINIOS_M54: readonly DominioPublico[] = [
  {
    modulo: 'contabil',
    recurso: 'nire',
    rotulo: {
      plural: 'NIRE da junta comercial por estado',
      singular: 'NIRE da junta comercial por estado',
    },
    subitem: 'contabilSpedEcdEcf',
    natureza: 'sistema',
    acoes: ['ler', 'exportar'],
    opcoesLegado: {
      ler: [14],
      exportar: [14],
    },
    origemOpcoes: 'tbopcoes',
    marco: 'M54',
    motivoSomenteLeitura:
      'o NIRE de cada estado já está cadastrado com a vigência aberta: a troca de vigência chega com a escrituração contábil',
  },
  {
    modulo: 'contabil',
    recurso: 'periodoEscrituracao',
    rotulo: {
      plural: 'Indicadores de período da escrituração',
      singular: 'Indicador de período da escrituração',
    },
    subitem: 'contabilPlanoContas',
    natureza: 'editavel',
    acoes: ['ler', 'criar', 'editar', 'inativar', 'exportar'],
    opcoesLegado: {
      ler: [99, 4338],
      criar: [4338],
      editar: [4338],
      inativar: [4338],
      exportar: [99, 4338],
    },
    origemOpcoes: 'tbopcoes',
    marco: 'M54',
  },
  {
    modulo: 'contabil',
    recurso: 'tipoSolicitacaoSenha',
    rotulo: {
      plural: 'Tipos de solicitação de senha da contabilidade',
      singular: 'Tipo de solicitação de senha da contabilidade',
    },
    subitem: 'contabilPlanoContas',
    natureza: 'sistema',
    acoes: ['ler', 'exportar'],
    opcoesLegado: {
      ler: [4296],
      exportar: [4296],
    },
    origemOpcoes: 'tbopcoes',
    motivoSomenteLeitura: 'o banco de dados recusa inclusão e alteração: dado de sistema do fornecedor',
    marco: 'M54',
  },
  {
    modulo: 'contabil',
    recurso: 'origemLancamento',
    rotulo: {
      plural: 'Origens de lançamento contábil',
      singular: 'Origem de lançamento contábil',
    },
    subitem: 'contabilPlanoContas',
    natureza: 'editavel',
    acoes: ['ler', 'criar', 'editar', 'inativar', 'exportar'],
    opcoesLegado: {
      ler: [19, 4302],
      criar: [4302],
      editar: [4302],
      inativar: [4302],
      exportar: [19, 4302],
    },
    origemOpcoes: 'tbopcoes',
    marco: 'M54',
  },
  {
    modulo: 'patrimonio',
    recurso: 'coeficienteDepreciacao',
    rotulo: {
      plural: 'Coeficientes de depreciação',
      singular: 'Coeficiente de depreciação',
    },
    subitem: 'patrimonioBens',
    natureza: 'editavel',
    acoes: ['ler', 'criar', 'editar', 'inativar', 'exportar'],
    opcoesLegado: {
      ler: [261, 262],
      criar: [261],
      editar: [261],
      inativar: [261],
      exportar: [261, 262],
    },
    origemOpcoes: 'tbopcoes',
    marco: 'M54',
  },
  {
    modulo: 'patrimonio',
    recurso: 'origemBem',
    rotulo: {
      plural: 'Origens do bem patrimonial',
      singular: 'Origem do bem patrimonial',
    },
    subitem: 'patrimonioBens',
    natureza: 'editavel',
    acoes: ['ler', 'editar', 'inativar', 'exportar'],
    opcoesLegado: {
      ler: [4356],
      editar: [4356],
      inativar: [4356],
      exportar: [4356],
    },
    origemOpcoes: 'tbopcoes',
    marco: 'M54',
    semInclusao: 'as origens do bem patrimonial são fixas nesta etapa: só se alteram',
  },
  {
    modulo: 'patrimonio',
    recurso: 'parametroPatrimonio',
    rotulo: {
      plural: 'Parâmetros gerais do patrimônio',
      singular: 'Parâmetros gerais do patrimônio',
    },
    subitem: 'patrimonioParametros',
    natureza: 'editavel',
    acoes: ['ler', 'editar', 'inativar', 'exportar'],
    opcoesLegado: {
      ler: [261],
      editar: [261],
      inativar: [261],
      exportar: [261],
    },
    origemOpcoes: 'tbopcoes',
    marco: 'M54',
    semInclusao: 'os parâmetros gerais já existem para cada empresa: só se alteram',
  },
  {
    modulo: 'patrimonio',
    recurso: 'parametroUsuarioPatrimonio',
    rotulo: {
      plural: 'Parâmetros do patrimônio por usuário',
      singular: 'Parâmetro do patrimônio por usuário',
    },
    subitem: 'patrimonioParametros',
    natureza: 'sistema',
    acoes: ['ler', 'exportar'],
    opcoesLegado: {
      ler: [267],
      exportar: [267],
    },
    origemOpcoes: 'tbopcoes',
    marco: 'M54',
    motivoSomenteLeitura:
      'os parâmetros por usuário dependem do login de cada usuário: a gravação chega com o cadastro de bens patrimoniais',
  },
  {
    modulo: 'patrimonio',
    recurso: 'tipoResponsavelBem',
    rotulo: {
      plural: 'Tipos de responsável pelo bem',
      singular: 'Tipo de responsável pelo bem',
    },
    subitem: 'patrimonioBens',
    natureza: 'editavel',
    acoes: ['ler', 'criar', 'editar', 'inativar', 'exportar'],
    opcoesLegado: {
      ler: [261],
      criar: [261],
      editar: [261],
      inativar: [261],
      exportar: [261],
    },
    origemOpcoes: 'tbopcoes',
    marco: 'M54',
  },
];
