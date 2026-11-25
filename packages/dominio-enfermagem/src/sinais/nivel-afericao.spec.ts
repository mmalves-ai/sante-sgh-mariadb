import { describe, expect, it } from 'vitest';
import type { LimiteParametro } from './limites-setor.js';
import { conferirLimite, idadeEmDias, LIMITES_PADRAO_NEWS2, nivelDaAfericao } from './nivel-afericao.js';

const lim = (x: Partial<LimiteParametro>): LimiteParametro => ({
  id: 1,
  estabelecimento: null,
  setor: null,
  instrumento: null,
  sexo: 'ambos',
  idadeMinimaDias: 0,
  idadeMaximaDias: null,
  limiteInferior: 40,
  normalInferior: 60,
  normalSuperior: 100,
  limiteSuperior: 140,
  ativo: true,
  ...x,
});
const ctx = { estabelecimento: 1, setor: 7, instrumento: null, sexo: 'feminino' as const, idadeDias: 12_000 };
const faixa = { alertaMinimo: 50, alertaMaximo: 120 };

describe('nível de alerta da aferição (03-PEP L115)', () => {
  it('com limite que se aplica, classifica por ele e diz qual decidiu', () => {
    const ls = [lim({ id: 3 }), lim({ id: 9, setor: 7, normalSuperior: 90, limiteSuperior: 110 })];
    expect(nivelDaAfericao(95, ls, ctx, faixa)).toEqual({ nivel: 'atencao', limite: 9 });
    expect(nivelDaAfericao(115, ls, ctx, faixa)).toEqual({ nivel: 'critico', limite: 9 });
    expect(nivelDaAfericao(80, ls, ctx, faixa)).toEqual({ nivel: 'normal', limite: 9 });
    expect(nivelDaAfericao(115, ls, { ...ctx, setor: 8 }, faixa)).toEqual({ nivel: 'atencao', limite: 3 });
  });

  it('sem limite, vale a faixa do parâmetro (fora dela, atenção; nunca crítico)', () => {
    expect(nivelDaAfericao(130, [lim({ ativo: false })], ctx, faixa)).toEqual({
      nivel: 'atencao',
      limite: null,
    });
    expect(nivelDaAfericao(30, [], ctx, faixa)).toEqual({ nivel: 'atencao', limite: null });
    expect(nivelDaAfericao(70, [], ctx, faixa)).toEqual({ nivel: 'normal', limite: null });
    expect(nivelDaAfericao(70, [], ctx, { alertaMinimo: null, alertaMaximo: null }).nivel).toBe('normal');
  });

  it('idade em dias completos na data da aferição', () => {
    expect(idadeEmDias('2000-01-01', '2000-01-31T10:00')).toBe(30);
    expect(idadeEmDias(null, '2026-11-25T10:00')).toBeNull();
    expect(idadeEmDias('2030-01-01', '2026-11-25T10:00')).toBeNull();
  });
});

describe('cadastro do limite (03-PEP L115)', () => {
  const base = {
    sexo: 'ambos' as const,
    idadeMinimaDias: 0,
    idadeMaximaDias: null,
    limiteInferior: 40,
    normalInferior: 60,
    normalSuperior: 100,
    limiteSuperior: 140,
  };
  it('aceita as faixas em ordem e só uma faixa', () => {
    expect(conferirLimite(base)).toEqual([]);
    expect(
      conferirLimite({
        ...base,
        limiteInferior: null,
        normalInferior: null,
        normalSuperior: null,
        limiteSuperior: 9,
      }),
    ).toEqual([]);
  });
  it('recusa faixa vazia, faixas fora de ordem e idade invertida, com o campo', () => {
    const vazia = conferirLimite({
      ...base,
      limiteInferior: null,
      normalInferior: null,
      normalSuperior: null,
      limiteSuperior: null,
    });
    expect(vazia.map((e) => e.codigo)).toEqual(['limite-vazio']);
    expect(conferirLimite({ ...base, limiteInferior: 70 }).map((e) => e.codigo)).toEqual([
      'critico-inferior-acima-do-normal',
    ]);
    expect(conferirLimite({ ...base, normalInferior: 110 }).map((e) => e.codigo)).toContain(
      'normal-invertido',
    );
    expect(conferirLimite({ ...base, limiteSuperior: 90 }).map((e) => e.campo)).toEqual(['limiteSuperior']);
    expect(
      conferirLimite({ ...base, idadeMinimaDias: 100, idadeMaximaDias: 10 }).map((e) => e.codigo),
    ).toEqual(['idade-invertida']);
  });
  it('os padrões do NEWS2 passam pela conferência e classificam como a tabela do escore', () => {
    for (const p of Object.values(LIMITES_PADRAO_NEWS2))
      expect(conferirLimite({ ...p, sexo: 'ambos', idadeMaximaDias: null })).toEqual([]);
    const adulto = { ...ctx, idadeDias: 20_000 };
    const padrao = (k: keyof typeof LIMITES_PADRAO_NEWS2) => [
      lim({ ...LIMITES_PADRAO_NEWS2[k], idadeMaximaDias: null, id: 5 }),
    ];
    const sem = { alertaMinimo: null, alertaMaximo: null };
    expect(nivelDaAfericao(8, padrao('fr'), adulto, sem).nivel).toBe('critico');
    expect(nivelDaAfericao(22, padrao('fr'), adulto, sem).nivel).toBe('atencao');
    expect(nivelDaAfericao(25, padrao('fr'), adulto, sem).nivel).toBe('critico');
    expect(nivelDaAfericao(91, padrao('spo2'), adulto, sem).nivel).toBe('critico');
    expect(nivelDaAfericao(95, padrao('spo2'), adulto, sem).nivel).toBe('atencao');
    expect(nivelDaAfericao(90, padrao('pas'), adulto, sem).nivel).toBe('critico');
    expect(nivelDaAfericao(220, padrao('pas'), adulto, sem).nivel).toBe('critico');
    expect(nivelDaAfericao(131, padrao('fc'), adulto, sem).nivel).toBe('critico');
    expect(nivelDaAfericao(35, padrao('temperatura'), adulto, sem).nivel).toBe('critico');
    expect(nivelDaAfericao(39.5, padrao('temperatura'), adulto, sem).nivel).toBe('atencao');
    // Criança fica fora do padrão do adulto (vale a faixa do parâmetro).
    expect(nivelDaAfericao(25, padrao('fr'), { ...ctx, idadeDias: 1000 }, sem)).toEqual({
      nivel: 'normal',
      limite: null,
    });
  });
});
