// Regra 7 do M33: retenções do RPA com as parcelas escritas no teste. Tabelas sintéticas (as vigentes vêm dos
// parâmetros; nada aqui é a tabela oficial).
import { describe, expect, it } from 'vitest';
import { calcularRpa, lerAliquota, lerTabelaIrrf, type ParametrosRpa } from './rpa.js';

const tabela = lerTabelaIrrf('2000:0:0;3000:10:200;0:20:500');
if (!tabela.ok) throw new Error('tabela sintética inválida');
const p: ParametrosRpa = {
  inssAliquota: 11,
  inssTetoCentavos: 500000,
  irrf: tabela.valor,
  issAliquota: 5,
  reterInss: true,
  reterIrrf: true,
  reterIss: true,
};

describe('lerTabelaIrrf e lerAliquota', () => {
  it('lê faixas em ordem, a última sem limite', () => {
    expect(tabela.ok && tabela.valor).toEqual([
      { ateCentavos: 200000, aliquota: 0, deducaoCentavos: 0 },
      { ateCentavos: 300000, aliquota: 10, deducaoCentavos: 20000 },
      { ateCentavos: null, aliquota: 20, deducaoCentavos: 50000 },
    ]);
  });

  it('recusa vazia, fora de ordem, sem última aberta ou com número inválido', () => {
    expect(lerTabelaIrrf(' ').ok).toBe(false);
    expect(lerTabelaIrrf('3000:0:0;2000:10:1;0:20:5').ok).toBe(false);
    expect(lerTabelaIrrf('2000:0:0;3000:10:1').ok).toBe(false);
    expect(lerTabelaIrrf('0:0:0;3000:10:1').ok).toBe(false);
    expect(lerTabelaIrrf('2000:x:0;0:10:1').ok).toBe(false);
    expect(lerTabelaIrrf('2000:0;0:10:1').ok).toBe(false);
  });

  it('alíquota: número entre 0 e 100; vazio é "não definida"', () => {
    expect(lerAliquota('5.5', 'ISS')).toEqual({ ok: true, valor: 5.5 });
    expect(lerAliquota('', 'ISS')).toEqual({ ok: false, motivo: 'ISS vigente não definida.' });
    expect(lerAliquota('120', 'ISS').ok).toBe(false);
  });
});

describe('calcularRpa', () => {
  it('bruto 4.000,00: INSS 440,00; IRRF (3.560,00 × 20% − 500,00) 212,00; ISS 200,00; líquido 3.148,00', () => {
    const r = calcularRpa({ brutoCentavos: 400000, baseInssOutrasEmpresasCentavos: 0 }, p);
    expect(r).toEqual({
      brutoCentavos: 400000,
      baseInssCentavos: 400000,
      inssCentavos: 44000,
      baseIrrfCentavos: 356000,
      faixaIrrf: 2,
      irrfCentavos: 21200,
      issCentavos: 20000,
      liquidoCentavos: 314800,
    });
    expect(r.brutoCentavos - r.inssCentavos - r.irrfCentavos - r.issCentavos).toBe(r.liquidoCentavos);
  });

  it('acúmulo entre empresas: teto 5.000,00 com 4.500,00 já usados → base de INSS 500,00, INSS 55,00', () => {
    const r = calcularRpa({ brutoCentavos: 200000, baseInssOutrasEmpresasCentavos: 450000 }, p);
    expect(r.baseInssCentavos).toBe(50000);
    expect(r.inssCentavos).toBe(5500);
    expect(r.baseIrrfCentavos).toBe(194500);
    expect(r.irrfCentavos).toBe(0);
    expect(r.faixaIrrf).toBe(0);
  });

  it('teto já usado nas outras empresas: INSS 0', () => {
    const r = calcularRpa({ brutoCentavos: 100000, baseInssOutrasEmpresasCentavos: 600000 }, p);
    expect(r.inssCentavos).toBe(0);
  });

  it('evento sem retenções: líquido = bruto', () => {
    const r = calcularRpa(
      { brutoCentavos: 100000, baseInssOutrasEmpresasCentavos: 0 },
      { ...p, reterInss: false, reterIrrf: false, reterIss: false },
    );
    expect(r).toMatchObject({
      inssCentavos: 0,
      irrfCentavos: 0,
      issCentavos: 0,
      faixaIrrf: null,
      liquidoCentavos: 100000,
    });
  });

  it('tabela do IRRF vazia com retenção ligada é erro de configuração', () => {
    expect(() =>
      calcularRpa({ brutoCentavos: 1, baseInssOutrasEmpresasCentavos: 0 }, { ...p, irrf: [] }),
    ).toThrow(RangeError);
  });
});
