// Regras puras do painel de indicadores de pessoas: o que conta como ausência, as horas do fechamento (com e sem
// apuração diária), a lotação na data do fato com rateio e lotação principal, e os limites do dia no fuso. Sintético.
import { describe, expect, it } from 'vitest';
import {
  contaComoAusencia,
  dataNoFuso,
  horasDoFechamento,
  indexarLotacoes,
  inicioDoDiaNoFuso,
  setoresNaData,
  setorPrincipalNaData,
  somarPorSetor,
} from './apropriacao-indicadores.js';

describe('apropriação dos indicadores de pessoas', () => {
  it('ausência: débito/atraso e falta (abonada ou não) e o abono; nunca o informativo nem a extra', () => {
    expect(contaComoAusencia('falta', 'descontado')).toBe(true);
    expect(contaComoAusencia('falta', 'abonado')).toBe(true);
    expect(contaComoAusencia('abono', 'abonado')).toBe(true);
    expect(contaComoAusencia('falta', 'banco_horas')).toBe(true);
    expect(contaComoAusencia('falta', 'informativo')).toBe(false);
    expect(contaComoAusencia('extra', 'folha')).toBe(false);
    expect(contaComoAusencia('normal', 'folha')).toBe(false);
  });

  it('horas do fechamento: com apuração diária vêm dos dias; sem ela, estimadas pelas horas consolidadas', () => {
    const f = {
      horasTrabalhadas: 190,
      horasExtras: 5,
      horasFalta: 4,
      diasApurados: 22,
      minutosPrevistos: 12_000,
      minutosAusencia: 660,
    };
    expect(horasDoFechamento(f)).toEqual({
      previstas: 200,
      trabalhadas: 190,
      ausencia: 11,
      extras: 5,
      apurado: true,
    });
    expect(horasDoFechamento({ ...f, diasApurados: 0 })).toEqual({
      previstas: 189,
      trabalhadas: 190,
      ausencia: 4,
      extras: 5,
      apurado: false,
    });
  });

  const idx = indexarLotacoes([
    { vinculo: 1, setor: 20, inicio: '2025-01-01', fim: '2026-02-14', percentual: 100 },
    { vinculo: 1, setor: 30, inicio: '2026-02-15', fim: null, percentual: 100 },
    { vinculo: 2, setor: 20, inicio: '2025-01-01', fim: null, percentual: 60 },
    { vinculo: 2, setor: 30, inicio: '2025-01-01', fim: null, percentual: 40 },
    { vinculo: 3, setor: 20, inicio: '2025-01-01', fim: null, percentual: 30 },
    { vinculo: 3, setor: 20, inicio: '2025-06-01', fim: null, percentual: 30 },
  ]);

  it('o setor do fato é o da lotação vigente na data; sem lotação, o do cadastro', () => {
    expect(setoresNaData(idx, 1, '2026-01-01', 99)).toEqual([{ setor: 20, peso: 1 }]);
    expect(setoresNaData(idx, 1, '2026-02-15', 99)).toEqual([{ setor: 30, peso: 1 }]);
    expect(setoresNaData(idx, 1, '2024-12-31', 99)).toEqual([{ setor: 99, peso: 1 }]);
    expect(setoresNaData(idx, null, '2026-01-01', null)).toEqual([{ setor: null, peso: 1 }]);
    expect(setoresNaData(idx, 2, '2026-01-01', 99)).toEqual([
      { setor: 20, peso: 0.6 },
      { setor: 30, peso: 0.4 },
    ]);
    // Duas lotações simultâneas no mesmo setor (centros de custo diferentes) somam e normalizam.
    expect(setoresNaData(idx, 3, '2026-01-01', 99)).toEqual([{ setor: 20, peso: 1 }]);
  });

  it('contagem vai inteira à lotação principal (maior percentual)', () => {
    expect(setorPrincipalNaData(idx, 2, '2026-01-01', 99)).toBe(20);
    expect(setorPrincipalNaData(idx, 1, '2026-03-01', 99)).toBe(30);
    expect(setorPrincipalNaData(idx, 7, '2026-03-01', 99)).toBe(99);
  });

  it('soma por setor com rateio e recorte do setor pedido', () => {
    const fatos = [
      { setores: setoresNaData(idx, 2, '2026-01-01', null), valores: { h: 100 } },
      { setores: setoresNaData(idx, 1, '2026-01-01', null), valores: { h: 10 } },
    ];
    expect([...somarPorSetor(fatos, ['h'], null)]).toEqual([
      [20, { h: 70 }],
      [30, { h: 40 }],
    ]);
    expect([...somarPorSetor(fatos, ['h'], 30)]).toEqual([[30, { h: 40 }]]);
  });

  it('meia-noite local em UTC, com horário de verão; data civil no fuso', () => {
    expect(inicioDoDiaNoFuso('2026-04-01', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-04-01T03:00:00.000Z',
    );
    expect(inicioDoDiaNoFuso('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(inicioDoDiaNoFuso('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
    expect(inicioDoDiaNoFuso('2026-04-01', 'Fuso/Inexistente').toISOString()).toBe(
      '2026-04-01T03:00:00.000Z',
    );
    expect(dataNoFuso(new Date('2026-04-01T02:30:00Z'), 'America/Sao_Paulo')).toBe('2026-03-31');
  });
});
