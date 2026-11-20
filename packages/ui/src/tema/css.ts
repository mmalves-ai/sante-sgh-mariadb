// Folha de variáveis do Sante SGH: tokens de cor (claro e escuro), densidades, tipografia e impressão.
// Gerada dos tokens e injetada por instalarUi; o impresso é sempre claro (cap-03 §3.3).
import { type CoresDaMarca, NOMES_TOKENS, type TokensDeTema, tokensDoTema } from '../tokens/cores.js';
import { PALETA_CLINICA } from '../tokens/clinica.js';
import { DENSIDADES, MEDIDAS, classeDensidade, variaveisDensidade } from './densidade.js';

export const CLASSE_ESCURO = 'modo-escuro';
export const CLASSE_FONTE_AMPLIADA = 'fonte-ampliada';

function declarar(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
}

function variaveisCor(t: TokensDeTema, tema: 'claro' | 'escuro'): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const n of NOMES_TOKENS) vars[`--sgh-${n}`] = t[n];
  for (const e of PALETA_CLINICA) {
    vars[`--sgh-clinica-${e.id}-fundo`] = e[tema].fundo;
    vars[`--sgh-clinica-${e.id}-texto`] = e[tema].texto;
  }
  return vars;
}

export const TIPOGRAFIA: Record<string, string> = {
  '--sgh-fonte-texto': "'Inter', system-ui, sans-serif",
  '--sgh-fonte-titulo': "'Nunito Sans', 'Inter', system-ui, sans-serif",
  '--sgh-fonte-codigo': "'JetBrains Mono', ui-monospace, monospace",
};

export function folhaDeTokens(marca: CoresDaMarca): string {
  const { claro, escuro } = tokensDoTema(marca);
  const corClara = declarar(variaveisCor(claro, 'claro'));
  const corEscura = declarar(variaveisCor(escuro, 'escuro'));
  const densidades = DENSIDADES.map(
    (d) => `:root.${classeDensidade(d)} {\n${declarar(variaveisDensidade(d))}\n}`,
  );
  return [
    `:root {\n  color-scheme: light;\n${declarar(TIPOGRAFIA)}\n${corClara}\n${declarar(variaveisDensidade('compacta'))}\n}`,
    `:root.${CLASSE_ESCURO} {\n  color-scheme: dark;\n${corEscura}\n}`,
    ...densidades,
    ...DENSIDADES.map(
      (d) =>
        `:root.${classeDensidade(d)}.${CLASSE_FONTE_AMPLIADA} {\n  --sgh-fonte-base: ${Math.round(MEDIDAS[d].fonteBase * 1.25)}px;\n}`,
    ),
    // Impresso e PDF sempre claros, qualquer que seja o tema.
    `@media print {\n  :root, :root.${CLASSE_ESCURO} {\n  color-scheme: light;\n${corClara}\n  }\n}`,
    `@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    transition-duration: 0.01ms !important;\n    animation-duration: 0.01ms !important;\n  }\n}`,
  ].join('\n');
}
