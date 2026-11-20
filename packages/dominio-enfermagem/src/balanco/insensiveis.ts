// Perdas insensíveis e débito urinário (M45, etapa 3; regra 6): a fórmula é versionada (o fechamento grava a versão
// usada) e o resultado sai com a conta impressa. PI-2026.1 (padrão de mercado, a conferir com a gerência de
// enfermagem e a coordenação da UTI): 0,5 mL/kg/h, mais 10% para cada grau acima de 37 °C da temperatura máxima da
// janela. A oligúria é o débito urinário abaixo de 0,5 mL/kg/h com pelo menos 6 horas de janela.
import type { FormulaPerdaInsensivel } from '@sgh/contratos';

export interface FormulaInsensivel {
  readonly versao: FormulaPerdaInsensivel;
  readonly descricao: string;
  readonly mlPorKgHora: number;
  /** Acréscimo, em fração, por grau acima da temperatura de referência. */
  readonly febrePorGrau: number;
  readonly febreAcimaDe: number;
  readonly oliguriaMlKgH: number;
  readonly oliguriaHorasMinimas: number;
}

export const FORMULAS_INSENSIVEL: Readonly<Record<FormulaPerdaInsensivel, FormulaInsensivel>> = {
  'PI-2026.1': {
    versao: 'PI-2026.1',
    descricao: '0,5 mL/kg/h, mais 10% por grau acima de 37 °C',
    mlPorKgHora: 0.5,
    febrePorGrau: 0.1,
    febreAcimaDe: 37,
    oliguriaMlKgH: 0.5,
    oliguriaHorasMinimas: 6,
  },
  nenhuma: {
    versao: 'nenhuma',
    descricao: 'a unidade não estima as perdas insensíveis',
    mlPorKgHora: 0,
    febrePorGrau: 0,
    febreAcimaDe: 37,
    oliguriaMlKgH: 0.5,
    oliguriaHorasMinimas: 6,
  },
};

/** A fórmula pela versão do parâmetro; versão nunca vista é recusada (regra 15). */
export function formulaInsensivel(versao: string): FormulaInsensivel {
  const f = (FORMULAS_INSENSIVEL as Record<string, FormulaInsensivel | undefined>)[versao];
  if (!f) throw new Error(`Fórmula das perdas insensíveis desconhecida: ${versao}.`);
  return f;
}

const fmt = (n: number, casas = 1) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(n);
export const formatarMl = (n: number) => fmt(n, 1);

/** As perdas insensíveis da janela, com a conta impressa (sem peso, zero com o motivo). */
export function perdaInsensivel(
  f: FormulaInsensivel,
  pesoKg: number | null,
  horas: number,
  temperaturaMaxima: number | null,
): { ml: number; conta: string } {
  if (f.mlPorKgHora === 0) return { ml: 0, conta: `Perdas insensíveis: 0,0 mL (${f.descricao}).` };
  if (pesoKg === null || pesoKg <= 0)
    return { ml: 0, conta: 'Perdas insensíveis: 0,0 mL (sem o peso do paciente não são estimadas).' };
  const graus =
    temperaturaMaxima !== null && temperaturaMaxima > f.febreAcimaDe ? temperaturaMaxima - f.febreAcimaDe : 0;
  const ajuste = 1 + f.febrePorGrau * graus;
  const ml = Math.round(pesoKg * f.mlPorKgHora * horas * ajuste * 10) / 10;
  const febre = graus > 0 ? ` × ${fmt(ajuste, 2)} (febre de ${fmt(temperaturaMaxima ?? 0, 1)} °C)` : '';
  return {
    ml,
    conta: `Perdas insensíveis: ${fmt(pesoKg, 1)} kg × ${fmt(f.mlPorKgHora, 1)} mL/kg/h × ${fmt(horas, 1)} h${febre} = ${fmt(ml, 1)} mL (${f.versao}).`,
  };
}

/** O débito urinário em mL/kg/h, com a conta impressa; null sem peso ou sem horas. */
export function debitoUrinario(
  f: FormulaInsensivel,
  diureseMl: number,
  pesoKg: number | null,
  horas: number,
): { valor: number | null; conta: string | null; oliguria: boolean } {
  if (pesoKg === null || pesoKg <= 0 || horas <= 0) return { valor: null, conta: null, oliguria: false };
  const valor = Math.round((diureseMl / pesoKg / horas) * 100) / 100;
  const oliguria = horas >= f.oliguriaHorasMinimas && valor < f.oliguriaMlKgH;
  return {
    valor,
    conta: `Débito urinário: ${fmt(diureseMl, 1)} mL ÷ ${fmt(pesoKg, 1)} kg ÷ ${fmt(horas, 1)} h = ${fmt(valor, 2)} mL/kg/h${oliguria ? ` (abaixo de ${fmt(f.oliguriaMlKgH, 1)}: oligúria)` : ''}.`,
    oliguria,
  };
}
