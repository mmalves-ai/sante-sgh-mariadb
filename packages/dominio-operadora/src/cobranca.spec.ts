// Regras puras da cobrança da operadora (M56, etapa 3, F2): mensalidade (faixa da RN 63 no mês seguinte ao
// aniversário, reajustes sobre o valor reajustado, beneficiários cobráveis, motivos para não gerar), coparticipação,
// lançamento, encargos e baixa, acordo (parcelas e centavos), reajuste anual (aniversário, 12 meses, teto da ANS,
// agrupamento) e inadimplência (dias em 12 meses, notificação até o 50º dia, mais de 60 dias, 2 mensalidades, 10 dias).
import { describe, expect, it } from 'vitest';
import {
  beneficiarioCobravel,
  calcularAcordo,
  centavos,
  competenciaCobrancaValida,
  competenciaDe,
  conferirReajuste,
  diasEntre,
  encargosNaData,
  idadeNaCompetencia,
  mensalidadeDoContrato,
  precoReajustado,
  primeiroDia,
  problemasDaBaixaCobranca,
  problemasDaNotificacao,
  problemasDoLancamento,
  situacaoInadimplencia,
  somarCompetencia,
  ultimoDia,
  valorCoparticipacao,
  vencimentoDaCompetencia,
} from './cobranca.js';

const PRECOS = [100, 120, 130, 140, 150, 170, 200, 240, 300, 400];
const contrato = (x: Partial<Parameters<typeof mensalidadeDoContrato>[0]['contrato']> = {}) => ({
  id: 7,
  tipo: 1,
  situacao: 'ativo',
  inicio: '2025-01-01',
  fim: null,
  diaVencimento: 10,
  precos: PRECOS,
  ...x,
});
const titular = {
  id: 1,
  titular: null,
  nascimento: '1980-05-10',
  inclusao: '2025-01-01',
  situacao: 'ativo',
  exclusao: null,
};
const filho = {
  id: 2,
  titular: 1,
  nascimento: '2015-03-01',
  inclusao: '2025-02-01',
  situacao: 'ativo',
  exclusao: null,
};

describe('datas e competência', () => {
  it('competência, primeiro e último dia, soma de meses, dias entre datas, vencimento no dia do contrato', () => {
    expect(competenciaCobrancaValida('2026-11')).toBe(true);
    expect(competenciaCobrancaValida('2026-13')).toBe(false);
    expect(primeiroDia('2026-02')).toBe('2026-02-01');
    expect(ultimoDia('2026-02')).toBe('2026-02-28');
    expect(ultimoDia('2028-02')).toBe('2028-02-29');
    expect(somarCompetencia('2026-11', 2)).toBe('2027-01');
    expect(somarCompetencia('2026-01', -1)).toBe('2025-12');
    expect(competenciaDe('2026-11-25')).toBe('2026-11');
    expect(diasEntre('2026-10-01', '2026-10-31')).toBe(30);
    expect(diasEntre('2026-10-31', '2026-10-01')).toBe(-30);
    expect(vencimentoDaCompetencia('2026-02', 31)).toBe('2026-02-28');
    expect(vencimentoDaCompetencia('2026-11', 5)).toBe('2026-11-05');
    expect(centavos(0.1 + 0.2)).toBe(0.3);
    expect(centavos(1.005)).toBe(1.01);
  });

  it('a faixa nova vale no mês seguinte ao aniversário (idade no último dia do mês anterior)', () => {
    // Faz 19 anos em 15/03/2026: março ainda é 18; abril já é 19.
    expect(idadeNaCompetencia('2007-03-15', '2026-03')).toBe(18);
    expect(idadeNaCompetencia('2007-03-15', '2026-04')).toBe(19);
    // Nascido no dia 1º: no próprio mês ainda é a idade anterior.
    expect(idadeNaCompetencia('2007-03-01', '2026-03')).toBe(18);
    expect(idadeNaCompetencia('2026-03-20', '2026-03')).toBe(0);
  });

  it('reajustes em cadeia, arredondados ao centavo a cada passo', () => {
    expect(precoReajustado(100, [])).toBe(100);
    expect(precoReajustado(100, [6.91])).toBe(106.91);
    expect(precoReajustado(100, [6.91, 10])).toBe(117.6);
    expect(precoReajustado(100, [-8.19])).toBe(91.81);
  });
});

describe('mensalidade do contrato', () => {
  it('pessoa física: um item por beneficiário com o preço da faixa; o pagador é o titular; vence no dia do contrato', () => {
    const r = mensalidadeDoContrato({
      contrato: contrato(),
      beneficiarios: [filho, titular],
      reajustes: [],
      competencia: '2026-11',
      jaGerada: false,
    });
    expect(r).toEqual({
      gerar: true,
      beneficiario: 1,
      vencimento: '2026-11-10',
      valor: 300,
      itens: [
        { beneficiario: 1, idade: 46, faixa: 6, valorTabela: 200, valor: 200 },
        { beneficiario: 2, idade: 11, faixa: 0, valorTabela: 100, valor: 100 },
      ],
    });
  });

  it('com os reajustes vigentes até a competência; a pessoa jurídica não tem titular pagador', () => {
    const r = mensalidadeDoContrato({
      contrato: contrato({ tipo: 2 }),
      beneficiarios: [titular],
      reajustes: [
        { competencia: '2027-01', percentual: 50 },
        { competencia: '2026-01', percentual: 10 },
      ],
      competencia: '2026-11',
      jaGerada: false,
    });
    expect(r.gerar && r.beneficiario).toBeNull();
    expect(r.gerar && r.valor).toBe(220);
    expect(r.gerar && r.itens[0]).toEqual({
      beneficiario: 1,
      idade: 46,
      faixa: 6,
      valorTabela: 200,
      valor: 220,
    });
  });

  it('beneficiário cobrável: incluído até o último dia e não excluído antes do primeiro (sem proporcional)', () => {
    expect(beneficiarioCobravel({ ...titular, inclusao: '2026-11-30' }, '2026-11')).toBe(true);
    expect(beneficiarioCobravel({ ...titular, inclusao: '2026-12-01' }, '2026-11')).toBe(false);
    expect(
      beneficiarioCobravel({ ...titular, situacao: 'excluido', exclusao: '2026-11-02' }, '2026-11'),
    ).toBe(true);
    expect(
      beneficiarioCobravel({ ...titular, situacao: 'excluido', exclusao: '2026-11-01' }, '2026-11'),
    ).toBe(false);
    expect(beneficiarioCobravel({ ...titular, situacao: 'excluido', exclusao: null }, '2026-11')).toBe(false);
    expect(beneficiarioCobravel({ ...titular, situacao: 'suspenso' }, '2026-11')).toBe(true);
  });

  it('os motivos para não gerar', () => {
    const m = (x: Partial<Parameters<typeof mensalidadeDoContrato>[0]>) =>
      mensalidadeDoContrato({
        contrato: contrato(),
        beneficiarios: [titular],
        reajustes: [],
        competencia: '2026-11',
        jaGerada: false,
        ...x,
      });
    expect(m({ jaGerada: true })).toEqual({ gerar: false, motivo: 'ja-gerada' });
    expect(m({ contrato: contrato({ situacao: 'suspenso' }) })).toEqual({
      gerar: false,
      motivo: 'contrato-inativo',
    });
    expect(m({ contrato: contrato({ inicio: '2026-12-01' }) })).toEqual({
      gerar: false,
      motivo: 'contrato-fora-da-vigencia',
    });
    expect(m({ contrato: contrato({ fim: '2026-10-31' }) })).toEqual({
      gerar: false,
      motivo: 'contrato-fora-da-vigencia',
    });
    expect(m({ contrato: contrato({ diaVencimento: null }) })).toEqual({
      gerar: false,
      motivo: 'contrato-sem-dia-vencimento',
    });
    expect(m({ contrato: contrato({ precos: null }) })).toEqual({
      gerar: false,
      motivo: 'produto-sem-precos',
    });
    expect(m({ contrato: contrato({ precos: Array(10).fill(0) }) })).toEqual({
      gerar: false,
      motivo: 'produto-sem-precos',
    });
    expect(m({ beneficiarios: [] })).toEqual({ gerar: false, motivo: 'sem-beneficiarios' });
  });
});

describe('coparticipação e lançamento avulso', () => {
  it('percentual do evento, valor fixo até o evento, sem coparticipação', () => {
    expect(valorCoparticipacao({ tipo: 2, valor: 30 }, 250)).toBe(75);
    expect(valorCoparticipacao({ tipo: 2, valor: 33.33 }, 100.01)).toBe(33.33);
    expect(valorCoparticipacao({ tipo: 3, valor: 40 }, 250)).toBe(40);
    expect(valorCoparticipacao({ tipo: 3, valor: 40 }, 25)).toBe(25);
    expect(valorCoparticipacao({ tipo: 1, valor: null }, 250)).toBeNull();
    expect(valorCoparticipacao({ tipo: 2, valor: null }, 250)).toBeNull();
  });

  it('competência válida e vencimento a partir do mês anterior', () => {
    expect(problemasDoLancamento({ competencia: '2026-11', vencimento: '2026-10-01' })).toEqual([]);
    expect(problemasDoLancamento({ competencia: '2026-11', vencimento: '2026-09-30' })).toEqual([
      'vencimento-antes-da-competencia',
    ]);
    expect(problemasDoLancamento({ competencia: '2026-1', vencimento: '2026-11-01' })).toEqual([
      'competencia-invalida',
    ]);
  });
});

describe('encargos e baixa', () => {
  it('multa de 2% e juros de 1% ao mês pro rata dia só depois do vencimento', () => {
    expect(encargosNaData(270, '2026-11-10', '2026-11-10')).toEqual({ multa: 0, juros: 0, total: 0 });
    expect(encargosNaData(270, '2026-11-10', '2026-11-25')).toEqual({ multa: 5.4, juros: 1.35, total: 6.75 });
    expect(encargosNaData(300, '2026-01-10', '2026-03-11')).toEqual({ multa: 6, juros: 6, total: 12 });
  });

  it('a baixa confere com o devido na data; dispensa com motivo; aberta, data e emissão', () => {
    const base = {
      situacao: 'aberta',
      valor: 270,
      vencimento: '2026-11-10',
      emitidaEm: '2026-10-25',
      hoje: '2026-11-30',
      pagoEm: '2026-11-25',
      valorPago: 276.75,
      dispensarEncargos: false,
      motivoDispensa: null,
    };
    expect(problemasDaBaixaCobranca(base)).toEqual({
      problemas: [],
      encargos: { multa: 5.4, juros: 1.35, total: 6.75 },
      devido: 276.75,
    });
    expect(problemasDaBaixaCobranca({ ...base, valorPago: 270 }).problemas).toEqual(['valor-divergente']);
    expect(problemasDaBaixaCobranca({ ...base, valorPago: 270, dispensarEncargos: true }).problemas).toEqual([
      'dispensa-sem-motivo',
    ]);
    expect(
      problemasDaBaixaCobranca({
        ...base,
        valorPago: 270,
        dispensarEncargos: true,
        motivoDispensa: 'Acordo comercial',
      }),
    ).toMatchObject({ problemas: [], devido: 270 });
    // Sem atraso, a dispensa não pede motivo.
    expect(
      problemasDaBaixaCobranca({ ...base, pagoEm: '2026-11-10', valorPago: 270, dispensarEncargos: true })
        .problemas,
    ).toEqual([]);
    expect(
      problemasDaBaixaCobranca({ ...base, situacao: 'paga', pagoEm: '2026-12-01', valorPago: 270 }).problemas,
    ).toEqual(['nao-aberta', 'pagamento-futuro', 'valor-divergente']);
    expect(problemasDaBaixaCobranca({ ...base, pagoEm: '2026-10-20', valorPago: 270 }).problemas).toEqual([
      'pagamento-antes-da-emissao',
    ]);
  });
});

describe('acordo', () => {
  const cobrancas = [
    { id: 1, contrato: 7, situacao: 'aberta', valor: 270, vencimento: '2026-09-10' },
    { id: 2, contrato: 7, situacao: 'aberta', valor: 270, vencimento: '2026-10-10' },
  ];
  it('principal, encargos até hoje e as parcelas mensais (os centavos na última)', () => {
    const { problemas, acordo } = calcularAcordo({
      contrato: 7,
      cobrancas,
      hoje: '2026-10-25',
      parcelas: 3,
      primeiroVencimento: '2026-11-05',
      dispensarEncargos: false,
      motivoDispensa: null,
    });
    expect(problemas).toEqual([]);
    expect(acordo.principal).toBe(540);
    // 1: 45 dias (multa 5,40; juros 4,05); 2: 15 dias (multa 5,40; juros 1,35).
    expect(acordo.cobrancas.map((c) => c.encargos.total)).toEqual([9.45, 6.75]);
    expect(acordo.cobrancas.map((c) => c.diasAtraso)).toEqual([45, 15]);
    expect(acordo.encargos).toBe(16.2);
    expect(acordo.total).toBe(556.2);
    expect(acordo.parcelas).toEqual([
      { numero: 1, vencimento: '2026-11-05', valor: 185.4 },
      { numero: 2, vencimento: '2026-12-05', valor: 185.4 },
      { numero: 3, vencimento: '2027-01-05', valor: 185.4 },
    ]);
    const sete = calcularAcordo({
      contrato: 7,
      cobrancas: [{ id: 3, contrato: 7, situacao: 'aberta', valor: 100, vencimento: '2026-11-10' }],
      hoje: '2026-10-25',
      parcelas: 7,
      primeiroVencimento: '2026-10-31',
      dispensarEncargos: false,
      motivoDispensa: null,
    }).acordo;
    expect(sete.parcelas.map((p) => p.valor)).toEqual([14.28, 14.28, 14.28, 14.28, 14.28, 14.28, 14.32]);
    expect(sete.parcelas[1]!.vencimento).toBe('2026-11-30');
  });

  it('as recusas: outro contrato, não aberta, repetida, vencimento passado, parcela zero, dispensa sem motivo', () => {
    const { problemas } = calcularAcordo({
      contrato: 7,
      cobrancas: [
        cobrancas[0]!,
        cobrancas[0]!,
        { id: 9, contrato: 8, situacao: 'paga', valor: 0.02, vencimento: '2026-10-10' },
      ],
      hoje: '2026-10-25',
      parcelas: 12,
      primeiroVencimento: '2026-10-24',
      dispensarEncargos: true,
      motivoDispensa: '',
    });
    expect(problemas).toEqual([
      'acordo-cobranca-repetida',
      'acordo-de-outro-contrato',
      'acordo-cobranca-nao-aberta',
      'acordo-vencimento-passado',
      'dispensa-sem-motivo',
    ]);
    const zero = calcularAcordo({
      contrato: 7,
      cobrancas: [{ id: 4, contrato: 7, situacao: 'aberta', valor: 0.05, vencimento: '2026-11-10' }],
      hoje: '2026-10-25',
      parcelas: 12,
      primeiroVencimento: '2026-11-01',
      dispensarEncargos: true,
      motivoDispensa: null,
    });
    expect(zero.problemas).toEqual(['acordo-parcela-zero']);
    expect(zero.acordo.encargos).toBe(0);
  });
});

describe('reajuste anual', () => {
  const base = {
    competencia: '2026-01',
    percentual: 6.91,
    tetoAns: 6.91,
    oficioAns: 'Ofício ANS 1/2026',
    contrato: { situacao: 'ativo', inicio: '2025-01-15', mesReajuste: 1, tipoContratacao: 1 },
    reajustesVigentes: [] as string[],
    ultimaMensalidade: '2025-12',
    vidas: 3,
  };
  it('no aniversário, 12 meses depois do início, dentro do teto da ANS', () => {
    expect(conferirReajuste(base)).toEqual({ problemas: [], avisos: [] });
  });
  it('as recusas do individual ou familiar', () => {
    expect(conferirReajuste({ ...base, competencia: '2026-02' }).problemas).toEqual([
      'reajuste-fora-do-aniversario',
    ]);
    expect(conferirReajuste({ ...base, competencia: '2025-01', ultimaMensalidade: null }).problemas).toEqual([
      'reajuste-antes-de-12-meses',
    ]);
    expect(conferirReajuste({ ...base, percentual: 7 }).problemas).toEqual(['reajuste-acima-do-teto']);
    expect(conferirReajuste({ ...base, tetoAns: null }).problemas).toEqual(['reajuste-sem-teto-ans']);
    expect(conferirReajuste({ ...base, oficioAns: ' ' }).problemas).toEqual(['reajuste-sem-teto-ans']);
    expect(conferirReajuste({ ...base, percentual: 0 }).problemas).toEqual(['reajuste-percentual-zero']);
    expect(conferirReajuste({ ...base, ultimaMensalidade: '2026-01' }).problemas).toEqual([
      'reajuste-competencia-cobrada',
    ]);
    expect(conferirReajuste({ ...base, reajustesVigentes: ['2026-01'] }).problemas).toEqual([
      'reajuste-ja-registrado',
    ]);
    expect(
      conferirReajuste({ ...base, contrato: { ...base.contrato, situacao: 'encerrado' } }).problemas,
    ).toEqual(['contrato-encerrado']);
    expect(conferirReajuste({ ...base, competencia: '2026-13' }).problemas).toEqual(['competencia-invalida']);
  });
  it('o intervalo de 12 meses com os vigentes (antes e depois)', () => {
    const c = { ...base, contrato: { ...base.contrato, mesReajuste: 6, inicio: '2020-06-01' } };
    expect(
      conferirReajuste({ ...c, competencia: '2026-06', reajustesVigentes: ['2025-12'] }).problemas,
    ).toEqual(['reajuste-intervalo-menor']);
    expect(
      conferirReajuste({
        ...c,
        competencia: '2026-06',
        reajustesVigentes: ['2027-01'],
        ultimaMensalidade: null,
      }).problemas,
    ).toEqual(['reajuste-intervalo-menor']);
    expect(
      conferirReajuste({ ...c, competencia: '2026-06', reajustesVigentes: ['2025-06'] }).problemas,
    ).toEqual([]);
  });
  it('coletivo: sem teto da ANS; com menos de 30 vidas, o aviso do agrupamento', () => {
    const col = {
      ...base,
      tetoAns: null,
      oficioAns: null,
      contrato: { ...base.contrato, tipoContratacao: 2 },
    };
    expect(conferirReajuste({ ...col, percentual: 15 })).toEqual({
      problemas: [],
      avisos: ['reajuste-agrupamento'],
    });
    expect(conferirReajuste({ ...col, percentual: 15, vidas: 30 }).avisos).toEqual([]);
    expect(conferirReajuste({ ...col, tetoAns: 5 }).problemas).toEqual(['reajuste-teto-so-individual']);
  });
});

describe('inadimplência', () => {
  const m = (
    vencimento: string,
    x: Partial<Parameters<typeof situacaoInadimplencia>[0]['cobrancas'][number]> = {},
  ) => ({
    tipo: 1,
    vencimento,
    situacao: 'aberta',
    situacaoEm: '2026-01-01',
    notificadoEm: null,
    ...x,
  });
  it('em dia (nada vencido em aberto; a paga em dia e a cancelada não contam)', () => {
    const r = situacaoInadimplencia({
      cobrancas: [
        m('2026-10-10', { situacao: 'paga', situacaoEm: '2026-10-10' }),
        m('2026-09-10', { situacao: 'cancelada' }),
        m('2026-11-10'),
        m('2026-08-10', { tipo: 3 }),
      ],
      hoje: '2026-10-25',
      tipoContratacao: 1,
    });
    expect(r).toMatchObject({
      situacao: 'em-dia',
      vencidas: 0,
      diasAcumulados12m: 0,
      mensalidadesEmAtraso12m: 0,
    });
  });

  it('individual: notificar até o 50º dia; os dias do mesmo período contam uma vez', () => {
    const r = situacaoInadimplencia({
      cobrancas: [
        m('2026-09-10'),
        m('2026-10-10'),
        m('2026-08-10', { situacao: 'paga', situacaoEm: '2026-08-20' }),
      ],
      hoje: '2026-10-25',
      tipoContratacao: 1,
    });
    // 11/09 a 25/10 = 45 dias (a de outubro está dentro) + 10 dias da paga em atraso.
    expect(r).toMatchObject({
      situacao: 'notificar',
      vencidas: 2,
      vencimentoMaisAntigo: '2026-09-10',
      diasAtrasoAtual: 45,
      diasAcumulados12m: 55,
      mensalidadesEmAtraso12m: 3,
      prazoNotificacao: '2026-10-20',
    });
  });

  it('notificado: no prazo de 10 dias; depois, com mais de 60 dias e 2 mensalidades, pode suspender', () => {
    const cob = [
      m('2026-08-10', { notificadoEm: '2026-09-20', notificacaoMeio: 'carta-ar' }),
      m('2026-09-10', { notificadoEm: '2026-09-20' }),
    ];
    expect(situacaoInadimplencia({ cobrancas: cob, hoje: '2026-09-25', tipoContratacao: 1 })).toMatchObject({
      situacao: 'aguardando-prazo',
      notificadoEm: '2026-09-20',
      notificacaoMeio: 'carta-ar',
      prazoPagamento: '2026-09-30',
    });
    expect(situacaoInadimplencia({ cobrancas: cob, hoje: '2026-10-25', tipoContratacao: 1 })).toMatchObject({
      situacao: 'passivel-suspensao',
      diasAcumulados12m: 76,
      mensalidadesEmAtraso12m: 2,
    });
    // Só uma mensalidade em atraso: não pode suspender, mesmo com mais de 60 dias.
    expect(
      situacaoInadimplencia({ cobrancas: [cob[0]!], hoje: '2026-10-25', tipoContratacao: 1 }).situacao,
    ).toBe('aguardando-prazo');
  });

  it('a janela de 12 meses e a renegociada (atraso até o acordo); coletivo segue o contrato', () => {
    const r = situacaoInadimplencia({
      cobrancas: [
        m('2025-09-10', { situacao: 'paga', situacaoEm: '2025-11-30' }),
        m('2026-09-10', { situacao: 'renegociada', situacaoEm: '2026-09-20' }),
        m('2026-10-10', { tipo: 4 }),
      ],
      hoje: '2026-10-25',
      tipoContratacao: 2,
    });
    // A antiga: só de 25/10/2025 a 30/11/2025 (37 dias) na janela; a renegociada 10; a parcela 15.
    expect(r).toMatchObject({
      situacao: 'conforme-contrato',
      diasAcumulados12m: 62,
      mensalidadesEmAtraso12m: 3,
    });
    expect(r.prazoNotificacao).toBeNull();
    const fora = situacaoInadimplencia({
      cobrancas: [m('2025-01-10', { situacao: 'paga', situacaoEm: '2025-02-10' })],
      hoje: '2026-10-25',
      tipoContratacao: 1,
    });
    expect(fora).toMatchObject({ situacao: 'em-dia', mensalidadesEmAtraso12m: 0, diasAcumulados12m: 0 });
  });

  it('a notificação: com vencida em aberto, de hoje para trás e depois do vencimento', () => {
    expect(
      problemasDaNotificacao({ em: '2026-10-20', hoje: '2026-10-25', vencimentoMaisAntigo: '2026-09-10' }),
    ).toEqual([]);
    expect(
      problemasDaNotificacao({ em: '2026-10-20', hoje: '2026-10-25', vencimentoMaisAntigo: null }),
    ).toEqual(['notificacao-sem-atraso']);
    expect(
      problemasDaNotificacao({ em: '2026-10-26', hoje: '2026-10-25', vencimentoMaisAntigo: '2026-10-26' }),
    ).toEqual(['notificacao-futura', 'notificacao-antes-do-vencimento']);
  });
});
