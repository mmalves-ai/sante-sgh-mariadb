import { describe, expect, it } from 'vitest';
import {
  baterComReinf,
  grupoReinf,
  montarDarf,
  parcelasPorReceita,
  periodoApuracao,
  receitaDoRecolhimento,
} from './apuracao-retido.js';

describe('apuração do retido e DARF (07-FIN linha 110)', () => {
  it('código de receita: o das retenções vence; diferentes ou divergentes recusam; senão o informado ou o do tributo', () => {
    expect(receitaDoRecolhimento([{ codigoReceita: '1708' }, { codigoReceita: null }], null, '0561')).toEqual(
      {
        codigo: '1708',
        recusa: null,
      },
    );
    expect(receitaDoRecolhimento([{ codigoReceita: null }], '5952', '1708').codigo).toBe('5952');
    expect(receitaDoRecolhimento([{ codigoReceita: null }], '  ', '1708').codigo).toBe('1708');
    expect(receitaDoRecolhimento([{ codigoReceita: null }], null, null)).toEqual({
      codigo: null,
      recusa: null,
    });
    expect(
      receitaDoRecolhimento([{ codigoReceita: '1708' }, { codigoReceita: '3280' }], null, null).recusa
        ?.codigo,
    ).toBe('receitas-distintas');
    expect(receitaDoRecolhimento([{ codigoReceita: '1708' }], '5952', null).recusa?.codigo).toBe(
      'receita-divergente',
    );
    expect(receitaDoRecolhimento([], '17A8', null).recusa?.codigo).toBe('receita-invalida');
  });

  it('período de apuração: último dia da competência, inclusive fevereiro bissexto', () => {
    expect(periodoApuracao('2026-10')).toBe('2026-10-31');
    expect(periodoApuracao('2028-02')).toBe('2028-02-29');
    expect(periodoApuracao('2026-11')).toBe('2026-11-30');
  });

  it('parcelas por código: item sem código usa o da apuração; a soma das parcelas é o total', () => {
    const r = parcelasPorReceita(
      [
        { codigoReceita: '5952', base: 1000, valor: 46.5 },
        { codigoReceita: null, base: 1000, valor: 15 },
        { codigoReceita: '1708', base: 333.33, valor: 5 },
      ],
      '1708',
    );
    expect(r.parcelas).toEqual([
      { codigoReceita: '1708', retencoes: 2, base: 1333.33, valor: 20 },
      { codigoReceita: '5952', retencoes: 1, base: 1000, valor: 46.5 },
    ]);
    expect([r.base, r.total]).toEqual([2333.33, 66.5]);
    expect(parcelasPorReceita([], '1708')).toEqual({ parcelas: [], base: 0, total: 0 });
  });

  it('DARF: campos 01 a 10 do modelo, total igual à soma; sem CNPJ, sem código ou sem valor não há DARF', () => {
    const guia = {
      razaoSocial: 'HOSPITAL SINTETICO',
      cnpj: '11222333000181',
      competencia: '2026-10',
      periodoApuracao: null,
      codigoReceita: '1708',
      referencia: null,
      vencimento: '2026-11-20',
      principal: 1234.5,
      multa: 10,
      juros: 0.55,
    };
    const { darf, recusa } = montarDarf(guia);
    expect(recusa).toBeNull();
    expect(darf?.campos.map((c) => c.numero)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
    ]);
    expect(Object.fromEntries((darf?.campos ?? []).map((c) => [c.numero, c.valor]))).toMatchObject({
      '02': '31/10/2026',
      '03': '11.222.333/0001-81',
      '04': '1708',
      '06': '20/11/2026',
      '07': '1.234,50',
      '10': '1.245,05',
    });
    expect(darf?.total).toBe(1245.05);
    expect(montarDarf({ ...guia, cnpj: null }).recusa?.codigo).toBe('sem-cnpj');
    expect(montarDarf({ ...guia, codigoReceita: null }).recusa?.codigo).toBe('receita-invalida');
    expect(montarDarf({ ...guia, principal: 0 }).recusa?.codigo).toBe('valor-invalido');
  });

  it('grupo da Reinf pela sigla do tributo', () => {
    expect(
      ['IRRF', 'L0207-IRRF', 'IR', 'PIS', 'COFINS', 'CSLL', 'CSRF', 'INSS', 'ISS'].map(grupoReinf),
    ).toEqual(['irrf', 'irrf', 'irrf', 'csrf', 'csrf', 'csrf', 'csrf', 'inss', null]);
  });

  it('batimento com a Reinf: confere por grupo, aponta a diferença e separa o tributo fora da Reinf', () => {
    const r = baterComReinf(
      [
        { sigla: 'IRRF', valor: 15 },
        { sigla: 'PIS', valor: 6.5 },
        { sigla: 'COFINS', valor: 30 },
        { sigla: 'CSLL', valor: 10 },
        { sigla: 'ISS', valor: 50 },
      ],
      { irrf: 15, csrf: 40, inss: 0 },
    );
    expect(r.linhas).toEqual([
      { grupo: 'irrf', apurado: 15, reinf: 15, diferenca: 0, confere: true },
      { grupo: 'csrf', apurado: 46.5, reinf: 40, diferenca: 6.5, confere: false },
    ]);
    expect(r.foraDaReinf).toEqual(['ISS']);
    expect(r.confere).toBe(false);
    expect(baterComReinf([], { irrf: 0, csrf: 0, inss: 0 })).toEqual({
      linhas: [],
      foraDaReinf: [],
      confere: true,
    });
  });
});
