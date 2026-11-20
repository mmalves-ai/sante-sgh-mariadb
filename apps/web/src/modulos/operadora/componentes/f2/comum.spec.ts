// M56.3 (correção da revisão): a ficha da baixa recalcula o devido na data escolhida e com a dispensa, pela mesma regra
// do servidor (o pagamento lançado depois, com data passada, e a dispensa da multa e dos juros).
import { problemasDaBaixaCobranca } from '@sgh/dominio-operadora';
import { describe, expect, it } from 'vitest';
import { devidoDaBaixa, valorDoCampo } from './comum';

describe('devido da baixa na data (M56.3)', () => {
  it('até o vencimento, só o valor; depois, multa e juros pro rata da data escolhida', () => {
    expect(devidoDaBaixa(270, '2026-11-10', '2026-11-10', false)).toMatchObject({
      multa: 0,
      juros: 0,
      devido: 270,
    });
    expect(devidoDaBaixa(270, '2026-11-10', '2026-11-25', false)).toMatchObject({
      multa: 5.4,
      juros: 1.35,
      devido: 276.75,
    });
    // A mesma cobrança paga em outra data passada: o devido muda com os dias.
    expect(devidoDaBaixa(270, '2026-11-10', '2026-12-10', false).devido).toBe(278.1);
  });

  it('com a dispensa, só o valor (e os encargos da data continuam visíveis como o que se dispensa)', () => {
    expect(devidoDaBaixa(270, '2026-11-10', '2026-11-25', true)).toEqual({
      multa: 0,
      juros: 0,
      devido: 270,
      calculados: { multa: 5.4, juros: 1.35, total: 6.75 },
    });
  });

  it('sem data válida, só o valor', () => {
    expect(devidoDaBaixa(270, '2026-11-10', null, false).devido).toBe(270);
    expect(devidoDaBaixa(270, '2026-11-10', '25/11', false).devido).toBe(270);
  });

  it('o valor que a tela preenche é o que o servidor aceita (data passada e dispensa)', () => {
    for (const [pagoEm, dispensar] of [
      ['2026-11-25', false],
      ['2026-12-31', false],
      ['2026-11-10', false],
      ['2026-11-25', true],
    ] as const) {
      const d = devidoDaBaixa(320.73, '2026-11-10', pagoEm, dispensar);
      const r = problemasDaBaixaCobranca({
        situacao: 'aberta',
        valor: 320.73,
        vencimento: '2026-11-10',
        emitidaEm: '2026-10-01',
        hoje: '2027-01-15',
        pagoEm,
        valorPago: Number(valorDoCampo(d.devido).replace(',', '.')),
        dispensarEncargos: dispensar,
        motivoDispensa: dispensar ? 'Acordo comercial sintético' : null,
      });
      expect(r.problemas).toEqual([]);
    }
  });

  it('o campo usa a vírgula e não leva o ponto do milhar', () => {
    expect(valorDoCampo(1234.5)).toBe('1234,50');
  });
});
