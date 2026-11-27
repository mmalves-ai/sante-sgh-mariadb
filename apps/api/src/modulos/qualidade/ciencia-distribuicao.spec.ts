// Regra pura da ciência pela distribuição (ciencia-distribuicao.ts): o documento sem distribuição é aberto, fora da
// distribuição ou barrado recusa, e só deve ler quem a linha que exige ciência alcança sem barrar.
import { describe, expect, it } from 'vitest';
import { conferirCiencia, obrigadoACiencia } from './ciencia-distribuicao.js';

describe('conferirCiencia', () => {
  it('o documento sem distribuição é aberto a quem lê documentos', () => {
    expect(conferirCiencia({ distribuido: false, alcancado: false, negado: false })).toBeNull();
  });
  it('com distribuição, só quem ela alcança registra', () => {
    expect(conferirCiencia({ distribuido: true, alcancado: true, negado: false })).toBeNull();
    expect(conferirCiencia({ distribuido: true, alcancado: false, negado: false })).toBe(
      'fora-da-distribuicao',
    );
  });
  it('a linha que barra vence a que libera, com ou sem distribuição', () => {
    expect(conferirCiencia({ distribuido: true, alcancado: true, negado: true })).toBe(
      'fora-da-distribuicao',
    );
    expect(conferirCiencia({ distribuido: false, alcancado: false, negado: true })).toBe(
      'fora-da-distribuicao',
    );
  });
});

describe('obrigadoACiencia', () => {
  it('deve ler quem a linha que exige ciência alcança e nenhuma barra', () => {
    expect(obrigadoACiencia({ exige: true, negado: false })).toBe(true);
    expect(obrigadoACiencia({ exige: false, negado: false })).toBe(false);
    expect(obrigadoACiencia({ exige: true, negado: true })).toBe(false);
  });
});
