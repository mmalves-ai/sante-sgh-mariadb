// Comuns da tela das rubricas (M53.2): as competências oferecidas, os números no formato do Brasil (centavos e
// centésimos de ponto inteiros, como no contrato), a vigência legível e o filtro da lista. Funções puras, testadas.
import type { RubricaFolha, VigenciaRubrica } from '@sgh/contratos';

/** A competência (AAAA-MM) de uma data (AAAA-MM-DD). */
export const competenciaDe = (data: string) => data.slice(0, 7);

// As competências e os reais são os da folha da competência (M53.1): um só lugar (D-TELA-532, unificado na integração).
export { competenciasAte, reais, rotuloCompetencia } from '../comum-folha.js';

/** 2026-09-01 → 01/09/2026. */
export function dataBr(d: string | null): string {
  if (!d) return '';
  const [a, m, dia] = d.split('-');
  return a && m && dia ? `${dia}/${m}/${a}` : d;
}

const PERCENTUAL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** Centésimos de ponto → "7,5%" (750 → 7,5%). */
export const percentual = (centesimos: number) => `${PERCENTUAL.format(centesimos / 100)}%`;

/** A vigência como texto: "desde 01/01/2026", "até 31/12/2025", "01/01/2025 a 31/12/2025" ou vazio (sem limite). */
export function textoVigencia(v: VigenciaRubrica): {
  chave: 'desde' | 'ate' | 'entre' | 'sempre';
  inicio: string;
  fim: string;
} {
  const inicio = dataBr(v.inicio);
  const fim = dataBr(v.fim);
  if (v.inicio && v.fim) return { chave: 'entre', inicio, fim };
  if (v.inicio) return { chave: 'desde', inicio, fim };
  if (v.fim) return { chave: 'ate', inicio, fim };
  return { chave: 'sempre', inicio, fim };
}

/** Busca da lista: código exato ou trecho da descrição (sem acento, sem caixa); `soDivergentes` filtra pela conferência. */
export function filtrarRubricas(
  rubricas: readonly RubricaFolha[],
  termo: string,
  divergentes: ReadonlySet<number> | null,
): RubricaFolha[] {
  const t = normalizar(termo.trim());
  return rubricas.filter((r) => {
    if (divergentes && !divergentes.has(r.id)) return false;
    if (!t) return true;
    return String(r.codigo) === t || normalizar(r.descricao).includes(t);
  });
}

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** As empresas que aparecem nas rubricas (para o filtro), em ordem. */
export const empresasDasRubricas = (rubricas: readonly RubricaFolha[]) =>
  [...new Set(rubricas.map((r) => r.empresa))].sort((a, b) => a - b);
