import { describe, expect, it } from 'vitest';
import {
  calcularSaldosDiarios,
  competenciaDe,
  conferirDecisaoReabertura,
  conferirLancamentoNoPeriodo,
  conferirPedidoReabertura,
  fimDaCompetencia,
  MESES_POR_FECHAMENTO,
  planejarFechamentoPeriodo,
  proximaCompetencia,
  resumoDoPeriodo,
} from './periodo-financeiro.js';

const cod = (r: { codigo: string } | null) => r?.codigo ?? null;
const HOJE = '2026-11-24';
const plano = (
  competencia: string,
  o: { atual?: 'fechado' | 'reaberto'; ultima?: string; primeira?: string } = {},
) => {
  const r = planejarFechamentoPeriodo({
    competencia,
    atual: o.atual ? { competencia, situacao: o.atual } : null,
    hoje: HOJE,
    ultimaFechada: o.ultima ?? null,
    primeiraComMovimento: o.primeira ?? null,
  });
  return 'recusa' in r ? r.recusa.codigo : r.competencias;
};

describe('período financeiro: fechamento em ordem', () => {
  it('fecha o mês terminado ainda aberto, também o reaberto', () => {
    expect(plano('2026-10-01')).toEqual(['2026-10-01']);
    expect(plano('2026-10-01', { atual: 'reaberto', ultima: '2026-09-01' })).toEqual(['2026-10-01']);
  });
  it('recusa o mês em curso, o futuro, a competência fora do primeiro dia e o já fechado', () => {
    expect(plano('2026-11-01')).toBe('periodo-em-curso');
    expect(plano('2027-01-01')).toBe('periodo-em-curso');
    expect(plano('2026-10-15')).toBe('competencia-invalida');
    expect(plano('2026-10-01', { atual: 'fechado' })).toBe('periodo-ja-fechado');
    // Anterior à última fechada: já coberto pela trava (fechado em cadeia).
    expect(plano('2026-08-01', { ultima: '2026-09-01' })).toBe('periodo-ja-fechado');
  });
  it('mês anterior sem registro: fecha em cadeia desde a última fechada', () => {
    expect(plano('2026-10-01', { ultima: '2026-07-01' })).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
  });
  it('primeiro fechamento: fecha em cadeia desde o primeiro mês com movimento', () => {
    expect(plano('2026-10-01', { primeira: '2026-08-01' })).toEqual([
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ]);
    expect(plano('2026-01-01', { primeira: '2025-12-01' })).toEqual(['2025-12-01', '2026-01-01']);
    // Movimento só depois da pedida: fecha só a pedida.
    expect(plano('2026-08-01', { primeira: '2026-10-01' })).toEqual(['2026-08-01']);
  });
  it('recusa a cadeia acima do teto e aponta até onde fechar antes', () => {
    expect(plano('2026-10-01', { primeira: '2016-01-01' })).toBe('periodo-cadeia-longa');
    const r = planejarFechamentoPeriodo({
      competencia: '2026-10-01',
      atual: null,
      hoje: HOJE,
      ultimaFechada: null,
      primeiraComMovimento: '2016-01-01',
    });
    expect('recusa' in r && r.recusa.mensagem).toContain('12/2025');
    const cheio = plano('2026-10-01', { primeira: '2016-11-01' });
    expect(Array.isArray(cheio) && cheio.length).toBe(MESES_POR_FECHAMENTO);
  });
  it('próxima competência vira o ano', () => {
    expect(proximaCompetencia('2026-12-01')).toBe('2027-01-01');
  });
});

describe('período financeiro: reabertura pedida por um, decidida por outro', () => {
  const fechado = { competencia: '2026-09-01', situacao: 'fechado' as const };
  const J = 'Tarifa do banco lançada fora do mês';
  it('pede a reabertura do último fechado com justificativa', () => {
    expect(conferirPedidoReabertura(fechado, ['2026-08-01', '2026-09-01'], J, false)).toBeNull();
  });
  it('recusa o pedido do não fechado, com posterior fechado, sem justificativa ou com outro pendente', () => {
    expect(cod(conferirPedidoReabertura(null, [], J, false))).toBe('periodo-nao-fechado');
    expect(cod(conferirPedidoReabertura({ ...fechado, situacao: 'reaberto' }, [], J, false))).toBe(
      'periodo-nao-fechado',
    );
    expect(cod(conferirPedidoReabertura(fechado, ['2026-10-01'], J, false))).toBe(
      'periodo-posterior-fechado',
    );
    expect(cod(conferirPedidoReabertura(fechado, [], '  erro  ', false))).toBe('justificativa-obrigatoria');
    expect(cod(conferirPedidoReabertura(fechado, [], J, true))).toBe('pedido-reabertura-pendente');
  });
  it('a decisão exige pedido pendente e outro usuário', () => {
    const base = { atual: fechado, posterioresFechadas: [] as string[], decisor: 7 };
    expect(conferirDecisaoReabertura({ ...base, solicitante: 5 })).toBeNull();
    expect(cod(conferirDecisaoReabertura({ ...base, solicitante: 7 }))).toBe('autorizador-igual-solicitante');
    expect(cod(conferirDecisaoReabertura({ ...base, solicitante: null }))).toBe('sem-pedido-reabertura');
    expect(cod(conferirDecisaoReabertura({ ...base, atual: null, solicitante: 5 }))).toBe(
      'periodo-nao-fechado',
    );
    expect(
      cod(conferirDecisaoReabertura({ ...base, posterioresFechadas: ['2026-10-01'], solicitante: 5 })),
    ).toBe('periodo-posterior-fechado');
  });
});

describe('período financeiro: trava do lançamento retroativo', () => {
  it('recusa toda data até o fim da última fechada, não só a competência exata', () => {
    const r = conferirLancamentoNoPeriodo('2026-09-30', '2026-09-01');
    expect(cod(r)).toBe('periodo-fechado');
    expect(r?.campos).toEqual(['data']);
    expect(r?.mensagem).toContain('09/2026');
    // Mês anterior à última fechada, mesmo sem registro próprio.
    expect(cod(conferirLancamentoNoPeriodo('2026-03-15', '2026-09-01'))).toBe('periodo-fechado');
    expect(conferirLancamentoNoPeriodo('2026-10-01', '2026-09-01')).toBeNull();
    expect(conferirLancamentoNoPeriodo('2026-09-30', null)).toBeNull();
    expect(cod(conferirLancamentoNoPeriodo('2026-09-30', '2026-09-01', 'dataPagamento'))).toBe(
      'periodo-fechado',
    );
  });
  it('competência e fim do mês', () => {
    expect(competenciaDe('2026-02-17')).toBe('2026-02-01');
    expect(fimDaCompetencia('2026-02-01')).toBe('2026-02-28');
    expect(fimDaCompetencia('2028-02-01')).toBe('2028-02-29');
    expect(fimDaCompetencia('2026-12-01')).toBe('2026-12-31');
  });
});

describe('saldo diário por conta', () => {
  it('encadeia os dias com movimento a partir da abertura, em centavos', () => {
    const dias = calcularSaldosDiarios(100.1, [
      { data: '2026-09-03', natureza: 'debito', valor: 0.2 },
      { data: '2026-09-01', natureza: 'credito', valor: 0.1 },
      { data: '2026-09-01', natureza: 'credito', valor: 0.2 },
      { data: '2026-09-03', natureza: 'credito', valor: 50 },
    ]);
    expect(dias).toEqual([
      { data: '2026-09-01', saldoAnterior: 100.1, entradas: 0.3, saidas: 0, saldoFinal: 100.4 },
      { data: '2026-09-03', saldoAnterior: 100.4, entradas: 50, saidas: 0.2, saldoFinal: 150.2 },
    ]);
    expect(resumoDoPeriodo(100.1, dias)).toEqual({
      saldoInicial: 100.1,
      entradas: 50.3,
      saidas: 0.2,
      saldoFinal: 150.2,
    });
  });
  it('sem movimento: nenhum dia e o saldo final igual ao inicial', () => {
    expect(calcularSaldosDiarios(10, [])).toEqual([]);
    expect(resumoDoPeriodo(10, []).saldoFinal).toBe(10);
  });
});
