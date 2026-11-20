// Regra 2: regra versionada por origem; reprocessar dá o mesmo resultado. Regra 6: o mesmo de-para da exportação.
import { describe, expect, it } from 'vitest';
import { chaveDePara, itensSemConta, resolverDePara, type ItemDePara } from './depara.js';
import { fato, PLANO, regra } from './fixtures.spec-util.js';
import {
  chaveDoLancamento,
  condicoesValem,
  contabilizar,
  conteudoCanonicoRegra,
  montarHistorico,
  problemasDaPublicacao,
  regraDoFato,
  type ContextoAplicacao,
} from './regra.js';
import { compararReprocessamento } from './reprocessamento.js';

const dePara = new Map<string, ItemDePara>([
  ['5', { chave: '5', contaExportacao: 1101 }],
  ['6', { chave: '6', contaExportacao: null }],
  ['8', { chave: '8', contaExportacao: 9999 }],
]);
const ctx: ContextoAplicacao = { plano: PLANO, dePara, chaveDoCampo: (c, f) => chaveDePara([f.campos[c]]) };

describe('publicação da regra versionada', () => {
  it('primeira versão válida', () => {
    expect(problemasDaPublicacao(regra(), [], PLANO)).toEqual([]);
  });

  it('versão seguinte, vigência depois da anterior e fim depois do início', () => {
    const v1 = regra();
    expect(problemasDaPublicacao(regra({ versao: 3 }), [v1], PLANO)).toContain('A versão tem de ser 2.');
    expect(problemasDaPublicacao(regra({ versao: 2 }), [v1], PLANO)[0]).toMatch(/depois de 2027-01-01/);
    expect(problemasDaPublicacao(regra({ versao: 2, vigenciaInicio: '2027-03-01' }), [v1], PLANO)).toEqual(
      [],
    );
    expect(problemasDaPublicacao(regra({ vigenciaFim: '2026-12-31' }), [], PLANO)).toContain(
      'O fim da vigência é antes do início.',
    );
  });

  it('outra regra do mesmo tipo com a mesma prioridade e vigência sobreposta é recusada', () => {
    const outra = regra({ nome: 'Outra receita', vigenciaInicio: '2026-01-01', vigenciaFim: '2027-06-30' });
    expect(problemasDaPublicacao(regra(), [outra], PLANO)[0]).toMatch(/Mesma prioridade/);
    expect(problemasDaPublicacao(regra({ prioridade: 10 }), [outra], PLANO)).toEqual([]);
    expect(problemasDaPublicacao(regra(), [{ ...outra, vigenciaFim: '2026-12-31' }], PLANO)).toEqual([]);
  });

  it('percentuais somam 100 no lado inteiro; conta fixa analítica e ativa', () => {
    const base = regra();
    const credito = base.partidas[1]!;
    const perc = (p: number) => ({ ...credito, valor: { base: 'percentual' as const, percentual: p } });
    expect(
      problemasDaPublicacao(regra({ partidas: [base.partidas[0]!, perc(60), perc(40)] }), [], PLANO),
    ).toEqual([]);
    expect(
      problemasDaPublicacao(regra({ partidas: [base.partidas[0]!, perc(60), perc(30)] }), [], PLANO)[0],
    ).toMatch(/somar 100/);
    expect(
      problemasDaPublicacao(regra({ partidas: [base.partidas[0]!, perc(100), credito] }), [], PLANO)[0],
    ).toMatch(/somar 100/);
    const sint = { ...credito, conta: { modo: 'fixa' as const, conta: '3.1' } };
    expect(problemasDaPublicacao(regra({ partidas: [base.partidas[0]!, sint] }), [], PLANO)[0]).toMatch(
      /sintética/,
    );
    const padraoInativo = {
      ...base.partidas[0]!,
      conta: { modo: 'dePara' as const, campoChave: 'convenio', contaPadrao: '3.1.1.01.0009' },
    };
    expect(problemasDaPublicacao(regra({ partidas: [padraoInativo, credito] }), [], PLANO)[0]).toMatch(
      /inativa/,
    );
    expect(
      problemasDaPublicacao(
        regra({ partidas: [credito, { ...credito, conta: { modo: 'fixa', conta: '3.1.1.01.0002' } }] }),
        [],
        PLANO,
      ),
    ).toContain('Falta partida de débito.');
  });

  it('a forma canônica independe da ordem das chaves', () => {
    const r = regra();
    const invertida = Object.fromEntries(Object.entries(r).reverse()) as typeof r;
    expect(conteudoCanonicoRegra(invertida)).toBe(conteudoCanonicoRegra(r));
  });
});

describe('regra do fato', () => {
  it('vigência, condições e prioridade', () => {
    const geral = regra();
    const especial = regra({
      nome: 'Convênio 5',
      prioridade: 10,
      condicoes: [{ campo: 'convenio', operador: 'igual', valor: 5 }],
    });
    expect(regraDoFato([geral, especial], fato())?.nome).toBe('Convênio 5');
    expect(regraDoFato([geral, especial], fato({ campos: { convenio: 6 } }))?.nome).toBe('Receita da conta');
    expect(regraDoFato([geral], fato({ data: '2026-12-31' }))).toBeNull();
    expect(regraDoFato([regra({ vigenciaFim: '2027-01-10' })], fato())).toBeNull();
    expect(regraDoFato([geral], fato({ empresa: 2 }))).toBeNull();
  });

  it('operadores das condições', () => {
    const c = (
      operador: 'igual' | 'diferente' | 'em' | 'maiorQue' | 'menorQue',
      valor: number | number[] | string,
    ) => condicoesValem(regra({ condicoes: [{ campo: 'convenio', operador, valor }] }), fato());
    expect(c('igual', '5')).toBe(true);
    expect(c('diferente', 5)).toBe(false);
    expect(c('em', [4, 5])).toBe(true);
    expect(c('em', 5)).toBe(false);
    expect(c('maiorQue', 4)).toBe(true);
    expect(c('menorQue', 4)).toBe(false);
    expect(
      condicoesValem(regra({ condicoes: [{ campo: 'nada', operador: 'igual', valor: 1 }] }), fato()),
    ).toBe(false);
  });

  it('histórico com marcadores e o prefixo do estorno', () => {
    expect(montarHistorico('Conta {documento} {competencia} {convenio} {nada}', fato())).toBe(
      'Conta conta 10 2027-01 5 ',
    );
    expect(montarHistorico('X', fato({ estorno: true }))).toBe('Estorno: X');
  });
});

describe('contabilizar o fato', () => {
  it('débito pelo de-para, crédito fixo, centro de custo do fato, partidas iguais', () => {
    const r = contabilizar(fato(), [regra()], ctx);
    expect(r.situacao).toBe('contabilizado');
    expect(r.lancamento!.partidas).toEqual([
      {
        lado: 'D',
        conta: '1.1.2.01.0001',
        valorCentavos: 150_000,
        historico: 'Receita conta 10 2027-01',
        centroCusto: null,
      },
      {
        lado: 'C',
        conta: '3.1.1.01.0001',
        valorCentavos: 150_000,
        historico: 'Receita conta 10',
        centroCusto: 7,
      },
    ]);
    expect(r.lancamento!.chave).toBe(chaveDoLancamento(fato(), regra()));
  });

  it('estorno e valor negativo invertem os lados', () => {
    const e = contabilizar(fato({ estorno: true }), [regra()], ctx).lancamento!;
    expect(e.partidas.map((p) => `${p.lado}${p.conta}`)).toEqual(['D3.1.1.01.0001', 'C1.1.2.01.0001']);
    const n = contabilizar(fato({ valorCentavos: -500 }), [regra()], ctx).lancamento!;
    expect(n.partidas[0]).toMatchObject({ lado: 'D', conta: '3.1.1.01.0001', valorCentavos: 500 });
    const ambos = contabilizar(fato({ valorCentavos: -500, estorno: true }), [regra()], ctx).lancamento!;
    expect(ambos.partidas[0]).toMatchObject({ lado: 'D', conta: '1.1.2.01.0001' });
  });

  it('sem regra, sem valor, sem conta no de-para: nunca uma conta inventada', () => {
    expect(contabilizar(fato({ valorCentavos: 0 }), [regra()], ctx).situacao).toBe('ignorado');
    expect(contabilizar(fato(), [], ctx).situacao).toBe('semRegra');
    for (const convenio of [6, 7, 8]) {
      const r = contabilizar(fato({ campos: { convenio } }), [regra()], ctx);
      expect(r.situacao, String(convenio)).toBe('semConta');
      expect(r.lancamento).toBeNull();
    }
  });

  it('a conta padrão da partida cobre o de-para vazio', () => {
    const base = regra();
    const comPadrao = regra({
      partidas: [
        {
          ...base.partidas[0]!,
          conta: { modo: 'dePara', campoChave: 'convenio', contaPadrao: '1.1.2.01.0002' },
        },
        base.partidas[1]!,
      ],
    });
    expect(
      contabilizar(fato({ campos: { convenio: 6 } }), [comPadrao], ctx).lancamento!.partidas[0]!.conta,
    ).toBe('1.1.2.01.0002');
  });

  it('conta fixa sintética ou inativa: semConta', () => {
    const base = regra();
    const inativa = regra({
      partidas: [
        base.partidas[0]!,
        { ...base.partidas[1]!, conta: { modo: 'fixa', conta: '3.1.1.01.0009' } },
      ],
    });
    expect(contabilizar(fato(), [inativa], ctx).motivo).toMatch(/inativa/);
  });

  it('rateio por percentual sem perder centavo e valor de campo', () => {
    const base = regra();
    const c = base.partidas[1]!;
    const rateio = regra({
      partidas: [
        base.partidas[0]!,
        { ...c, valor: { base: 'percentual', percentual: 33.33 } },
        {
          ...c,
          conta: { modo: 'fixa', conta: '3.1.1.01.0002' },
          valor: { base: 'percentual', percentual: 66.67 },
        },
      ],
    });
    const l = contabilizar(fato({ valorCentavos: 100 }), [rateio], ctx).lancamento!;
    expect(l.partidas.filter((p) => p.lado === 'C').map((p) => p.valorCentavos)).toEqual([33, 67]);
    const porCampo = regra({
      partidas: [
        { ...base.partidas[0]!, valor: { base: 'campo', campo: 'liquido' } },
        { ...c, valor: { base: 'campo', campo: 'liquido' } },
      ],
    });
    expect(
      contabilizar(fato({ campos: { convenio: 5, liquido: 900 } }), [porCampo], ctx).lancamento!.partidas[0]!
        .valorCentavos,
    ).toBe(900);
    const desequilibrada = regra({
      partidas: [base.partidas[0]!, { ...c, valor: { base: 'campo', campo: 'liquido' } }],
    });
    expect(
      contabilizar(fato({ campos: { convenio: 5, liquido: 900 } }), [desequilibrada], ctx).motivo,
    ).toMatch(/Débitos/);
    const campoVazio = regra({
      partidas: [base.partidas[0]!, { ...c, valor: { base: 'campo', campo: 'nada' } }],
    });
    expect(contabilizar(fato(), [campoVazio], ctx).situacao).toBe('semConta');
  });

  it('reprocessar o período com o mesmo fato, regra, plano e de-para dá lançamentos idênticos', () => {
    const fatos = [
      fato(),
      fato({ id: 11, impressao: 'def', valorCentavos: 33 }),
      fato({ id: 12, impressao: 'ghi', estorno: true }),
    ];
    const primeira = fatos.map((f) => contabilizar(f, [regra()], ctx).lancamento!);
    const segunda = [...fatos].reverse().map((f) => contabilizar(f, [regra()], ctx).lancamento!);
    const c = compararReprocessamento(primeira, segunda);
    expect(c.identico).toBe(true);
    expect(c.iguais).toBe(3);
    expect(c.totais.primeira).toEqual(c.totais.segunda);
  });

  it('o reprocessamento acha o que mudou (nova versão de regra no período aberto)', () => {
    const v2 = regra({
      versao: 2,
      vigenciaInicio: '2027-01-10',
      partidas: [
        regra().partidas[0]!,
        { ...regra().partidas[1]!, conta: { modo: 'fixa', conta: '3.1.1.01.0002' } },
      ],
    });
    const a = [
      contabilizar(fato(), [regra()], ctx).lancamento!,
      contabilizar(fato({ id: 2, impressao: 'b' }), [regra()], ctx).lancamento!,
    ];
    const b = [contabilizar(fato(), [regra(), v2], ctx).lancamento!];
    const outra = { ...a[0]!, partidas: a[0]!.partidas.map((p) => ({ ...p, valorCentavos: 1 })) };
    const c = compararReprocessamento(a, [...b, outra]);
    expect(c.identico).toBe(false);
    expect(c.soNaPrimeira).toEqual([a[1]!.chave]);
    expect(c.soNaSegunda).toEqual([b[0]!.chave]);
    expect(c.diferentes).toEqual([a[0]!.chave]);
  });
});

describe('de-para comum (regra 6)', () => {
  it('chave, resolução e a lista sem conta', () => {
    expect(chaveDePara([1, null, 'I', undefined, ' 3 '])).toBe('1||I||3');
    expect(resolverDePara('5', dePara, PLANO, null)).toEqual({ conta: '1.1.2.01.0001', motivo: 'ok' });
    expect(resolverDePara('x', dePara, PLANO, null).motivo).toBe('semItem');
    expect(resolverDePara('6', dePara, PLANO, null).motivo).toBe('semContaExportacao');
    expect(resolverDePara('8', dePara, PLANO, null).motivo).toBe('semContaNoPlano');
    expect(resolverDePara('8', dePara, PLANO, '1.1.2.01.0002')).toEqual({
      conta: '1.1.2.01.0002',
      motivo: 'padrao',
    });
    expect(itensSemConta(dePara.values()).map((i) => i.chave)).toEqual(['6']);
  });
});
