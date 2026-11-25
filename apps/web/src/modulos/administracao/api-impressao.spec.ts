import { describe, expect, it } from 'vitest';
import { reimpressaoPronta } from './api-impressao.js';

describe('reimpressão conferida na hora (01-ADM L79)', () => {
  const m = (exigeComplemento: boolean) => ({ id: 1, codigo: 'M', descricao: 'Motivo', exigeComplemento });
  it('sem motivo não libera', () => expect(reimpressaoPronta(null, 'qualquer texto')).toBe(false));
  it('motivo simples libera sem complemento', () => expect(reimpressaoPronta(m(false), '')).toBe(true));
  it('motivo que pede complemento só libera com 5 caracteres', () => {
    expect(reimpressaoPronta(m(true), '  ab  ')).toBe(false);
    expect(reimpressaoPronta(m(true), 'rasgou')).toBe(true);
  });
});
