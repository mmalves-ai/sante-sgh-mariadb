// Cadastro dos médicos solicitantes SUS no CRUD genérico (M51, etapa 2; ficha, seção 5, "Receita genérica do CRUD para
// FHLEITOUTI e FAMEDSOL": o FAMEDSOL nesta etapa; os leitos de UTI habilitados na etapa 4). FAMEDSOL (1 linha na cópia
// `pc`): CPF (chave, DOUBLE PRECISION, digitado), nome, CNS e CRM; sem trigger nem generator no catálogo RDB$. Substitui a
// consulta provisória do M14 (`faturamento.medicoSolicitanteExterno`). Opções do outro sistema (TBOPCOES, módulo
// Faturamento A.P.A.C.): Tabelas 920 e "Importa tabela FAMEDSOL" 1100 para gravar; com a raiz do módulo 4262 para ler.
import type { DominioPublico } from './tipos.js';

// Etapa 4: os leitos de UTI habilitados (FHLEITOUTI, 12 linhas): opções do módulo Faturamento A.I.H. (Tabelas 643 e
// Parâmetros 644 para gravar; a raiz 4252 para ler).
const AIH_RAIZ = 4252;
const AIH_TABELAS = 643;
const AIH_PARAMETROS = 644;
const APAC_RAIZ = 4262;
const APAC_TABELAS = 920;
const IMPORTA_FAMEDSOL = 1100;

export const DOMINIOS_M51: readonly DominioPublico[] = [
  {
    modulo: 'faturamento',
    recurso: 'susSolicitante',
    rotulo: { singular: 'Médico solicitante SUS', plural: 'Médicos solicitantes SUS' },
    subitem: 'susSolicitantes',
    natureza: 'editavel',
    acoes: ['ler', 'criar', 'editar', 'exportar'],
    opcoesLegado: {
      ler: [APAC_RAIZ, APAC_TABELAS, IMPORTA_FAMEDSOL],
      exportar: [APAC_TABELAS, IMPORTA_FAMEDSOL],
      criar: [APAC_TABELAS, IMPORTA_FAMEDSOL],
      editar: [APAC_TABELAS, IMPORTA_FAMEDSOL],
    },
    origemOpcoes: 'tbopcoes',
    marco: 'M51',
  },
  {
    modulo: 'faturamento',
    recurso: 'susLeitoUti',
    rotulo: { singular: 'Leito de UTI habilitado', plural: 'Leitos de UTI habilitados' },
    subitem: 'susLeitosUti',
    natureza: 'editavel',
    acoes: ['ler', 'criar', 'editar', 'exportar'],
    opcoesLegado: {
      ler: [AIH_RAIZ, AIH_TABELAS, AIH_PARAMETROS],
      exportar: [AIH_TABELAS, AIH_PARAMETROS],
      criar: [AIH_TABELAS, AIH_PARAMETROS],
      editar: [AIH_TABELAS, AIH_PARAMETROS],
    },
    origemOpcoes: 'tbopcoes',
    marco: 'M51',
  },
];
