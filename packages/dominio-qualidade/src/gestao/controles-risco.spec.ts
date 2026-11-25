// Controles do risco na matriz GUT: lista sem repetição, mitigado com barreira que funciona e a eficácia do conjunto.
import { describe, expect, it } from 'vitest';
import { eficaciaDosControles, nomeControleNormalizado, recusaControlesRisco } from './controles-risco.js';

const c = (
  nome: string,
  eficacia: 'eficaz' | 'parcialmenteEficaz' | 'ineficaz' | 'naoAvaliado' = 'naoAvaliado',
) => ({
  nome,
  tipo: 'preventivo' as const,
  eficacia,
});

describe('controles do risco', () => {
  it('o nome compara sem acento, sem espaço sobrando e sem caixa', () => {
    expect(nomeControleNormalizado('  Barra  de apóio ')).toBe('BARRA DE APOIO');
  });

  it('a lista ausente não é conferida; a repetida pelo nome normalizado é recusada', () => {
    expect(recusaControlesRisco(undefined, 'mitigado')).toBeNull();
    expect(recusaControlesRisco([c('Barra de apoio'), c('barra de  apóio')], 'identificado')).toBe(
      'controle-repetido',
    );
    expect(recusaControlesRisco([c('Barra de apoio'), c('Piso antiderrapante')], 'identificado')).toBeNull();
  });

  it('mitigado exige ao menos um controle eficaz ou parcialmente eficaz', () => {
    expect(recusaControlesRisco([c('Barra de apoio', 'ineficaz'), c('Ronda')], 'mitigado')).toBe(
      'controle-eficaz-obrigatorio',
    );
    expect(recusaControlesRisco([c('Barra de apoio', 'parcialmenteEficaz')], 'mitigado')).toBeNull();
    expect(recusaControlesRisco([], 'mitigado')).toBeNull();
    expect(recusaControlesRisco([c('Ronda', 'ineficaz')], 'emTratamento')).toBeNull();
  });

  it('a eficácia do conjunto é a média dos avaliados (1; 0,5; 0) com cortes 0,75 e 0,4', () => {
    expect(eficaciaDosControles([])).toBe('semControle');
    expect(eficaciaDosControles([c('a'), c('b')])).toBe('naoAvaliado');
    // (1 + 0,5) ÷ 2 = 0,75 → eficaz; o não avaliado fica fora da média.
    expect(eficaciaDosControles([c('a', 'eficaz'), c('b', 'parcialmenteEficaz'), c('x')])).toBe('eficaz');
    // (1 + 0) ÷ 2 = 0,5 → parcialmente eficaz.
    expect(eficaciaDosControles([c('a', 'eficaz'), c('b', 'ineficaz')])).toBe('parcialmenteEficaz');
    // (0,5 + 0 + 0) ÷ 3 ≈ 0,17 → ineficaz.
    expect(eficaciaDosControles([c('a', 'parcialmenteEficaz'), c('b', 'ineficaz'), c('d', 'ineficaz')])).toBe(
      'ineficaz',
    );
  });
});
