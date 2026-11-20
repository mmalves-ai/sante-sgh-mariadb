import { describe, expect, it } from 'vitest';
import {
  agentesAtivos,
  conferirNovaAlergia,
  hashDaAlergia,
  situacaoDasAlergias,
  situacaoDasAlergiasDoResumo,
  versaoDasAlergias,
} from './alergia.js';

const a = (id: number, agenteId: number, ativa: boolean, em: string | null = '2026-10-01T10:00:00') => ({
  id,
  agenteId,
  agente: `AGENTE ${agenteId}`,
  ativa,
  registradaEm: em,
});

describe('alergias (regra 4)', () => {
  it('situação pelo resumo da linha (painel e fila do médico)', () => {
    expect(situacaoDasAlergiasDoResumo(2, undefined, '2026-10-05T00:00:00')).toBe('lista');
    expect(situacaoDasAlergiasDoResumo(0, undefined, undefined)).toBe('nao-avaliadas');
    expect(situacaoDasAlergiasDoResumo(0, undefined, '2026-10-05T00:00:00')).toBe('nega');
    expect(situacaoDasAlergiasDoResumo(0, '2026-10-01T00:00:00', '2026-10-05T00:00:00')).toBe('nega');
    expect(situacaoDasAlergiasDoResumo(0, '2026-10-06T00:00:00', '2026-10-05T00:00:00')).toBe(
      'nao-avaliadas',
    );
  });
  it('situação do cabeçalho em três estados', () => {
    expect(situacaoDasAlergias([], [])).toBe('nao-avaliadas');
    expect(situacaoDasAlergias([a(1, 1, true)], [{ em: '2026-10-02T00:00:00' }])).toBe('lista');
    expect(situacaoDasAlergias([], [{ em: '2026-10-02T00:00:00' }])).toBe('nega');
    // Nega antigo, alergia registrada (e retirada) depois: não avaliadas de novo.
    expect(
      situacaoDasAlergias([a(1, 1, false, '2026-10-05T00:00:00')], [{ em: '2026-10-01T00:00:00' }]),
    ).toBe('nao-avaliadas');
    expect(
      situacaoDasAlergias([a(1, 1, false, '2026-10-01T00:00:00')], [{ em: '2026-10-05T00:00:00' }]),
    ).toBe('nega');
    expect(situacaoDasAlergias([a(1, 1, false, null)], [{ em: '2026-10-05T00:00:00' }])).toBe('nega');
  });

  it('versão da lista ativa (controle otimista) e agentes para a prescrição', () => {
    expect(versaoDasAlergias([a(3, 1, true), a(2, 5, true), a(9, 7, false)])).toBe('2,3');
    expect(agentesAtivos([a(3, 1, true), a(2, 5, true), a(4, 5, true), a(9, 7, false)])).toEqual([1, 5]);
  });

  it('inclusão: duplicada, nega com ativa, agente inativo', () => {
    const ativos = new Set([1, 2]);
    expect(conferirNovaAlergia({ nega: false, agente: 1 }, [a(1, 1, true)], ativos).codigo).toBe('duplicada');
    expect(conferirNovaAlergia({ nega: true }, [a(1, 1, true)], ativos).codigo).toBe('nega-com-ativa');
    expect(conferirNovaAlergia({ nega: false, agente: 9 }, [], ativos).codigo).toBe('agente-inativo');
    expect(conferirNovaAlergia({ nega: false }, [], ativos).codigo).toBe('agente-inativo');
    expect(conferirNovaAlergia({ nega: false, agente: 2 }, [a(1, 1, true), a(5, 2, false)], ativos).ok).toBe(
      true,
    );
    expect(conferirNovaAlergia({ nega: true }, [a(5, 2, false)], ativos).ok).toBe(true);
  });

  it('hash estável (princípios em qualquer ordem)', async () => {
    const base = {
      paciente: 1,
      registro: 2,
      nega: false,
      agente: 3,
      reacao: 'URTICARIA',
      gravidade: 'leve',
      origem: 'relato-paciente',
    };
    expect(await hashDaAlergia({ ...base, principios: [5, 4] })).toBe(
      await hashDaAlergia({ ...base, principios: [4, 5] }),
    );
    expect(await hashDaAlergia({ ...base, principios: [4] })).toMatch(/^[0-9a-f]{64}$/);
  });
});
