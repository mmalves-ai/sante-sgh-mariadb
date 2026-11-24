import { describe, expect, it } from 'vitest';
import {
  calcularSaldosDiarios,
  competenciaDe,
  conferirFechamentoPeriodo,
  conferirLancamentoNoPeriodo,
  conferirReaberturaPeriodo,
  fimDaCompetencia,
  resumoDoPeriodo,
} from './periodo-financeiro.js';

const cod = (r: { codigo: string } | null) => r?.codigo ?? null;
const HOJE = '2026-11-24';

describe('período financeiro: fechamento', () => {
  it('fecha o mês terminado ainda aberto', () => {
    expect(conferirFechamentoPeriodo('2026-10-01', null, HOJE, [])).toBeNull();
    expect(
      conferirFechamentoPeriodo('2026-10-01', { competencia: '2026-10-01', situacao: 'reaberto' }, HOJE, []),
    ).toBeNull();
  });
  it('recusa o mês em curso, o futuro e a competência fora do primeiro dia', () => {
    expect(cod(conferirFechamentoPeriodo('2026-11-01', null, HOJE, []))).toBe('periodo-em-curso');
    expect(cod(conferirFechamentoPeriodo('2027-01-01', null, HOJE, []))).toBe('periodo-em-curso');
    expect(cod(conferirFechamentoPeriodo('2026-10-15', null, HOJE, []))).toBe('competencia-invalida');
  });
  it('recusa o já fechado e o que tem mês anterior aberto', () => {
    expect(
      cod(
        conferirFechamentoPeriodo('2026-10-01', { competencia: '2026-10-01', situacao: 'fechado' }, HOJE, []),
      ),
    ).toBe('periodo-ja-fechado');
    const r = conferirFechamentoPeriodo('2026-10-01', null, HOJE, ['2026-08-01', '2026-09-01']);
    expect(cod(r)).toBe('periodo-anterior-aberto');
    expect(r?.mensagem).toContain('08/2026');
    expect(conferirFechamentoPeriodo('2026-10-01', null, HOJE, ['2026-10-01'])).toBeNull();
  });
});

describe('período financeiro: reabertura', () => {
  const fechado = { competencia: '2026-09-01', situacao: 'fechado' as const };
  const J = 'Tarifa do banco lançada fora do mês';
  it('reabre o último fechado com justificativa', () => {
    expect(conferirReaberturaPeriodo(fechado, ['2026-08-01', '2026-09-01'], J)).toBeNull();
  });
  it('recusa o não fechado, o que tem posterior fechado e a falta de justificativa', () => {
    expect(cod(conferirReaberturaPeriodo(null, [], J))).toBe('periodo-nao-fechado');
    expect(cod(conferirReaberturaPeriodo({ ...fechado, situacao: 'reaberto' }, [], J))).toBe(
      'periodo-nao-fechado',
    );
    expect(cod(conferirReaberturaPeriodo(fechado, ['2026-10-01'], J))).toBe('periodo-posterior-fechado');
    expect(cod(conferirReaberturaPeriodo(fechado, [], '  erro  '))).toBe('justificativa-obrigatoria');
  });
});

describe('período financeiro: trava do lançamento retroativo', () => {
  it('recusa a data de competência fechada e aceita a aberta ou reaberta', () => {
    const r = conferirLancamentoNoPeriodo('2026-09-30', 'fechado');
    expect(cod(r)).toBe('periodo-fechado');
    expect(r?.campos).toEqual(['data']);
    expect(conferirLancamentoNoPeriodo('2026-09-30', 'reaberto')).toBeNull();
    expect(conferirLancamentoNoPeriodo('2026-09-30', null)).toBeNull();
    expect(cod(conferirLancamentoNoPeriodo('2026-09-30', 'fechado', 'dataPagamento'))).toBe(
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
