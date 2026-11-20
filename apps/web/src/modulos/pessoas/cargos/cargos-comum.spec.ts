import { describe, expect, it } from 'vitest';
import { rotasPessoas } from '../rotas.js';
import { centavosDe, quantidadeDe, reais } from './cargos-comum.js';
import { mensagensCargos } from './i18n-cargos.js';

describe('comuns de cargos e salários', () => {
  it('o valor em reais vira centavos e volta formatado', () => {
    expect(centavosDe('1.234,56')).toBe(123456);
    expect(centavosDe('R$ 5000')).toBe(500000);
    expect(centavosDe('5300,5')).toBe(530050);
    expect(centavosDe('0')).toBeNull();
    expect(centavosDe('12,345')).toBeNull();
    expect(centavosDe('abc')).toBeNull();
    expect(reais(530050)).toBe('R$ 5.300,50');
  });

  it('a quantidade do quadro é inteira de 1 a 9999', () => {
    expect(quantidadeDe('3')).toBe(3);
    expect(quantidadeDe('0')).toBeNull();
    expect(quantidadeDe('10000')).toBeNull();
    expect(quantidadeDe('2,5')).toBeNull();
  });

  it('a tela exige a permissão de leitura de cargos e os textos não citam tabela nem sistema antigo', () => {
    expect(rotasPessoas.find((r) => r.path === '/pessoas/cargos')?.meta?.['permissao']).toBe(
      'pessoas.cargos.ler',
    );
    const textos = JSON.stringify(mensagensCargos);
    expect(textos).not.toMatch(/spdata|legado|sistema antigo|SGH_|\bTB[A-Z]{3,}/i);
  });
});
