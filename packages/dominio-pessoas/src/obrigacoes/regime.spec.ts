// M53-F7 (regra 7): o regime das obrigações vem dos parâmetros gravados com vigência, nunca de constante. Sintéticos.
import { REGIMES_SUGERIDOS_OBRIGACOES } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { parametros } from './fixtures-obrigacoes.spec-util.js';
import {
  competenciaDoPeriodo,
  competenciasDaObrigacao,
  conferirParametrosObrigacoes,
  fimDaCompetenciaObrigacao,
  obrigacaoExigida,
  parametrosObrigacoesNa,
  pendenciaObrigacao,
  periodoEncerrado,
} from './regime.js';

const R = REGIMES_SUGERIDOS_OBRIGACOES;

describe('obrigação exigida no período (sugestão das fontes)', () => {
  it('FGTS Digital a partir de 03/2024 e SEFIP até 02/2024: nunca os dois na mesma competência', () => {
    for (const c of ['2024-01', '2024-02', '2024-03', '2026-09']) {
      const fgts = obrigacaoExigida(R['fgts-digital'], 'fgts-digital', c);
      const sefip = obrigacaoExigida(R.sefip, 'sefip', c);
      expect(fgts).toBe(!sefip);
    }
    expect(obrigacaoExigida(R.sefip, 'sefip', '2024-02')).toBe(true);
    expect(obrigacaoExigida(R['fgts-digital'], 'fgts-digital', '2024-03')).toBe(true);
  });

  it('CAGED até 12/2019 e RAIS até o ano-base 2018', () => {
    expect(obrigacaoExigida(R.caged, 'caged', '2019-12')).toBe(true);
    expect(obrigacaoExigida(R.caged, 'caged', '2020-01')).toBe(false);
    expect(obrigacaoExigida(R.rais, 'rais', '2018')).toBe(true);
    expect(obrigacaoExigida(R.rais, 'rais', '2019')).toBe(false);
  });

  it('limite AAAA num mensal vale pelo ano; AAAA-MM num anual vale pelo ano dele', () => {
    const r = { exigidaDe: '2019', exigidaAte: '2020', leiaute: 'x', leiauteConferido: true };
    expect(obrigacaoExigida(r, 'caged', '2019-01')).toBe(true);
    expect(obrigacaoExigida(r, 'caged', '2020-12')).toBe(true);
    expect(obrigacaoExigida(r, 'caged', '2018-12')).toBe(false);
    expect(obrigacaoExigida(r, 'caged', '2021-01')).toBe(false);
    const m = { exigidaDe: '2015-06', exigidaAte: '2017-02', leiaute: 'x', leiauteConferido: true };
    expect(obrigacaoExigida(m, 'rais', '2015')).toBe(true);
    expect(obrigacaoExigida(m, 'rais', '2017')).toBe(true);
    expect(obrigacaoExigida(m, 'rais', '2014')).toBe(false);
    expect(obrigacaoExigida({ ...m, exigidaDe: null, exigidaAte: null }, 'rais', '1990')).toBe(true);
  });
});

describe('vigência dos parâmetros e períodos', () => {
  it('a vigência mais recente que já começou, da empresa', () => {
    const vs = [
      { ...parametros, inicio: '2010-01' },
      { ...parametros, inicio: '2015-01' },
      { ...parametros, empresa: 2, inicio: '2016-01' },
    ];
    expect(parametrosObrigacoesNa(vs, 1, '2016-06')?.inicio).toBe('2015-01');
    expect(parametrosObrigacoesNa(vs, 1, '2012-06')?.inicio).toBe('2010-01');
    expect(parametrosObrigacoesNa(vs, 1, '2009-12')).toBeNull();
  });

  it('competências do período, fim do mês e período encerrado', () => {
    expect(competenciasDaObrigacao('sefip', '2019-02')).toEqual(['2019-02']);
    expect(competenciasDaObrigacao('rais', '2018')).toHaveLength(12);
    expect(competenciasDaObrigacao('rais', '2018')[11]).toBe('2018-12');
    expect(competenciaDoPeriodo('rais', '2018')).toBe('2018-12');
    expect(competenciaDoPeriodo('caged', '2018-05')).toBe('2018-05');
    expect(fimDaCompetenciaObrigacao('2020-02')).toBe('2020-02-29');
    expect(periodoEncerrado('caged', '2026-10', '2026-10-28')).toBe(false);
    expect(periodoEncerrado('caged', '2026-09', '2026-10-01')).toBe(true);
    expect(periodoEncerrado('rais', '2026', '2026-12-31')).toBe(false);
  });

  it('confere o formato dos limites do ano-base e ordena os vínculos da pendência', () => {
    expect(conferirParametrosObrigacoes(parametros)).toEqual([]);
    const errado = {
      ...parametros,
      regimes: { ...parametros.regimes, rais: { ...R.rais, exigidaAte: '2018-12' } },
    };
    expect(conferirParametrosObrigacoes(errado)).toEqual(['rais: o ano-base vai como AAAA.']);
    expect(pendenciaObrigacao('sem-nis', 'x', [9, 3]).vinculos).toEqual([3, 9]);
    expect(pendenciaObrigacao('sem-parametros', 'x').vinculos).toEqual([]);
  });
});
