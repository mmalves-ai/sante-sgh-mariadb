import { describe, expect, it } from 'vitest';
import { conta, PLANO } from './fixtures.spec-util.js';
import {
  arvoreDoPlano,
  codigoNaMascara,
  compararCodigos,
  nivelDoCodigo,
  niveisDaMascara,
  paiDoCodigo,
  problemasDoPlano,
  recusaDeLancamentoNaConta,
} from './plano.js';

const M = '9.9.9.99.9999';

describe('plano de contas', () => {
  it('máscara, nível e pai', () => {
    expect(niveisDaMascara(M)).toEqual([1, 1, 1, 2, 4]);
    expect(() => niveisDaMascara('9.X')).toThrow(RangeError);
    expect(codigoNaMascara('1.1.2.01.0001', M)).toBe(true);
    expect(codigoNaMascara('1.1.2', M)).toBe(true);
    expect(codigoNaMascara('1.1.2.1', M)).toBe(false);
    expect(codigoNaMascara('1.1.2.01.0001.1', M)).toBe(false);
    expect(nivelDoCodigo('1.1.2')).toBe(3);
    expect(paiDoCodigo('1.1.2')).toBe('1.1');
    expect(paiDoCodigo('1')).toBeNull();
  });

  it('ordena por nível numérico, o pai antes das filhas', () => {
    expect(['1.10', '1.9', '1', '2'].sort(compararCodigos)).toEqual(['1', '1.9', '1.10', '2']);
    expect(compararCodigos('1.1', '1.1')).toBe(0);
  });

  it('o plano sintético coerente não tem problema', () => {
    expect(problemasDoPlano(PLANO, { mascara: M })).toEqual([]);
  });

  it('acha máscara, repetida, sem pai, pai analítico, analítica com filha, grupo e natureza', () => {
    const plano = [
      conta('1', { tipo: 'sintetica' }),
      conta('1.1'), // analítica com filha
      conta('1.1.1'), // pai analítico
      conta('1.1.1'), // repetida
      conta('2.1', { grupo: 'passivo', natureza: 'credora' }), // sem pai
      conta('1.2', { grupo: 'passivo', natureza: 'credora' }), // grupo diferente do pai
      conta('1.3', { natureza: 'credora' }), // natureza
      conta('1.44'), // máscara
    ];
    const regras = problemasDoPlano(plano, { mascara: M }).map((p) => `${p.codigo}:${p.regra}`);
    expect(regras).toEqual(
      expect.arrayContaining([
        '1.1.1:repetida',
        '1.1.1:paiAnalitico',
        '1.1:analiticaComFilhos',
        '2.1:semPai',
        '1.2:grupoDiferenteDoPai',
        '1.3:naturezaDoGrupo',
        '1.44:mascara',
      ]),
    );
  });

  it('redutora analítica pode ter natureza invertida; sintética não', () => {
    const plano = [conta('1', { tipo: 'sintetica' }), conta('1.5', { natureza: 'credora' })];
    expect(problemasDoPlano(plano, { mascara: M, redutoras: new Set(['1.5']) })).toEqual([]);
    const sint = [conta('1', { tipo: 'sintetica', natureza: 'credora' })];
    expect(problemasDoPlano(sint, { mascara: M, redutoras: new Set(['1']) })[0]?.regra).toBe(
      'naturezaDoGrupo',
    );
  });

  it('referencial: aviso até ligar a ECD, erro com a exigência', () => {
    const plano = [conta('1', { tipo: 'sintetica' }), conta('1.1', { referencialTipo: null })];
    expect(problemasDoPlano(plano, { mascara: M })[0]).toMatchObject({
      regra: 'semReferencial',
      gravidade: 'aviso',
    });
    expect(problemasDoPlano(plano, { mascara: M, referencialObrigatorio: true })[0]?.gravidade).toBe('erro');
    expect(
      problemasDoPlano([conta('1', { tipo: 'sintetica' }), conta('1.1', { referencialConta: '' })], {
        mascara: M,
      }),
    ).toHaveLength(1);
  });

  it('só conta analítica ativa recebe lançamento', () => {
    const por = new Map(PLANO.map((c) => [c.codigo, c]));
    expect(recusaDeLancamentoNaConta(por.get('3.1.1.01.0001'), '3.1.1.01.0001')).toBeNull();
    expect(recusaDeLancamentoNaConta(por.get('3.1'), '3.1')).toMatch(/sintética/);
    expect(recusaDeLancamentoNaConta(por.get('3.1.1.01.0009'), '3.1.1.01.0009')).toMatch(/inativa/);
    expect(recusaDeLancamentoNaConta(undefined, '9')).toMatch(/não existe/);
  });

  it('monta a árvore', () => {
    const a = arvoreDoPlano(PLANO);
    expect(a.map((n) => n.conta.codigo)).toEqual(['1', '3']);
    expect(a[0]?.filhas[0]?.filhas[0]?.filhas[0]?.filhas.map((n) => n.conta.codigo)).toEqual([
      '1.1.2.01.0001',
      '1.1.2.01.0002',
    ]);
  });
});
