import { describe, expect, it } from 'vitest';
import {
  conferirTrocaNiveis,
  encerrarAlcada,
  type LinhaNivelAlcada,
  niveisIguais,
  planejarVigencia,
  quantidadeNiveis,
  validarAlcada,
  vespera,
} from './alcada-aprovacao.js';

const nivel = (n: number, max: number | null, extra: Partial<LinhaNivelAlcada> = {}): LinhaNivelAlcada => ({
  nivel: n,
  perfil: 'GESTOR',
  usuario: null,
  valorMinimo: 0,
  valorMaximo: max,
  valorAcumuladoMaximo: null,
  periodoAcumulado: null,
  ...extra,
});
const regra = (niveis: LinhaNivelAlcada[], extra = {}) => ({
  descricao: 'COMPRAS',
  vigenciaInicio: '2026-11-01',
  vigenciaFim: null,
  niveis,
  ...extra,
});

describe('alçada de aprovação', () => {
  it('aceita a escada de níveis com o último sem teto e conta os níveis', () => {
    const ns = [
      nivel(1, 1000),
      nivel(2, 5000),
      nivel(2, 5000, { perfil: null, usuario: 'ANA' }),
      nivel(3, null),
    ];
    expect(validarAlcada(regra(ns))).toBeNull();
    expect(quantidadeNiveis(ns)).toBe(3);
  });

  it('recusa nome vazio, sem níveis, buraco na numeração e vigência invertida', () => {
    expect(validarAlcada(regra([nivel(1, null)], { descricao: ' ' }))).toBe('descricao-obrigatoria');
    expect(validarAlcada(regra([]))).toBe('sem-niveis');
    expect(validarAlcada(regra([nivel(1, 10), nivel(3, null)]))).toBe('nivel-com-buraco');
    expect(validarAlcada(regra([nivel(1, null)], { vigenciaFim: '2026-10-01' }))).toBe('vigencia-invalida');
    expect(validarAlcada(regra(Array.from({ length: 21 }, (_, i) => nivel(i + 1, i + 1))))).toBe(
      'niveis-demais',
    );
  });

  it('recusa aprovador duplo ou ausente, faixa invertida, teto decrescente e nível sem teto no meio', () => {
    expect(validarAlcada(regra([nivel(1, null, { usuario: 'ANA' })]))).toBe('aprovador-unico');
    expect(validarAlcada(regra([nivel(1, null, { perfil: null })]))).toBe('aprovador-unico');
    expect(validarAlcada(regra([nivel(1, 10, { valorMinimo: 20 })]))).toBe('faixa-invalida');
    expect(validarAlcada(regra([nivel(1, 5000), nivel(2, 1000)]))).toBe('teto-decrescente');
    expect(validarAlcada(regra([nivel(1, null), nivel(2, 1000)]))).toBe('nivel-sem-teto-no-meio');
  });

  it('teto acumulado e período andam juntos', () => {
    expect(validarAlcada(regra([nivel(1, null, { valorAcumuladoMaximo: 100 })]))).toBe(
      'acumulado-sem-periodo',
    );
    expect(validarAlcada(regra([nivel(1, null, { periodoAcumulado: 'mes' })]))).toBe('acumulado-sem-periodo');
    expect(
      validarAlcada(regra([nivel(1, null, { valorAcumuladoMaximo: 100, periodoAcumulado: 'mes' })])),
    ).toBeNull();
  });

  it('vigência nova encerra a aberta anterior na véspera; outra sobreposição recusa', () => {
    expect(vespera('2026-03-01')).toBe('2026-02-28');
    expect(planejarVigencia({ inicio: '2026-12-01', fim: null }, [])).toEqual({
      recusa: null,
      encerrar: null,
    });
    expect(
      planejarVigencia({ inicio: '2026-12-01', fim: null }, [{ id: 7, inicio: '2026-01-01', fim: null }]),
    ).toEqual({ recusa: null, encerrar: { id: 7, fim: '2026-11-30' } });
    expect(
      planejarVigencia({ inicio: '2026-12-01', fim: null }, [
        { id: 7, inicio: '2026-01-01', fim: '2026-06-30' },
      ]),
    ).toEqual({ recusa: null, encerrar: null });
    expect(
      planejarVigencia({ inicio: '2026-01-01', fim: '2026-03-01' }, [
        { id: 7, inicio: '2026-02-01', fim: null },
      ]),
    ).toEqual({ recusa: 'vigencia-sobreposta' });
    // A nova no meio da anterior aberta deixaria um buraco no fim: recusa.
    expect(
      planejarVigencia({ inicio: '2026-06-01', fim: '2026-07-01' }, [
        { id: 7, inicio: '2026-01-01', fim: null },
      ]),
    ).toEqual({ recusa: 'vigencia-sobreposta' });
    expect(
      planejarVigencia({ inicio: '2026-12-01', fim: null }, [
        { id: 7, inicio: '2026-01-01', fim: null },
        { id: 8, inicio: '2027-01-01', fim: null },
      ]),
    ).toEqual({ recusa: 'vigencia-sobreposta' });
  });

  it('regra usada em pedido não troca níveis; encerramento fecha ou desativa', () => {
    const a = [nivel(1, 10), nivel(2, null)];
    expect(niveisIguais(a, [...a].reverse())).toBe(true);
    expect(niveisIguais(a, [nivel(1, 20), nivel(2, null)])).toBe(false);
    expect(conferirTrocaNiveis(3, true)).toBe('regra-em-uso');
    expect(conferirTrocaNiveis(3, false)).toBeNull();
    expect(conferirTrocaNiveis(0, true)).toBeNull();
    expect(encerrarAlcada({ inicio: '2026-01-01', fim: null }, '2026-11-25', null)).toEqual({
      recusa: null,
      acao: 'fechar',
      fim: '2026-11-25',
    });
    expect(encerrarAlcada({ inicio: '2026-12-01', fim: null }, '2026-11-25', null)).toEqual({
      recusa: null,
      acao: 'desativar',
    });
    expect(encerrarAlcada({ inicio: '2026-01-01', fim: '2026-06-30' }, '2026-11-25', '2026-07-10')).toEqual({
      recusa: 'encerramento-invalido',
    });
  });
});
