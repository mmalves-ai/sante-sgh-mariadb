// Regras 9 e 10 do M33: quem apura não aprova; aprovada não muda; uma apuração por período num só sistema.
import { describe, expect, it } from 'vitest';
import { podeApurarPeriodo, somaConfere, totalizar, transicaoApuracao, type Apuracao } from './apuracao.js';
import { calcularItem } from './calculo.js';
import { item, regra } from './fixtures.spec-util.js';

const a = (estado: Apuracao['estado']): Apuracao => ({ estado, apuradoPor: 'ana' });

describe('transicaoApuracao', () => {
  it('aberta → conferida → aprovada (outra pessoa) → titulada', () => {
    expect(transicaoApuracao(a('aberta'), 'recalcular', 'ana')).toEqual({ ok: true, estado: 'aberta' });
    expect(transicaoApuracao(a('aberta'), 'conferir', 'ana')).toEqual({ ok: true, estado: 'conferida' });
    expect(transicaoApuracao(a('conferida'), 'aprovar', 'bia')).toEqual({ ok: true, estado: 'aprovada' });
    expect(transicaoApuracao(a('aprovada'), 'titular', 'bia')).toEqual({ ok: true, estado: 'titulada' });
  });

  it('quem apurou não aprova; devolver volta a aberta', () => {
    expect(transicaoApuracao(a('conferida'), 'aprovar', 'ana')).toEqual({
      ok: false,
      motivo: 'Quem apurou não aprova.',
    });
    expect(transicaoApuracao(a('conferida'), 'devolver', 'bia')).toEqual({ ok: true, estado: 'aberta' });
  });

  it('aprovada não muda: nem recalcular, nem conferir, nem devolver', () => {
    for (const acao of ['recalcular', 'conferir', 'devolver', 'aprovar'] as const)
      expect(transicaoApuracao(a('aprovada'), acao, 'bia').ok).toBe(false);
    expect(transicaoApuracao(a('aberta'), 'titular', 'bia').ok).toBe(false);
  });
});

describe('podeApurarPeriodo', () => {
  it('recusa período apurado no outro sistema ou já aberto no novo', () => {
    expect(podeApurarPeriodo({ linhasDoLegadoNoPeriodo: 0, apuracaoNoNovo: false })).toEqual({ ok: true });
    expect(podeApurarPeriodo({ linhasDoLegadoNoPeriodo: 3, apuracaoNoNovo: false })).toEqual({
      ok: false,
      recusa: 'periodo-apurado-no-legado',
    });
    expect(podeApurarPeriodo({ linhasDoLegadoNoPeriodo: 0, apuracaoNoNovo: true })).toEqual({
      ok: false,
      recusa: 'periodo-ja-apurado',
    });
  });
});

describe('totalizar', () => {
  it('soma 37,00 + 50,00 = 87,00 por beneficiário, com a pendência contada à parte', () => {
    const o = { basePadrao: 'cobrado', modoAdicional: 'sobre-valor', feriados: new Set<string>() } as const;
    const rs = [regra({ id: 1, percentual: 18.5 })];
    const ms = [
      calcularItem(item({ id: 1, executante: 7 }), rs, o),
      calcularItem(item({ id: 2, executante: 8, cobrado: 270.27 }), rs, o),
      calcularItem(item({ id: 3, executante: null }), rs, o),
    ];
    const t = totalizar(ms);
    expect(t).toMatchObject({
      itens: 3,
      comRepasse: 2,
      pendentes: 1,
      baseCentavos: 47027,
      repasseCentavos: 8700,
    });
    expect(t.pendenciasPorMotivo).toEqual({ 'sem-executante': 1 });
    expect([...t.porBeneficiario]).toEqual([
      [7, 3700],
      [8, 5000],
    ]);
    expect(somaConfere([3700, 5000], ms)).toBe(true);
    expect(somaConfere([3700], ms)).toBe(false);
  });
});
