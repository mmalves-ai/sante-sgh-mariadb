// Regra 20 (ficha do M52; RDC63-05): ciência de POP versionado.
import { describe, expect, it } from 'vitest';
import {
  adesaoPop,
  conferirCienciaPop,
  conferirRevogacaoPop,
  conferirVersaoPop,
  popAlcanca,
  popsPendentes,
  type PopVersaoLida,
  proximaVersaoPop,
  vigenteDoCodigo,
} from './pop.js';

const HOJE = '2026-10-26';
const v = (x: Partial<PopVersaoLida> = {}): PopVersaoLida => ({
  id: 1,
  codigo: 'POP-ENF-001',
  versao: 1,
  unidade: null,
  vigencia: '2026-01-01',
  situacao: 'vigente',
  ...x,
});
const ciencia = { proprio: true, jaCiente: false, unidadeDoColaborador: 12, desligado: false };

describe('versões do POP (regra 20)', () => {
  it('próxima versão: 1 sem versões; a maior + 1', () => {
    expect(proximaVersaoPop([])).toBe(1);
    expect(proximaVersaoPop([{ versao: 1 }, { versao: 3 }, { versao: 2 }])).toBe(4);
  });

  it('vigente do código: a única vigente ou null', () => {
    expect(vigenteDoCodigo([v({ situacao: 'substituido' }), v({ id: 2, versao: 2 })])?.id).toBe(2);
    expect(vigenteDoCodigo([v({ situacao: 'revogado' })])).toBeNull();
  });

  it('versão nova: vigência até 30 dias atrás, não antes da atual, alterações da 2ª em diante, mesma unidade', () => {
    expect(conferirVersaoPop({ vigencia: HOJE, unidade: null, alteracoes: null }, [], HOJE)).toBeNull();
    expect(
      conferirVersaoPop({ vigencia: '2026-09-26', unidade: null, alteracoes: null }, [], HOJE),
    ).toBeNull();
    expect(
      conferirVersaoPop({ vigencia: '2026-09-25', unidade: null, alteracoes: null }, [], HOJE)?.codigo,
    ).toBe('vigencia-passada');
    const atual = [v({ vigencia: '2026-10-25' })];
    expect(
      conferirVersaoPop(
        { vigencia: '2026-10-24', unidade: null, alteracoes: 'Troca do antisséptico' },
        atual,
        HOJE,
      )?.codigo,
    ).toBe('vigencia-anterior');
    expect(
      conferirVersaoPop({ vigencia: HOJE, unidade: null, alteracoes: 'curta' }, atual, HOJE)?.codigo,
    ).toBe('alteracoes-obrigatorias');
    expect(conferirVersaoPop({ vigencia: HOJE, unidade: null, alteracoes: null }, atual, HOJE)?.codigo).toBe(
      'alteracoes-obrigatorias',
    );
    expect(
      conferirVersaoPop({ vigencia: HOJE, unidade: 7, alteracoes: 'Troca do antisséptico' }, atual, HOJE)
        ?.codigo,
    ).toBe('unidade-diferente');
    expect(
      conferirVersaoPop({ vigencia: HOJE, unidade: null, alteracoes: 'Troca do antisséptico' }, atual, HOJE),
    ).toBeNull();
  });

  it('revogar só a vigente', () => {
    expect(conferirRevogacaoPop(v())).toBeNull();
    expect(conferirRevogacaoPop(v({ situacao: 'substituido' }))?.codigo).toBe('versao-nao-vigente');
  });
});

describe('ciência do POP (regra 20)', () => {
  it('alcance: o do estabelecimento alcança todos; o da unidade, só os lotados nela', () => {
    expect(popAlcanca(v(), null)).toBe(true);
    expect(popAlcanca(v({ unidade: 12 }), 12)).toBe(true);
    expect(popAlcanca(v({ unidade: 12 }), 7)).toBe(false);
    expect(popAlcanca(v({ unidade: 12 }), null)).toBe(false);
  });

  it('ciência: própria, ativo, versão vigente, da unidade, uma vez', () => {
    expect(conferirCienciaPop(v(), ciencia)).toBeNull();
    expect(conferirCienciaPop(v(), { ...ciencia, proprio: false })?.codigo).toBe('ciencia-so-propria');
    expect(conferirCienciaPop(v(), { ...ciencia, desligado: true })?.codigo).toBe('colaborador-desligado');
    expect(conferirCienciaPop(v({ situacao: 'substituido' }), ciencia)?.codigo).toBe('versao-nao-vigente');
    expect(conferirCienciaPop(v({ unidade: 7 }), ciencia)?.codigo).toBe('pop-de-outra-unidade');
    expect(conferirCienciaPop(v(), { ...ciencia, jaCiente: true })?.codigo).toBe('ja-ciente');
  });

  it('pendentes: vigentes que alcançam sem a ciência; a versão nova pede ciência de novo', () => {
    const pops = [
      v({ id: 1 }),
      v({ id: 2, codigo: 'POP-UTI-002', unidade: 7 }),
      v({ id: 3, codigo: 'POP-ENF-003' }),
      v({ id: 4, codigo: 'POP-ENF-004', situacao: 'revogado' }),
    ];
    expect(popsPendentes(pops, 12, new Set([3])).map((p) => p.id)).toEqual([1]);
    // A versão 2 do POP-ENF-003 (id 5) substitui a 1 (id 3): a ciência antiga não vale para ela.
    const novas = [
      v({ id: 3, codigo: 'POP-ENF-003', situacao: 'substituido' }),
      v({ id: 5, codigo: 'POP-ENF-003', versao: 2 }),
    ];
    expect(popsPendentes(novas, 12, new Set([3])).map((p) => p.id)).toEqual([5]);
  });

  it('adesão: cientes ÷ alcançados (inteiro, para baixo); sem alcançados, 0%', () => {
    expect(adesaoPop(3, 2)).toEqual({ alcancados: 3, cientes: 2, percentual: 66 });
    expect(adesaoPop(0, 0)).toEqual({ alcancados: 0, cientes: 0, percentual: 0 });
    expect(adesaoPop(2, 5)).toEqual({ alcancados: 2, cientes: 2, percentual: 100 });
  });
});
