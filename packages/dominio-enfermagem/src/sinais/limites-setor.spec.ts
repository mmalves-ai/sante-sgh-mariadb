import { describe, expect, it } from 'vitest';
import {
  classificarPeloLimite,
  conferirDetalheAfericao,
  escolherLimite,
  type LimiteParametro,
} from './limites-setor.js';

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

describe('limites de alerta por setor (03-PEP L115)', () => {
  it('o do setor ganha do estabelecimento e do cliente; inativo e de outro setor não valem', () => {
    const ls = [
      lim({ id: 1 }),
      lim({ id: 2, estabelecimento: 1 }),
      lim({ id: 3, estabelecimento: 1, setor: 7 }),
      lim({ id: 4, estabelecimento: 1, setor: 8 }),
      lim({ id: 5, estabelecimento: 1, setor: 7, sexo: 'feminino', ativo: false }),
    ];
    expect(escolherLimite(ls, ctx)?.id).toBe(3);
    expect(escolherLimite(ls, { ...ctx, setor: null })?.id).toBe(2);
    expect(escolherLimite([lim({ estabelecimento: 9 })], ctx)).toBeNull();
  });

  it('faixa etária mais estreita e instrumento informado ganham; sem idade só vale o limite sem faixa', () => {
    const ls = [
      lim({ id: 1, idadeMinimaDias: 0, idadeMaximaDias: 36_500 }),
      lim({ id: 2, idadeMinimaDias: 6_570, idadeMaximaDias: 21_900 }),
      lim({ id: 3, instrumento: 4 }),
    ];
    expect(escolherLimite(ls, ctx)?.id).toBe(2);
    expect(escolherLimite(ls, { ...ctx, instrumento: 4 })?.id).toBe(3);
    expect(escolherLimite(ls, { ...ctx, idadeDias: null })).toBeNull();
    expect(escolherLimite([lim({ id: 9 })], { ...ctx, idadeDias: null })?.id).toBe(9);
  });

  it('classifica crítico, atenção e normal pelas faixas', () => {
    const l = lim({});
    expect(classificarPeloLimite(30, l)).toBe('critico');
    expect(classificarPeloLimite(150, l)).toBe('critico');
    expect(classificarPeloLimite(55, l)).toBe('atencao');
    expect(classificarPeloLimite(80, l)).toBe('normal');
    expect(classificarPeloLimite(5, { ...l, limiteInferior: null })).toBe('atencao');
  });

  it('detalhe: local e posição exigidos pelo setor; não aferido só com motivo e complemento', () => {
    const base = {
      valor: 80,
      local: null,
      posicao: null,
      naoAferido: false,
      motivoNaoAfericao: null,
      justificativa: null,
    };
    expect(conferirDetalheAfericao(base, null)).toEqual([]);
    expect(
      conferirDetalheAfericao(base, { exigeLocal: true, exigePosicao: true }).map((e) => e.codigo),
    ).toEqual(['local-obrigatorio', 'posicao-obrigatoria']);
    const na = { ...base, valor: null, naoAferido: true };
    expect(conferirDetalheAfericao(na, null).map((e) => e.codigo)).toEqual(['motivo-obrigatorio']);
    expect(
      conferirDetalheAfericao({ ...na, motivoNaoAfericao: { id: 1, exigeComplemento: true } }, null).map(
        (e) => e.codigo,
      ),
    ).toEqual(['complemento-obrigatorio']);
    expect(
      conferirDetalheAfericao(
        {
          ...na,
          motivoNaoAfericao: { id: 1, exigeComplemento: true },
          justificativa: 'Paciente no centro cirúrgico',
        },
        { exigeLocal: true, exigePosicao: true },
      ),
    ).toEqual([]);
    expect(
      conferirDetalheAfericao(
        { ...na, valor: 3, motivoNaoAfericao: { id: 1, exigeComplemento: false } },
        null,
      )[0]?.codigo,
    ).toBe('nao-aferido-com-valor');
  });
});
