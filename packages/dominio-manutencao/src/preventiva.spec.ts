// Regra 2 do M55: plano preventivo, calibração e segurança elétrica com laudo; a vencida aparece no painel. Dados
// sintéticos.
import { describe, expect, it } from 'vitest';
import {
  exigeLaudo,
  ordenarPainel,
  planejarExecucao,
  resumoPainel,
  situacaoDoPlano,
  somarPeriodo,
  type ItemDoPainel,
  type PedidoExecucao,
} from './preventiva.js';

describe('próxima execução e situação no painel', () => {
  const plano = {
    dataBase: '2026-01-31',
    periodicidade: { quantidade: 1, unidade: 'meses' as const },
    ultimaExecucao: null,
    antecedenciaDias: null,
  };

  it('antes da primeira execução, a próxima é a data base', () => {
    expect(situacaoDoPlano(plano, '2026-01-20', 15)).toEqual({
      proxima: '2026-01-31',
      situacao: 'aVencer',
      diasParaVencer: 11,
    });
    expect(situacaoDoPlano(plano, '2026-02-01', 15)).toMatchObject({
      situacao: 'vencida',
      diasParaVencer: -1,
    });
  });

  it('depois, conta da última execução (mês curto vai ao último dia)', () => {
    const p = { ...plano, ultimaExecucao: '2026-01-31' };
    expect(situacaoDoPlano(p, '2026-02-01', 15)).toEqual({
      proxima: '2026-02-28',
      situacao: 'emDia',
      diasParaVencer: 27,
    });
    expect(situacaoDoPlano({ ...p, antecedenciaDias: 30 }, '2026-02-01', 15).situacao).toBe('aVencer');
    expect(situacaoDoPlano(p, '2026-02-28', 0).situacao).toBe('aVencer');
  });

  it('periodicidade em dias; inválida falha', () => {
    expect(somarPeriodo('2026-10-01', { quantidade: 90, unidade: 'dias' })).toBe('2026-12-30');
    expect(() => somarPeriodo('2026-10-01', { quantidade: 0, unidade: 'dias' })).toThrow();
  });
});

describe('execução com laudo', () => {
  const base: PedidoExecucao = {
    atividade: 'calibracao',
    data: '2026-10-20',
    hoje: '2026-10-24',
    resultado: 'aprovado',
    laudo: 77,
    ultimaExecucao: '2025-10-20',
    equipamentoDesativado: false,
  };

  it('calibração e segurança elétrica exigem laudo; preventiva e inspeção não', () => {
    expect(exigeLaudo('segurancaEletrica')).toBe(true);
    expect(exigeLaudo('preventiva')).toBe(false);
    expect(planejarExecucao({ ...base, laudo: null })).toMatchObject({
      ok: false,
      recusa: 'laudo-obrigatorio',
    });
    expect(planejarExecucao({ ...base, atividade: 'inspecao', laudo: null })).toEqual({
      ok: true,
      abrirCorretiva: false,
      registrarParada: false,
    });
  });

  it('reprovado deixa o equipamento parado e pede a corretiva', () => {
    expect(planejarExecucao({ ...base, resultado: 'reprovado' })).toEqual({
      ok: true,
      abrirCorretiva: true,
      registrarParada: true,
    });
    expect(planejarExecucao({ ...base, resultado: 'aprovadoComRestricao' })).toMatchObject({
      abrirCorretiva: false,
    });
  });

  it.each([
    [{ data: '2026-10-25' }, 'data-futura'],
    [{ ultimaExecucao: '2026-10-21' }, 'antes-da-ultima'],
    [{ equipamentoDesativado: true }, 'equipamento-desativado'],
  ])('recusa %o com %s', (extra, codigo) => {
    expect(planejarExecucao({ ...base, ...extra })).toMatchObject({ ok: false, recusa: codigo });
  });
});

describe('painel', () => {
  const item = (
    plano: number,
    situacao: 'vencida' | 'aVencer' | 'emDia',
    dias: number,
    criticidade: ItemDoPainel['criticidade'],
  ): ItemDoPainel => ({
    plano,
    criticidade,
    situacao: { proxima: '2026-10-24', situacao, diasParaVencer: dias },
  });

  it('vencidas primeiro, a mais atrasada e a mais crítica antes; com o resumo', () => {
    const itens = [
      item(1, 'emDia', 40, 'critica'),
      item(2, 'vencida', -2, 'baixa'),
      item(3, 'vencida', -10, 'media'),
      item(4, 'aVencer', 5, 'alta'),
      item(5, 'vencida', -2, 'critica'),
      item(6, 'vencida', -2, 'critica'),
    ];
    expect(ordenarPainel(itens).map((i) => i.plano)).toEqual([3, 5, 6, 2, 4, 1]);
    expect(resumoPainel(itens)).toEqual({ vencida: 4, aVencer: 1, emDia: 1 });
  });
});
