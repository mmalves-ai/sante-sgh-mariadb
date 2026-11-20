// Comuns do fechamento do período e dos periódicos (M53.7): os anos e o período que a tela sugere, o rótulo do período
// (09/2026 ou o do 13º do ano), a entrada do fechamento conferida no contrato e quando a prévia permite fechar.
import {
  type ApuracaoFolha,
  esquemaFecharFolha,
  type FecharFolhaEntrada,
  type ResultadoFechamentoFolha,
} from '@sgh/contratos';
import { competenciasAte, rotuloCompetencia } from '../comum-folha.js';

/** Os `n` anos até o de `hoje`, do mais novo para o mais antigo. */
export function anosAte(hoje: string, n = 5): string[] {
  const a = Number(hoje.slice(0, 4));
  return Array.from({ length: n }, (_, i) => String(a - i));
}

/**
 * O período que a tela sugere: no mensal, a competência anterior à de hoje (a do mês corrente ainda está em curso);
 * no anual, o ano corrente a partir de dezembro e o anterior antes disso.
 */
export function periodoSugerido(apuracao: ApuracaoFolha, hoje: string): string {
  if (apuracao === 'mensal') return competenciasAte(hoje, 2)[1]!;
  const a = Number(hoje.slice(0, 4));
  return String(Number(hoje.slice(5, 7)) === 12 ? a : a - 1);
}

/** 2026-09 → "09/2026"; no anual, o texto da tela com o ano (`rotuloAnual`). */
export const rotuloPeriodo = (
  apuracao: ApuracaoFolha,
  periodo: string,
  rotuloAnual: (ano: string) => string,
) => (apuracao === 'mensal' ? rotuloCompetencia(periodo) : rotuloAnual(periodo));

/** A entrada do fechamento (a data de pagamento só no mensal), conferida no contrato. */
export function entradaFechar(
  empresa: number | null,
  apuracao: ApuracaoFolha,
  periodo: string,
  pagamento: string | null,
  simular: boolean,
): FecharFolhaEntrada | null {
  if (empresa === null) return null;
  const r = esquemaFecharFolha.safeParse({
    empresa,
    apuracao,
    periodo,
    pagamento: apuracao === 'mensal' ? pagamento : null,
    simular,
  });
  return r.success ? r.data : null;
}

/** A prévia permite fechar: sem pendência e com a prova da soma conferida. */
export const prontoParaFechar = (r: ResultadoFechamentoFolha | null) =>
  !!r && !r.fechado && r.pendencias.length === 0 && r.conferencia.ok;
