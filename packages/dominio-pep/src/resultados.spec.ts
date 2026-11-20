import { describe, expect, it } from 'vitest';
import {
  chaveDoExame,
  ehCritico,
  faixaDoTexto,
  foraDaFaixa,
  LIMITES_CRITICOS_PADRAO,
  numeroDoTexto,
  tendencias,
} from './resultados.js';

describe('resultados (regra 12)', () => {
  it('faixa de referência em texto livre', () => {
    expect(faixaDoTexto('12,0 a 16,0')).toEqual({ min: 12, max: 16 });
    expect(faixaDoTexto('3.5 - 5.1 mmol/L')).toEqual({ min: 3.5, max: 5.1 });
    expect(faixaDoTexto('até 200')).toEqual({ min: null, max: 200 });
    expect(faixaDoTexto('< 5')).toEqual({ min: null, max: 5 });
    expect(faixaDoTexto('> 40')).toEqual({ min: 40, max: null });
    expect(faixaDoTexto('Negativo')).toBeNull();
    expect(faixaDoTexto(null)).toBeNull();
  });

  it('fora da faixa e número', () => {
    expect(numeroDoTexto('10,5')).toBe(10.5);
    expect(numeroDoTexto('positivo')).toBeNull();
    expect(numeroDoTexto(undefined)).toBeNull();
    expect(foraDaFaixa(10, { min: 12, max: 16 })).toBe('abaixo');
    expect(foraDaFaixa(17, { min: 12, max: 16 })).toBe('acima');
    expect(foraDaFaixa(13, { min: 12, max: 16 })).toBeNull();
    expect(foraDaFaixa(null, { min: 12, max: 16 })).toBeNull();
    expect(foraDaFaixa(13, null)).toBeNull();
  });

  it('crítico pela lista do estabelecimento ou pelo laboratório', () => {
    expect(ehCritico('Potássio', 7.1, LIMITES_CRITICOS_PADRAO)).toBe(true);
    expect(ehCritico('POTASSIO', 4, LIMITES_CRITICOS_PADRAO)).toBe(false);
    expect(ehCritico('Hemoglobina', 6.5, LIMITES_CRITICOS_PADRAO)).toBe(true);
    expect(ehCritico('Ureia', 300, LIMITES_CRITICOS_PADRAO)).toBe(false);
    expect(ehCritico('Ureia', null, LIMITES_CRITICOS_PADRAO, true)).toBe(true);
    expect(ehCritico('Ureia', null, LIMITES_CRITICOS_PADRAO)).toBe(false);
  });

  it('tendência por elemento (só com dois pontos ou mais)', () => {
    const t = tendencias([
      { elemento: 'Hemoglobina', em: '2026-10-21', numero: 11, unidade: 'g/dL' },
      { elemento: 'HEMOGLOBINA', em: '2026-10-20', numero: 12, unidade: 'g/dL' },
      { elemento: 'Sódio', em: '2026-10-20', numero: 140, unidade: null },
      { elemento: 'Cultura', em: '2026-10-20', numero: null, unidade: null },
    ]);
    expect(t).toEqual([
      {
        elemento: 'Hemoglobina',
        unidade: 'g/dL',
        pontos: [
          { em: '2026-10-20', valor: 12 },
          { em: '2026-10-21', valor: 11 },
        ],
      },
    ]);
  });

  it('chave natural de 7 colunas', () => {
    expect(
      chaveDoExame({
        data: '2026-10-21T00:00:00',
        reg: 1,
        conta: 2,
        atend: ' 3',
        ato: 15,
        exame: 'HB',
        sequencia: 1,
      }),
    ).toBe('2026-10-21|1|2|3|15|HB|1');
  });
});
