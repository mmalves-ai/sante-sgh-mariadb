import { describe, expect, it } from 'vitest';
import {
  ordenarFila,
  parecerAtrasado,
  podeResponder,
  PRAZO_PADRAO_HORAS,
  prazoDoParecer,
  transicaoParecer,
} from './interconsulta.js';

describe('parecer e interconsulta (regra 10)', () => {
  it('máquina de situação', () => {
    expect(transicaoParecer('solicitado', 'aceitar')).toEqual({ ok: true, situacao: 'aceito', motivo: null });
    expect(transicaoParecer('aceito', 'responder').situacao).toBe('respondido');
    expect(transicaoParecer('solicitado', 'responder').situacao).toBe('respondido');
    expect(transicaoParecer('aceito', 'cancelar').situacao).toBe('cancelado');
    expect(transicaoParecer('respondido', 'cancelar').motivo).toMatch(/respondido/);
    expect(transicaoParecer('cancelado', 'aceitar').motivo).toMatch(/cancelado/);
    expect(transicaoParecer('aceito', 'aceitar').motivo).toMatch(/Não é possível/);
  });

  it('prazo e atraso', () => {
    const t0 = new Date('2026-10-21T10:00:00Z');
    expect(prazoDoParecer(t0, 'urgente').toISOString()).toBe('2026-10-21T12:00:00.000Z');
    expect(prazoDoParecer(t0, 'rotina', 6).toISOString()).toBe('2026-10-21T16:00:00.000Z');
    expect(PRAZO_PADRAO_HORAS.prioritario).toBe(12);
    const prazo = new Date('2026-10-21T12:00:00Z');
    expect(parecerAtrasado('solicitado', prazo, new Date('2026-10-21T13:00:00Z'))).toBe(true);
    expect(parecerAtrasado('respondido', prazo, new Date('2026-10-21T13:00:00Z'))).toBe(false);
    expect(parecerAtrasado('aceito', null, new Date())).toBe(false);
    expect(parecerAtrasado('aceito', prazo, new Date('2026-10-21T11:00:00Z'))).toBe(false);
  });

  it('fila por prioridade e prazo', () => {
    const f = ordenarFila([
      { id: 1, prioridade: 'rotina' as const, prazo: '2026-10-22T10:00', pedidoEm: '2026-10-20T10:00' },
      { id: 2, prioridade: 'urgente' as const, prazo: '2026-10-21T12:00', pedidoEm: '2026-10-21T10:00' },
      { id: 3, prioridade: 'rotina' as const, prazo: '2026-10-21T18:00', pedidoEm: '2026-10-21T09:00' },
      { id: 4, prioridade: 'rotina' as const, prazo: null, pedidoEm: '2026-10-19T09:00' },
      { id: 5, prioridade: 'rotina' as const, prazo: null, pedidoEm: '2026-10-18T09:00' },
    ]);
    expect(f.map((x) => x.id)).toEqual([2, 3, 1, 5, 4]);
  });

  it('quem responde: a especialidade ou a categoria pedida', () => {
    expect(
      podeResponder({ especialidade: 10, categoria: null }, { especialidades: [10], categoria: 'medico' }),
    ).toBe(true);
    expect(
      podeResponder({ especialidade: 10, categoria: null }, { especialidades: [11], categoria: 'medico' }),
    ).toBe(false);
    expect(
      podeResponder(
        { especialidade: null, categoria: 'nutricao' },
        { especialidades: [], categoria: 'nutricao' },
      ),
    ).toBe(true);
    expect(
      podeResponder({ especialidade: null, categoria: null }, { especialidades: [], categoria: 'medico' }),
    ).toBe(false);
  });
});
