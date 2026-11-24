// F8, 07-FIN linhas 68 e 69: regras do encontro de contas e da previsão e provisão de pagamentos.
import { describe, expect, it } from 'vitest';
import {
  conferirAprovacaoEncontro,
  conferirCancelamentoEncontro,
  type ParcelaEncontro,
  planejarEncontroContas,
} from './encontro-contas.js';
import {
  ajustarDiaUtil,
  conciliarPrevistoRealizado,
  gerarOcorrenciasPrevisao,
  liquidarProvisao,
  reverterProvisao,
} from './previsao-provisao.js';

const DOC = '12345678000190';
const p = (o: Partial<ParcelaEncontro>): ParcelaEncontro => ({
  natureza: 'pagar',
  parcela: 1,
  situacao: 'aberta',
  saldo: 100,
  vencimento: '2026-11-10',
  documento: DOC,
  emOutroEncontro: false,
  ...o,
});
const codigo = (r: unknown) => (r && typeof r === 'object' && 'codigo' in r ? r.codigo : null);

describe('encontro de contas', () => {
  it('compensa o menor total, pelo vencimento mais antigo do lado maior, e mostra o saldo líquido', () => {
    const r = planejarEncontroContas({
      documentoParceiro: '12.345.678/0001-90',
      parcelas: [
        p({ parcela: 1, saldo: 300, vencimento: '2026-12-01' }),
        p({ parcela: 2, saldo: 200, vencimento: '2026-11-01' }),
        p({ natureza: 'receber', parcela: 9, saldo: 350 }),
      ],
    });
    if ('codigo' in r) throw new Error(r.mensagem);
    expect(r.totalPagar).toBe(500);
    expect(r.totalReceber).toBe(350);
    expect(r.saldoLiquido).toBe(-150);
    expect(r.compensado).toBe(350);
    expect(r.itens).toEqual([
      { natureza: 'pagar', parcela: 2, sequencia: 1, valorCompensado: 200, saldoDepois: 0 },
      { natureza: 'pagar', parcela: 1, sequencia: 2, valorCompensado: 150, saldoDepois: 150 },
      { natureza: 'receber', parcela: 9, sequencia: 3, valorCompensado: 350, saldoDepois: 0 },
    ]);
  });

  it('recusa parceiro diferente, lado único, parcela fechada, repetida ou noutro encontro', () => {
    const base = [p({}), p({ natureza: 'receber', parcela: 2 })];
    const plano = (parcelas: ParcelaEncontro[]) =>
      codigo(planejarEncontroContas({ documentoParceiro: DOC, parcelas }));
    expect(plano([p({}), p({ natureza: 'receber', parcela: 2, documento: '99999999000199' })])).toBe(
      'parceiro-diferente',
    );
    expect(plano([p({})])).toBe('encontro-sem-dois-lados');
    expect(plano([...base, p({ parcela: 3, situacao: 'paga' })])).toBe('parcela-fechada');
    expect(plano([...base, p({})])).toBe('parcela-repetida');
    expect(plano([...base, p({ parcela: 4, emOutroEncontro: true })])).toBe('parcela-em-outro-encontro');
    expect(codigo(planejarEncontroContas({ documentoParceiro: '123', parcelas: base }))).toBe(
      'parceiro-sem-documento',
    );
  });

  it('aprova só o pendente e por outra pessoa; cancela só o não efetivado e com motivo', () => {
    expect(
      conferirAprovacaoEncontro({ situacao: 'aguardando_aprovacao', propostoPor: 1, aprovador: 2 }),
    ).toBeNull();
    expect(
      codigo(conferirAprovacaoEncontro({ situacao: 'aguardando_aprovacao', propostoPor: 1, aprovador: 1 })),
    ).toBe('aprovador-igual-proponente');
    expect(codigo(conferirAprovacaoEncontro({ situacao: 'efetivado', propostoPor: 1, aprovador: 2 }))).toBe(
      'encontro-nao-pendente',
    );
    expect(codigo(conferirCancelamentoEncontro({ situacao: 'efetivado', motivo: 'qualquer' }))).toBe(
      'encontro-fechado',
    );
    expect(codigo(conferirCancelamentoEncontro({ situacao: 'aguardando_aprovacao', motivo: ' ' }))).toBe(
      'motivo-obrigatorio',
    );
  });
});

describe('previsão e provisão de pagamentos', () => {
  it('gera as ocorrências mensais no dia pedido, ajustadas ao dia útil, até o fim', () => {
    const r = gerarOcorrenciasPrevisao({
      periodicidade: 'mensal',
      dataInicio: '2026-11-01',
      dataFim: '2027-02-28',
      diaVencimento: 31,
      valor: 1000,
      ajuste: 'postergar',
    });
    if ('codigo' in r) throw new Error(r.mensagem);
    expect(r.map((o) => [o.competencia, o.dataEsperada])).toEqual([
      ['2026-11-01', '2026-11-30'],
      ['2026-12-01', '2026-12-31'],
      ['2027-01-01', '2027-02-01'],
      ['2027-02-01', '2027-03-01'],
    ]);
    expect(ajustarDiaUtil('2027-01-31', 'antecipar')).toBe('2027-01-29');
  });

  it('a previsão sem fim gera 12 meses; recusa valor zero e fim antes do início', () => {
    const r = gerarOcorrenciasPrevisao({
      periodicidade: 'mensal',
      dataInicio: '2026-11-05',
      dataFim: null,
      diaVencimento: null,
      valor: 10,
      ajuste: 'manter',
    });
    expect(Array.isArray(r) && r.length).toBe(13);
    const base = { periodicidade: 'unica', dataFim: null, diaVencimento: null, ajuste: 'manter' } as const;
    expect(codigo(gerarOcorrenciasPrevisao({ ...base, dataInicio: '2026-11-01', valor: 0 }))).toBe(
      'valor-invalido',
    );
    expect(
      codigo(
        gerarOcorrenciasPrevisao({ ...base, dataInicio: '2026-11-01', dataFim: '2026-10-01', valor: 5 }),
      ),
    ).toBe('periodo-invalido');
  });

  it('realiza a ocorrência aberta com a diferença; liquida e reverte a provisão sem saldo negativo', () => {
    expect(conciliarPrevistoRealizado({ situacao: 'aberta', previsto: 1000, realizado: 1080.5 })).toEqual({
      diferenca: 80.5,
    });
    expect(codigo(conciliarPrevistoRealizado({ situacao: 'realizada', previsto: 1, realizado: 1 }))).toBe(
      'previsao-fechada',
    );
    const v = { valorProvisionado: 5000, valorBaixado: 0, valorRevertido: 0, situacao: 'provisionada' };
    expect(liquidarProvisao(v, 3000)).toMatchObject({ saldo: 2000, situacao: 'parcial', consumido: 3000 });
    expect(liquidarProvisao(v, 5200)).toMatchObject({ saldo: 0, situacao: 'liquidada', diferenca: 200 });
    expect(reverterProvisao(v, 5000, 'glosa total da conta')).toMatchObject({
      saldo: 0,
      situacao: 'revertida',
    });
    expect(codigo(reverterProvisao(v, 5000.01, 'glosa total da conta'))).toBe('valor-acima-do-saldo');
    expect(codigo(reverterProvisao(v, 10, ''))).toBe('motivo-obrigatorio');
    expect(codigo(liquidarProvisao({ ...v, valorBaixado: 5000, situacao: 'liquidada' }, 10))).toBe(
      'provisao-fechada',
    );
  });
});
