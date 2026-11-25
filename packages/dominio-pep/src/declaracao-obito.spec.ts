import { describe, expect, it } from 'vitest';
import {
  acaoCancelamentoObito,
  linhasDaCausa,
  statusDaRecusaObito,
  validarCancelamentoObito,
} from './declaracao-obito.js';

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
      deOutroMedico: false,
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
  it('quem não emitiu: recusa com 403', () => {
    expect(validarCancelamentoObito('emitida', 'Número do formulário trocado', false)).toMatchObject({
      ok: false,
      codigo: 'nao-emissor',
    });
    expect(statusDaRecusaObito('nao-emissor')).toBe(403);
    expect(statusDaRecusaObito('motivo-obrigatorio')).toBe(422);
    expect(statusDaRecusaObito('ja-cancelada')).toBe(409);
  });
  it('responsável técnico ou diretor clínico: cancela a de outro médico, com motivo e marcado como de terceiro', () => {
    expect(
      validarCancelamentoObito('emitida', '  Causa básica registrada na linha errada ', false, true),
    ).toEqual({
      ok: true,
      motivo: 'Causa básica registrada na linha errada',
      deOutroMedico: true,
    });
    // A permissão não dispensa o motivo nem reabre a já cancelada.
    expect(validarCancelamentoObito('emitida', 'curto', false, true)).toMatchObject({
      ok: false,
      codigo: 'motivo-obrigatorio',
    });
    expect(validarCancelamentoObito('cancelada', 'Motivo qualquer válido', false, true)).toMatchObject({
      ok: false,
      codigo: 'ja-cancelada',
    });
    // O próprio emissor com a permissão: cancelamento comum, não de terceiro.
    expect(validarCancelamentoObito('emitida', 'Número do formulário trocado', true, true)).toMatchObject({
      ok: true,
      deOutroMedico: false,
    });
  });
});

describe('declaração de óbito: o que a tela mostra antes do motivo (04-INT L74)', () => {
  it('o emissor pode cancelar, sem ser por terceiro', () => {
    expect(acaoCancelamentoObito(true, false)).toEqual({ pode: true, motivo: null, porTerceiro: false });
    expect(acaoCancelamentoObito(true, true)).toEqual({ pode: true, motivo: null, porTerceiro: false });
  });
  it('o responsável técnico ou diretor clínico cancela a de outro médico, sinalizado como por terceiro', () => {
    expect(acaoCancelamentoObito(false, true)).toEqual({ pode: true, motivo: null, porTerceiro: true });
  });
  it('o médico que não emitiu e não tem a permissão não vê o formulário: recebe o motivo da recusa', () => {
    const a = acaoCancelamentoObito(false, false);
    expect(a.pode).toBe(false);
    expect(a.motivo).toMatch(/Só o médico que emitiu/);
  });
});
