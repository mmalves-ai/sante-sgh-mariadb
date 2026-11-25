import { describe, expect, it } from 'vitest';
import {
  conferirAlcadaFaturamento,
  conferirPreferenciasFaturista,
  conferirValorParametroFaturamento,
  limiteFechamentoCompetencia,
  normalizarParametrosFaturamento,
  normalizarPreferenciasFaturista,
  prazoRecursoGlosa,
  rotinaDiariaNaHora,
} from './parametros-faturamento.js';

const niveis = [
  { id: 1, nivel: 1, perfilId: 10, usuarioId: null, valorMinimo: 0, valorMaximo: 1000 },
  { id: 2, nivel: 2, perfilId: 20, usuarioId: null, valorMinimo: 0, valorMaximo: null },
];

describe('parâmetros do faturamento', () => {
  it('sem valor gravado vale o padrão; valor fora da faixa também cai no padrão', () => {
    expect(normalizarParametrosFaturamento({})).toEqual({
      rotinaDiaria: true,
      rotinaDiariaHora: 0,
      prazoRecursoGlosaDias: 30,
      fechamentoDiaLimite: 5,
    });
    const p = normalizarParametrosFaturamento({
      'faturamento.rotinaDiaria': 'false',
      'faturamento.rotinaDiariaHora': '6',
      'faturamento.prazoRecursoGlosaDias': '999',
      'faturamento.fechamentoDiaLimite': '10',
    });
    expect(p).toEqual({
      rotinaDiaria: false,
      rotinaDiariaHora: 6,
      prazoRecursoGlosaDias: 30,
      fechamentoDiaLimite: 10,
    });
  });

  it('confere tipo e faixa', () => {
    expect(conferirValorParametroFaturamento('faturamento.rotinaDiaria', 'sim')).toBe('Use sim ou não.');
    expect(conferirValorParametroFaturamento('faturamento.rotinaDiariaHora', '24')).toBe(
      'Use um valor de 0 a 23.',
    );
    expect(conferirValorParametroFaturamento('faturamento.prazoRecursoGlosaDias', '1,5')).toBe(
      'Informe um número inteiro.',
    );
    expect(conferirValorParametroFaturamento('faturamento.preferencia.telaInicial', 'glosas')).toBeNull();
    expect(conferirValorParametroFaturamento('faturamento.outro', '1')).toBe(
      'Parâmetro do faturamento desconhecido.',
    );
  });

  it('rotina diária: ligada e na hora de início', () => {
    const p = normalizarParametrosFaturamento({ 'faturamento.rotinaDiariaHora': '6' });
    expect(rotinaDiariaNaHora(p, 5)).toBe(false);
    expect(rotinaDiariaNaHora(p, 6)).toBe(true);
    expect(rotinaDiariaNaHora({ ...p, rotinaDiaria: false }, 12)).toBe(false);
  });

  it('prazo do recurso e limite do fechamento', () => {
    const p = normalizarParametrosFaturamento({ 'faturamento.prazoRecursoGlosaDias': '45' });
    expect(prazoRecursoGlosa('2026-11-20', p)).toBe('2027-01-04');
    expect(limiteFechamentoCompetencia('2026-12', p)).toBe('2027-01-05');
    expect(limiteFechamentoCompetencia('2026-10', p)).toBe('2026-11-05');
  });
});

describe('preferências do faturista', () => {
  it('só chaves de preferência, no tipo certo', () => {
    expect(conferirPreferenciasFaturista({})).toEqual([
      { campo: 'preferencias', mensagem: 'Nenhuma preferência informada.' },
    ]);
    expect(
      conferirPreferenciasFaturista({
        'faturamento.rotinaDiaria': 'false',
        'faturamento.preferencia.itensPorPagina': '5',
        'faturamento.preferencia.telaInicial': 'guias',
      }).map((e) => e.campo),
    ).toEqual(['faturamento.rotinaDiaria', 'faturamento.preferencia.itensPorPagina']);
    expect(normalizarPreferenciasFaturista({ 'faturamento.preferencia.telaInicial': 'guias' })).toEqual({
      telaInicial: 'guias',
      itensPorPagina: 50,
      agruparPorPaciente: true,
    });
  });
});

describe('alçada do faturamento', () => {
  it('quem pede não aprova, mesmo com alçada', () => {
    const r = conferirAlcadaFaturamento({
      valor: 10,
      solicitante: 7,
      decisor: 7,
      perfisDoDecisor: [20],
      niveis,
    });
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/Quem pede não aprova/);
  });
  it('faixa por valor e cargo', () => {
    expect(
      conferirAlcadaFaturamento({ valor: 500, solicitante: 1, decisor: 2, perfisDoDecisor: [10], niveis }),
    ).toEqual({ pode: true, nivel: 1, motivo: null });
    const acima = conferirAlcadaFaturamento({
      valor: 5000,
      solicitante: 1,
      decisor: 2,
      perfisDoDecisor: [10],
      niveis,
    });
    expect(acima.pode).toBe(false);
    expect(acima.motivo).toMatch(/passa a sua alçada/);
    expect(
      conferirAlcadaFaturamento({ valor: 5000, solicitante: 1, decisor: 3, perfisDoDecisor: [20], niveis })
        .nivel,
    ).toBe(2);
    expect(
      conferirAlcadaFaturamento({ valor: 1, solicitante: 1, decisor: 4, perfisDoDecisor: [99], niveis }).pode,
    ).toBe(false);
  });
  it('sem alçada cadastrada ninguém aprova; sem decisor, recusa', () => {
    expect(
      conferirAlcadaFaturamento({ valor: 1, solicitante: 1, decisor: 2, perfisDoDecisor: [], niveis: [] })
        .motivo,
    ).toMatch(/Não há alçada/);
    expect(
      conferirAlcadaFaturamento({ valor: 1, solicitante: 1, decisor: null, perfisDoDecisor: [], niveis })
        .pode,
    ).toBe(false);
  });
});
