import { describe, expect, it } from 'vitest';
import { conferirChavePix, tipoProvavelChavePix } from './chave-pix.js';

// Documentos sintéticos com dígitos verificadores válidos (não são de pessoas).
const CPF = '529.982.247-25';
const CNPJ = '11.222.333/0001-81';
const UUID = '123E4567-E89B-12D3-A456-426614174000';

describe('chave Pix do credor', () => {
  it('normaliza cada tipo para a forma canônica', () => {
    expect(conferirChavePix('cpf', CPF)).toEqual({ ok: true, tipo: 'cpf', chave: '52998224725' });
    expect(conferirChavePix('cnpj', CNPJ)).toEqual({ ok: true, tipo: 'cnpj', chave: '11222333000181' });
    expect(conferirChavePix('email', ' Contas@Fornecedor.com.br ')).toEqual({
      ok: true,
      tipo: 'email',
      chave: 'contas@fornecedor.com.br',
    });
    expect(conferirChavePix('telefone', '(11) 98765-4321')).toEqual({
      ok: true,
      tipo: 'telefone',
      chave: '+5511987654321',
    });
    expect(conferirChavePix('telefone', '+55 21 3456-7890')).toEqual({
      ok: true,
      tipo: 'telefone',
      chave: '+552134567890',
    });
    expect(conferirChavePix('aleatoria', UUID)).toEqual({
      ok: true,
      tipo: 'aleatoria',
      chave: UUID.toLowerCase(),
    });
  });
  it('recusa com a mensagem do tipo', () => {
    expect(conferirChavePix('cpf', '111.111.111-11').ok).toBe(false);
    expect(conferirChavePix('cpf', '529.982.247-24').ok).toBe(false);
    expect(conferirChavePix('cnpj', '11.222.333/0001-80').ok).toBe(false);
    expect(conferirChavePix('email', 'sem-arroba.com').ok).toBe(false);
    expect(conferirChavePix('email', `${'a'.repeat(70)}@x.com.br`).ok).toBe(false);
    expect(conferirChavePix('telefone', '+1 212 555 0100').ok).toBe(false);
    expect(conferirChavePix('telefone', '(01) 98765-4321').ok).toBe(false);
    expect(conferirChavePix('telefone', '(11) 88765-43210').ok).toBe(false);
    expect(conferirChavePix('aleatoria', '123e4567e89b12d3a456426614174000').ok).toBe(false);
    expect(conferirChavePix('cpf', '  ')).toEqual({ ok: false, mensagem: 'Informe a chave Pix.' });
  });
  it('sugere o tipo pela forma digitada', () => {
    expect(tipoProvavelChavePix('a@b.com')).toBe('email');
    expect(tipoProvavelChavePix(UUID)).toBe('aleatoria');
    expect(tipoProvavelChavePix(CPF)).toBe('cpf');
    expect(tipoProvavelChavePix(CNPJ)).toBe('cnpj');
    expect(tipoProvavelChavePix('+55 11 98765-4321')).toBe('telefone');
    expect(tipoProvavelChavePix('1198765432')).toBe('telefone');
    expect(tipoProvavelChavePix('abc')).toBeNull();
  });
});
