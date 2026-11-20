import { describe, expect, it } from 'vitest';
import { cnpjValido } from './cpf.js';

describe('cnpjValido (M28, fornecedores)', () => {
  it('aceita CNPJ com os dois dígitos verificadores certos, com ou sem pontuação', () => {
    expect(cnpjValido('11222333000181')).toBe(true);
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
  });
  it('recusa dígito errado, tamanho errado e sequência repetida', () => {
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cnpjValido('1122233300018')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
  });
});
