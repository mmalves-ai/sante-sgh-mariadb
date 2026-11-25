import { describe, expect, it } from 'vitest';
import { destinoDoPagamento, parametrosDoProfissional } from './fiscal-profissional.js';
import { calcularRpa, type ParametrosRpa } from './rpa.js';

const geral: ParametrosRpa = {
  inssAliquota: 11,
  inssTetoCentavos: 800_000,
  irrf: [{ ateCentavos: null, aliquota: 0, deducaoCentavos: 0 }],
  issAliquota: 5,
  reterIss: true,
  reterInss: true,
  reterIrrf: true,
};
const fiscal = {
  tipoRecebedor: 'pessoa_fisica',
  aliquotaIss: 2,
  percentualInss: 20,
  retemIss: true,
  retemInss: true,
  retemIrrf: true,
};

describe('parametrosDoProfissional', () => {
  it('sem dado fiscal vale a regra geral', () => {
    expect(parametrosDoProfissional(geral, null)).toEqual({
      ok: true,
      parametros: geral,
      origem: 'regra-geral',
    });
  });

  it('o dado fiscal decide o que é retido e as alíquotas; teto e IRRF continuam os gerais', () => {
    const r = parametrosDoProfissional(geral, { ...fiscal, retemIss: false });
    expect(r).toEqual({
      ok: true,
      origem: 'dado-fiscal',
      parametros: { ...geral, reterIss: false, issAliquota: 2, inssAliquota: 20 },
    });
    if (!r.ok) throw new Error('recusado');
    // Bruto 1.000,00: INSS 20% = 200,00; ISS não retido; líquido 800,00.
    expect(
      calcularRpa({ brutoCentavos: 100_000, baseInssOutrasEmpresasCentavos: 0 }, r.parametros),
    ).toMatchObject({
      inssCentavos: 20_000,
      issCentavos: 0,
      liquidoCentavos: 80_000,
    });
  });

  it('alíquota não informada ou fora de 0 a 100 fica com a geral', () => {
    const r = parametrosDoProfissional(geral, { ...fiscal, aliquotaIss: null, percentualInss: 140 });
    expect(r.ok && r.parametros.issAliquota).toBe(5);
    expect(r.ok && r.parametros.inssAliquota).toBe(11);
  });

  it('quem recebe por empresa no dia não tem RPA', () => {
    expect(parametrosDoProfissional(geral, { ...fiscal, tipoRecebedor: 'pessoa_juridica' })).toMatchObject({
      ok: false,
      codigo: 'recebe-por-empresa',
    });
  });
});

describe('destinoDoPagamento', () => {
  it('mascara a conta e mostra só o tipo da chave', () => {
    expect(destinoDoPagamento(null)).toBeNull();
    expect(
      destinoDoPagamento({
        bancoDescricao: '001 · Banco',
        agencia: '1234',
        numeroConta: '98765-4',
        tipoChavePix: null,
      }),
    ).toBe('001 · Banco · ag. 1234 · conta final 54');
    expect(
      destinoDoPagamento({ bancoDescricao: null, agencia: null, numeroConta: null, tipoChavePix: 'email' }),
    ).toBe('chave de pagamento instantâneo (email)');
  });
});
