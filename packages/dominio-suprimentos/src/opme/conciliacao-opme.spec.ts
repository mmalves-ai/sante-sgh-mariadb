// Ficha do M46, etapa 3 (regra 9, teste `conciliacao-opme.spec.ts`): cada consumo de OPME contra os itens da conta do
// mesmo paciente e item; o indicador "OPME usado sem cobrança" com o numerador e o denominador impressos. E a leitura do
// código GS1 da embalagem (o rastreio por lote ou série vem do leitor).
import { describe, expect, it } from 'vitest';
import { conciliarOpme, lerCodigoEmbalagem } from '../index.js';

describe('conciliação do OPME com a conta (regra 9)', () => {
  it('conciliado, sem cobrança, a menos, a mais e devolvido; o indicador com numerador e denominador', () => {
    const r = conciliarOpme(
      [
        { id: 1, conta: 100, item: 900, quantidade: 1, devolvida: 0 },
        { id: 2, conta: 100, item: 901, quantidade: 2, devolvida: 0 },
        { id: 3, conta: 200, item: 900, quantidade: 3, devolvida: 0 },
        { id: 4, conta: 300, item: 900, quantidade: 1, devolvida: 0 },
        { id: 5, conta: 400, item: 900, quantidade: 1, devolvida: 1 },
      ],
      [
        { conta: 100, item: 900, quantidade: 1 },
        { conta: 200, item: 900, quantidade: 2 },
        { conta: 300, item: 900, quantidade: 1 },
        { conta: 300, item: 900, quantidade: 1 },
        { conta: 999, item: 900, quantidade: 5 },
      ],
    );
    expect(r.linhas.map((l) => [l.id, l.situacao, l.usada, l.naConta])).toEqual([
      [1, 'conciliado', 1, 1],
      [2, 'sem-cobranca', 2, 0],
      [3, 'cobranca-menor', 3, 2],
      [4, 'cobranca-maior', 1, 2],
      [5, 'devolvido', 0, 0],
    ]);
    // Numerador: 1 consumo sem nada na conta; denominador: 4 consumos com uso (o devolvido não conta).
    expect(r.indicador).toEqual({ numerador: 1, denominador: 4, percentual: 25 });
  });
  it('dois consumos do mesmo item na mesma conta dividem o lançado na ordem', () => {
    const r = conciliarOpme(
      [
        { id: 8, conta: 100, item: 900, quantidade: 1, devolvida: 0 },
        { id: 7, conta: 100, item: 900, quantidade: 1, devolvida: 0 },
      ],
      [{ conta: 100, item: 900, quantidade: 1 }],
    );
    // O mais antigo (7) leva o lançado; o 8 fica sem cobrança. A ordem das linhas é a da entrada.
    expect(r.linhas.map((l) => [l.id, l.situacao])).toEqual([
      [8, 'sem-cobranca'],
      [7, 'conciliado'],
    ]);
    expect(r.indicador).toEqual({ numerador: 1, denominador: 2, percentual: 50 });
  });
  it('sem consumo, o percentual é nulo', () => {
    expect(conciliarOpme([], [{ conta: 1, item: 1, quantidade: 1 }]).indicador).toEqual({
      numerador: 0,
      denominador: 0,
      percentual: null,
    });
  });
});

describe('leitura do código da embalagem (GS1)', () => {
  const GS = '\u001d';
  it('com parênteses: GTIN, validade, lote e série', () => {
    expect(lerCodigoEmbalagem('(01)07891234567895(17)280131(10)L-77(21)SN123')).toEqual({
      gtin: '07891234567895',
      lote: 'L-77',
      serie: 'SN123',
      validade: '2028-01-31',
    });
  });
  it('cru, com o separador GS e o prefixo do leitor; o dia 00 vira o último do mês', () => {
    expect(lerCodigoEmbalagem(`]d2010789123456789517280200` + `10ABC${GS}21XYZ`)).toEqual({
      gtin: '07891234567895',
      lote: 'ABC',
      serie: 'XYZ',
      validade: '2028-02-29',
    });
    expect(lerCodigoEmbalagem(`${GS}0107891234567895` + `21S1`)).toEqual({
      gtin: '07891234567895',
      lote: null,
      serie: 'S1',
      validade: null,
    });
  });
  it('o que não é GS1 volta vazio; mês inválido não vira validade; GTIN malformado fica nulo', () => {
    const vazio = { gtin: null, lote: null, serie: null, validade: null };
    expect(lerCodigoEmbalagem('')).toEqual(vazio);
    expect(lerCodigoEmbalagem('ABC-QUALQUER')).toEqual(vazio);
    expect(lerCodigoEmbalagem('(17)281301(10)L1').validade).toBeNull();
    expect(lerCodigoEmbalagem('(01)123(10)L1')).toEqual({
      gtin: null,
      lote: 'L1',
      serie: null,
      validade: null,
    });
    expect(lerCodigoEmbalagem('(17)2801AA(10)L1').validade).toBeNull();
  });
});
