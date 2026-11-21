// Campos do contrato do convênio como a tela os descreve (M12): os campos editáveis do contrato (CAMPOS_CONTRATO, de
// @sgh/contratos) e os de consulta do acordo no modelo próprio (contrato_fonte_pagadora e fonte_pagadora), por aba e
// tema. A fonte devolve os valores pela chave de negócio do campo (nunca pelo nome de uma coluna de origem).
// Melhoria: nenhum campo "a confirmar" nem constante oculta: o modelo só tem colunas com significado.
import { type AbaContrato, CAMPOS_CONTRATO } from '@sgh/contratos';

/** Campo editável → chave do valor (a própria chave de negócio). */
export const COLUNA_DO_CAMPO: Readonly<Record<string, string>> = Object.fromEntries(
  CAMPOS_CONTRATO.map((c) => [c.campo, c.campo]),
);

export interface ColunaContrato {
  readonly coluna: string;
  readonly aba: AbaContrato;
  readonly tema: number;
  readonly aConfirmar: boolean;
  readonly decimal: boolean;
  readonly campo: string | null;
}

/** Campos de consulta do acordo (somente leitura na tela; a edição é a do acordo). */
export const ROTULOS_CONSULTA: Readonly<Record<string, string>> = {
  situacaoAcordo: 'Situação do acordo',
  vigenciaInicio: 'Vigência: início',
  vigenciaFim: 'Vigência: fim',
  prazoApresentacaoDias: 'Prazo de apresentação da conta (dias)',
  diaCorteFaturamento: 'Dia de corte do faturamento',
  exigeGuia: 'Exige guia',
  cobraInsumos: 'Cobra insumos',
  faturaPelaDataAlta: 'Competência pela data da alta',
  abateDevolucao: 'Devolução abate a cobrança',
  exigeAuditoriaInterna: 'Exige auditoria interna',
  issRetidoPelaFonte: 'ISS retido pela fonte pagadora',
  percentualIss: 'ISS (%)',
  percentualIr: 'IR (%)',
  percentualCustoFinanceiro: 'Custo financeiro (%)',
};

const ABA_CONSULTA: Readonly<Record<string, readonly [AbaContrato, number, boolean]>> = {
  situacaoAcordo: ['cadastro', 1, false],
  vigenciaInicio: ['cadastro', 1, false],
  vigenciaFim: ['cadastro', 1, false],
  prazoApresentacaoDias: ['faturabilidade', 13, false],
  diaCorteFaturamento: ['faturabilidade', 13, false],
  exigeGuia: ['faturabilidade', 13, false],
  cobraInsumos: ['faturabilidade', 13, false],
  faturaPelaDataAlta: ['faturabilidade', 13, false],
  abateDevolucao: ['faturabilidade', 13, false],
  exigeAuditoriaInterna: ['faturabilidade', 13, false],
  issRetidoPelaFonte: ['financeiro', 17, false],
  percentualIss: ['financeiro', 17, true],
  percentualIr: ['financeiro', 17, true],
  percentualCustoFinanceiro: ['financeiro', 17, true],
};

export const COLUNAS_VISIVEIS: readonly ColunaContrato[] = [
  ...CAMPOS_CONTRATO.map((c) => ({
    coluna: c.campo,
    aba: c.aba,
    tema: c.tema,
    aConfirmar: false,
    decimal: false,
    campo: c.campo,
  })),
  ...Object.entries(ABA_CONSULTA).map(([coluna, [aba, tema, decimal]]) => ({
    coluna,
    aba,
    tema,
    aConfirmar: false,
    decimal,
    campo: null,
  })),
];

/** Nenhuma constante oculta no modelo próprio. */
export const COLUNAS_CONSTANTES: readonly string[] = [];

/** Todas as chaves que a fonte devolve no contrato. */
export const CHAVES_CONTRATO: readonly string[] = [...new Set(COLUNAS_VISIVEIS.map((c) => c.coluna))].sort();

/** A chave de consulta já é o nome de negócio. */
export const campoDeConsulta = (coluna: string): string => coluna;

const NUMERICAS = new Set(CAMPOS_CONTRATO.filter((c) => c.tipo === 'inteiro').map((c) => c.campo));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null);

/** Valor normalizado para gravar (texto aparado; número vazio = 0). */
export function valorParaGravar(campo: string, v: string | number | null): string | number {
  if (NUMERICAS.has(campo)) {
    if (v === null || v === '') return 0;
    return typeof v === 'number' ? v : Number(v);
  }
  return v === null ? '' : String(v).trim();
}

/** Comparação normalizada (texto aparado; vazio = nulo = 0 nos números). */
export function mesmoValor(campo: string, a: unknown, b: unknown): boolean {
  if (NUMERICAS.has(campo)) return (num(a) ?? 0) === (num(b) ?? 0);
  return (txt(a) ?? '') === (txt(b) ?? '');
}
