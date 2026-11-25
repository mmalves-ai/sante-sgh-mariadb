import { describe, expect, it } from 'vitest';
import { barrasItf, LARGURA_LARGA, linhaDigitavelFormatada } from './codigo-barras-itf.js';

describe('código de barras do boleto (ITF, 07-FIN linha 78)', () => {
  it('44 dígitos: 4 de início + 22 pares de 5 barras e 5 espaços + 3 de fim; 2 barras largas por dígito', () => {
    const r = barrasItf('0'.repeat(44));
    expect(r).not.toBeNull();
    // Barras pretas: 2 no início, 5 por par, 2 no fim.
    expect(r!.barras).toHaveLength(2 + 22 * 5 + 2);
    // Cada dígito tem 2 largas e 3 estreitas: 5 + 2*2 = 9 módulos por dígito; guardas 4 + (3+1+1).
    expect(r!.largura).toBe(44 * (3 + 2 * LARGURA_LARGA) + 4 + LARGURA_LARGA + 2);
  });

  it('o par 12 intercala as barras do 1 (larga no início e no fim) com os espaços do 2', () => {
    const r = barrasItf('12')!;
    const larguras = r.barras.map((b) => b.largura);
    // início (1,1), dígito 1 = w n n n w, fim (3,1)
    expect(larguras).toEqual([1, 1, 3, 1, 1, 1, 3, 3, 1]);
    // O espaço depois da primeira barra do par é o primeiro elemento do 2 (estreito): x avança 3 + 1.
    expect(r.barras[3]!.x - r.barras[2]!.x).toBe(3 + 1);
  });

  it('recusa entrada ímpar ou com letra', () => {
    expect(barrasItf('123')).toBeNull();
    expect(barrasItf('12a4')).toBeNull();
  });

  it('linha digitável em blocos; outra coisa volta como veio', () => {
    expect(linhaDigitavelFormatada('00190000090000000000000000000000400000000010000')).toBe(
      '00190.00009 00000.000000 00000.000000 4 00000000010000',
    );
    expect(linhaDigitavelFormatada('curta')).toBe('curta');
  });
});
