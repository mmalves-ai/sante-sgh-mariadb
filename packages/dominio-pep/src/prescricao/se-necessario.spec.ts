// Regra 9 do M24: "se necessário" e ACM exigem condição objetiva e intervalo mínimo.
import { describe, expect, it } from 'vitest';
import { frequencia } from './catalogo.js';
import { conferirSeNecessario, intervaloSugerido, MENSAGENS_SE_NECESSARIO } from './se-necessario.js';

const motivos = new Set([1, 2, 3, 4, 5]);

describe('se necessário', () => {
  it('ACM sem condição é recusado; intervalo sem condição passa', () => {
    expect(conferirSeNecessario(frequencia(1)!, null, motivos)).toBe('motivo-necessario');
    expect(conferirSeNecessario(frequencia(9)!, undefined, motivos)).toBeNull();
  });
  it('condição vazia, desconhecida e intervalo inválido', () => {
    expect(conferirSeNecessario(frequencia(9)!, { motivos: [], intervaloMinimoHoras: 8 }, motivos)).toBe(
      'motivo-necessario',
    );
    expect(conferirSeNecessario(frequencia(9)!, { motivos: [9], intervaloMinimoHoras: 8 }, motivos)).toBe(
      'motivo-desconhecido',
    );
    expect(conferirSeNecessario(frequencia(9)!, { motivos: [1], intervaloMinimoHoras: 0 }, motivos)).toBe(
      'intervalo-necessario',
    );
    expect(
      conferirSeNecessario(frequencia(1)!, { motivos: [1, 2], intervaloMinimoHoras: 6 }, motivos),
    ).toBeNull();
  });
  it('intervalo sugerido e mensagens', () => {
    expect(intervaloSugerido(frequencia(9)!)).toBe(8);
    expect(intervaloSugerido(frequencia(1)!)).toBe(6);
    expect(Object.keys(MENSAGENS_SE_NECESSARIO)).toHaveLength(3);
  });
});
