// Regra 6 do M33: adicionais de feriado e de fim de semana da regra (percentual de feriado e de fim de semana). Sem
// resposta da DP-33 vale o padrão de mercado (FAT-10): acréscimo da regra, com o modo no parâmetro
// repasse.adicionalModo ("sobre-valor": valor × (1 + adicional); "pontos": percentual + adicional). Os dois não se
// somam: no feriado que cai no fim de semana vale o feriado. No pc nenhuma regra usa adicional (0 de 105.430).
import { aplicarPercentual } from './dinheiro.js';

export type ModoAdicional = 'sobre-valor' | 'pontos';

export interface Adicional {
  readonly tipo: 'feriado' | 'fim-de-semana';
  readonly percentual: number;
}

/** Sábado ou domingo (data AAAA-MM-DD, em UTC para não depender do fuso). */
export function ehFimDeSemana(data: string): boolean {
  const d = new Date(`${data}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/** Lê o parâmetro repasse.feriados ("AAAA-MM-DD,AAAA-MM-DD"). */
export function lerFeriados(texto: string): ReadonlySet<string> {
  return new Set(
    texto
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
  );
}

export function adicionalDoDia(
  regra: { readonly percentualFeriado: number; readonly percentualFimDeSemana: number },
  data: string,
  feriados: ReadonlySet<string>,
): Adicional | null {
  if (feriados.has(data) && regra.percentualFeriado > 0)
    return { tipo: 'feriado', percentual: regra.percentualFeriado };
  if (ehFimDeSemana(data) && regra.percentualFimDeSemana > 0)
    return { tipo: 'fim-de-semana', percentual: regra.percentualFimDeSemana };
  return null;
}

/**
 * Valor com o adicional. Regra de valor fixo (percentual 0) só aceita "sobre-valor" (não há percentual a somar).
 * @returns centavos
 */
export function aplicarAdicional(
  calculo: { readonly baseCentavos: number; readonly percentual: number; readonly valorCentavos: number },
  adicional: Adicional | null,
  modo: ModoAdicional,
): number {
  if (!adicional) return calculo.valorCentavos;
  if (modo === 'pontos' && calculo.percentual > 0)
    return aplicarPercentual(calculo.baseCentavos, calculo.percentual + adicional.percentual);
  return calculo.valorCentavos + aplicarPercentual(calculo.valorCentavos, adicional.percentual);
}
