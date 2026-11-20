// Comuns da tela da folha (M53.1): as competências que a tela oferece, os números no formato do Brasil (centavos e
// minutos inteiros, como no contrato), a leitura do arquivo de retorno escolhido e o texto de um código de recusa.
import { ErroApi } from '../../casca/erros/problem-details.js';

/** As `n` competências até a de `hoje` (AAAA-MM), da mais nova para a mais antiga. */
export function competenciasAte(hoje: string, n = 24): string[] {
  let a = Number(hoje.slice(0, 4));
  let m = Number(hoje.slice(5, 7));
  const r: string[] = [];
  for (let i = 0; i < n; i++) {
    r.push(`${a}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      a -= 1;
    }
  }
  return r;
}

/** 2026-09 → 09/2026. */
export const rotuloCompetencia = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** Centavos inteiros → "R$ 1.234,56". */
export const reais = (centavos: number) => MOEDA.format(centavos / 100).replace(/\u00A0/g, ' ');

/** Minutos inteiros → "160:30" (horas:minutos). */
export function horas(minutos: number): string {
  const sinal = minutos < 0 ? '-' : '';
  const abs = Math.abs(minutos);
  return `${sinal}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/** A soma do lote: o exportado leva minutos (ponto + plantão), o recebido leva centavos (líquido + encargos). */
export const somaDoLote = (sentido: 'exportado' | 'recebido', soma: number) =>
  sentido === 'exportado' ? horas(soma) : reais(soma);

/** "2026-10-26T14:03:00" → "26/10/2026 14:03". */
export function instanteBr(i: string): string {
  const [d, h] = i.split('T');
  const [a, m, dia] = (d ?? '').split('-');
  return a && m && dia ? `${dia}/${m}/${a}${h ? ' ' + h.slice(0, 5) : ''}` : i;
}

/** O conteúdo do arquivo de retorno: JSON (o servidor confere o leiaute) ou nulo se não for JSON. */
export function lerRetorno(texto: string): unknown {
  try {
    const v: unknown = JSON.parse(texto.replace(/^\uFEFF/, ''));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** O código e os campos de uma recusa da API (para a tela escolher o texto). */
export function recusaDe(e: unknown): { codigo: string; campos: string[] } | null {
  if (!(e instanceof ErroApi)) return null;
  const p = e.problema as { codigo?: unknown; campos?: unknown } | null;
  if (typeof p?.codigo !== 'string') return null;
  const campos = Array.isArray(p.campos) ? p.campos.filter((c): c is string => typeof c === 'string') : [];
  return { codigo: p.codigo, campos };
}
