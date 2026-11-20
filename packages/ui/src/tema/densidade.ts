// Densidades (cap-03 §3.3): compacta (estação, padrão), confortável (tablet, alvo ≥ 44 px), painel (TV).
export const DENSIDADES = ['compacta', 'confortavel', 'painel'] as const;
export type Densidade = (typeof DENSIDADES)[number];

export interface MedidasDensidade {
  /** Tamanho base do texto, em px. */
  readonly fonteBase: number;
  /** Menor texto permitido, em px (nunca abaixo de 12). */
  readonly fontePequena: number;
  /** Altura mínima de alvo interativo (botão, campo, item de lista), em px. */
  readonly alvoMinimo: number;
  /** Altura de linha de tabela, em px. */
  readonly linhaTabela: number;
  /** Unidade de espaçamento, em px. */
  readonly espaco: number;
}

export const MEDIDAS: Readonly<Record<Densidade, MedidasDensidade>> = {
  compacta: { fonteBase: 14, fontePequena: 12, alvoMinimo: 32, linhaTabela: 32, espaco: 4 },
  confortavel: { fonteBase: 16, fontePequena: 14, alvoMinimo: 44, linhaTabela: 48, espaco: 6 },
  painel: { fonteBase: 24, fontePequena: 18, alvoMinimo: 48, linhaTabela: 56, espaco: 8 },
};

export function classeDensidade(d: Densidade): string {
  return `densidade-${d}`;
}

/** Variáveis CSS de uma densidade, inclusive os ajustes do OpenVue (padding de campo, botão e célula). */
export function variaveisDensidade(d: Densidade): Record<string, string> {
  const m = MEDIDAS[d];
  const e = m.espaco;
  const padVert = Math.max(2, Math.round((m.alvoMinimo - m.fonteBase * 1.4) / 2));
  return {
    '--sgh-fonte-base': `${m.fonteBase}px`,
    '--sgh-fonte-pequena': `${m.fontePequena}px`,
    '--sgh-alvo-minimo': `${m.alvoMinimo}px`,
    '--sgh-linha-tabela': `${m.linhaTabela}px`,
    '--sgh-espaco-1': `${e}px`,
    '--sgh-espaco-2': `${e * 2}px`,
    '--sgh-espaco-3': `${e * 3}px`,
    '--sgh-espaco-4': `${e * 4}px`,
    '--p-form-field-padding-y': `${padVert}px`,
    '--p-form-field-padding-x': `${e * 2}px`,
    '--p-button-padding-y': `${padVert}px`,
    '--p-button-padding-x': `${e * 3}px`,
    '--p-datatable-body-cell-padding': `${Math.max(2, Math.round((m.linhaTabela - m.fonteBase * 1.4) / 2))}px ${e * 2}px`,
    '--p-datatable-header-cell-padding': `${e * 2}px ${e * 2}px`,
    '--p-list-option-padding': `${padVert}px ${e * 2}px`,
  };
}
