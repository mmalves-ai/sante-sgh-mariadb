import { describe, expect, it } from 'vitest';
import {
  baterComReinf,
  grupoReinf,
  montarDarf,
  parcelasPorReceita,
  periodoApuracao,
  gruposDoRecolhimento,
  situacaoDoRecolhimento,
  tipoGuiaDaEsfera,
} from './apuracao-retido.js';

describe('apuração do retido e DARF (07-FIN linha 110)', () => {
  it('guias por código de receita: sem código herda o do tributo ou o informado; o informado escolhe um código', () => {
    const ret = [
      { codigoReceita: '1708' },
      { codigoReceita: null },
      { codigoReceita: '3280' },
      { codigoReceita: '1708' },
    ];
    expect(gruposDoRecolhimento(ret, null, '1708', 'federal')).toEqual({
      grupos: [
        { codigo: '1708', indices: [0, 1, 3] },
        { codigo: '3280', indices: [2] },
      ],
      recusa: null,
    });
    // Sem código no tributo, a retenção sem código recebe o informado, que escolhe só o grupo dele.
    expect(gruposDoRecolhimento(ret, ' 1708 ', null, 'federal').grupos).toEqual([
      { codigo: '1708', indices: [0, 1, 3] },
    ]);
    expect(gruposDoRecolhimento(ret, '3280', '0588', 'federal').grupos).toEqual([
      { codigo: '3280', indices: [2] },
    ]);
    expect(gruposDoRecolhimento(ret, null, null, 'federal').recusa?.codigo).toBe('sem-codigo-receita');
    expect(gruposDoRecolhimento(ret, '5952', '1708', 'federal').recusa?.codigo).toBe('sem-retido-no-codigo');
    expect(gruposDoRecolhimento([], null, '1708', 'federal').recusa?.codigo).toBe('sem-retido');
    expect(gruposDoRecolhimento([{ codigoReceita: null }], null, '17A8', 'federal').recusa?.codigo).toBe(
      'receita-invalida',
    );
  });

  it('esfera: ISS municipal vai na guia do município, sem a regra dos quatro dígitos do DARF', () => {
    expect([
      tipoGuiaDaEsfera('federal'),
      tipoGuiaDaEsfera('Estadual'),
      tipoGuiaDaEsfera('municipal'),
    ]).toEqual(['darf', 'dae', 'guia_municipal']);
    expect(gruposDoRecolhimento([{ codigoReceita: null }], null, '1401-ISS', 'municipal')).toEqual({
      grupos: [{ codigo: '1401-ISS', indices: [0] }],
      recusa: null,
    });
  });

  it('situação da guia e da apuração acompanha o título: emitida/fechada, paga/recolhida, cancelada', () => {
    const t = { excluido: false, cancelado: false, quitado: false, dataPagamento: null };
    expect(situacaoDoRecolhimento(t)).toEqual({ guia: 'emitida', apuracao: 'fechada', dataPagamento: null });
    expect(situacaoDoRecolhimento({ ...t, quitado: true, dataPagamento: '2026-09-20' })).toEqual({
      guia: 'paga',
      apuracao: 'recolhida',
      dataPagamento: '2026-09-20',
    });
    expect(situacaoDoRecolhimento({ ...t, excluido: true }).guia).toBe('cancelada');
    expect(
      situacaoDoRecolhimento({ ...t, cancelado: true, quitado: true, dataPagamento: '2026-09-20' }),
    ).toEqual({
      guia: 'cancelada',
      apuracao: 'cancelada',
      dataPagamento: null,
    });
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
