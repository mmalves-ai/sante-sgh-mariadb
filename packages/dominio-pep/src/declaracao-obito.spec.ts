import { describe, expect, it } from 'vitest';
import { linhasDaCausa, validarCancelamentoObito } from './declaracao-obito.js';

describe('declaração de óbito: causas em linhas', () => {
  it('parte I em ordem, linhas vazias de fora, parte II por último', () => {
    expect(linhasDaCausa({ a: ' Choque ', c: 'Sepse', d: '  ', parteII: 'Diabetes' })).toEqual([
      { sequencia: 1, parte: 'I', linha: 'a', descricao: 'Choque' },
      { sequencia: 2, parte: 'I', linha: 'c', descricao: 'Sepse' },
      { sequencia: 3, parte: 'II', linha: null, descricao: 'Diabetes' },
    ]);
  });
  it('sem a causa imediata, recusa', () => {
    expect(() => linhasDaCausa({ a: '  ' })).toThrow(/linha a/);
  });
  it('causa acima de 500 caracteres, recusa', () => {
    expect(() => linhasDaCausa({ a: 'x'.repeat(501) })).toThrow(/500/);
  });
});

describe('declaração de óbito: cancelamento', () => {
  it('emitida ou rascunho com motivo: cancela com o motivo limpo', () => {
    expect(validarCancelamentoObito('emitida', '  Número do formulário trocado  ')).toEqual({
      ok: true,
      motivo: 'Número do formulário trocado',
    });
    expect(validarCancelamentoObito('rascunho', 'Paciente identificado errado').ok).toBe(true);
  });
  it('já cancelada: recusa', () => {
    expect(validarCancelamentoObito('cancelada', 'Motivo qualquer válido')).toMatchObject({
      ok: false,
      codigo: 'ja-cancelada',
    });
  });
  it('motivo curto ou longo demais: recusa', () => {
    expect(validarCancelamentoObito('emitida', 'curto')).toMatchObject({
      ok: false,
      codigo: 'motivo-obrigatorio',
    });
    expect(validarCancelamentoObito('emitida', 'x'.repeat(2001))).toMatchObject({
      ok: false,
      codigo: 'motivo-obrigatorio',
    });
  });
});
