// Regra 11 (ficha do M26): código único no formato do legado, QR da validação pública sem conteúdo clínico, 2ª via.
import { describe, expect, it } from 'vitest';
import {
  codigoAutenticacaoValido,
  codigoDeAutenticacao,
  enderecoDeValidacao,
  rotuloDaVia,
} from './autenticacao.js';

describe('autenticação do laudo (regra 11)', () => {
  const u = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  it('código no formato do legado', () => {
    expect(codigoDeAutenticacao(u.toUpperCase())).toBe(u);
    expect(codigoAutenticacaoValido(u)).toBe(true);
    expect(codigoAutenticacaoValido('abc')).toBe(false);
    expect(() => codigoDeAutenticacao('abc')).toThrow(/formato/);
  });
  it('o QR leva só o endereço com o código', () => {
    expect(enderecoDeValidacao('https://resultados.exemplo/', u)).toBe(
      `https://resultados.exemplo/resultados/validar/${u}`,
    );
  });
  it('a via', () => {
    expect(rotuloDaVia(false, 0)).toBe('1ª via');
    expect(rotuloDaVia(true, 0)).toBe('1ª via');
    expect(rotuloDaVia(true, 1)).toBe('2ª via');
    expect(rotuloDaVia(true, 2)).toBe('3ª via');
  });
});
