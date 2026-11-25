// A competência de trabalho de cada módulo pede a permissão de leitura da tela do módulo (06-FAT linha 32): o
// faturista do SUS ou do repasse escolhe a dele sem a permissão das competências do convênio, e não a de outro módulo.
import { criarAbility, regrasDeAcesso } from '@sgh/dominio-acesso';
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { moduloPermitido } from './competencia-trabalho.controller.js';

const req = (...permissoes: string[]) =>
  ({ sgh: { ability: criarAbility(regrasDeAcesso(permissoes, null)) } }) as unknown as RequisicaoAutorizada;

const status = (fn: () => unknown): number | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { getStatus(): number }).getStatus();
  }
};

describe('moduloPermitido', () => {
  it('sem módulo é o da fonte pagadora, com a permissão das competências do convênio', () => {
    expect(moduloPermitido(undefined, req('faturamento.competencia.ler'))).toBe('fonte_pagadora');
    expect(status(() => moduloPermitido(undefined, req('faturamento.sus.ler')))).toBe(403);
  });

  it('cada módulo pede a permissão da própria tela', () => {
    expect(moduloPermitido('sus_ambulatorial', req('faturamento.sus.ler'))).toBe('sus_ambulatorial');
    expect(moduloPermitido('sus_internacao', req('faturamento.sus.ler'))).toBe('sus_internacao');
    expect(moduloPermitido('repasse', req('repasse.lancamento.ler'))).toBe('repasse');
    expect(moduloPermitido('rpa', req('repasse.rpa.ler'))).toBe('rpa');
    expect(status(() => moduloPermitido('rpa', req('repasse.lancamento.ler')))).toBe(403);
    expect(status(() => moduloPermitido('sus_internacao', req('faturamento.competencia.ler')))).toBe(403);
  });

  it('módulo fora da lista é entrada inválida; sem sessão avaliada, sem permissão', () => {
    expect(status(() => moduloPermitido('estoque', req('faturamento.competencia.ler')))).toBe(400);
    expect(status(() => moduloPermitido('rpa', {} as RequisicaoAutorizada))).toBe(403);
  });
});
