// Ficha do M44, regra 9 (mina M41, regra 13): o prazo pela prioridade, o estouro e a ordem da fila.
import { describe, expect, it } from 'vitest';
import {
  contagemPorEstado,
  minutosDeEspera,
  ordemDaPrioridade,
  ordenarFilaNir,
  PRAZOS_PADRAO_NIR,
  prazoDaSolicitacao,
  prazoEstourado,
} from './fila.js';

describe('fila priorizada do NIR', () => {
  it('o prazo é a hora do pedido mais o prazo da prioridade (parâmetro ou padrão)', () => {
    expect(PRAZOS_PADRAO_NIR).toEqual({ emergencia: 60, urgente: 240, prioritario: 720, eletivo: 2880 });
    expect(prazoDaSolicitacao('2026-10-24T10:00:00', 'emergencia', PRAZOS_PADRAO_NIR)).toBe(
      '2026-10-24T11:00:00',
    );
    expect(prazoDaSolicitacao('2026-10-24T10:00:00', 'urgente', { ...PRAZOS_PADRAO_NIR, urgente: 90 })).toBe(
      '2026-10-24T11:30:00',
    );
    expect(minutosDeEspera('2026-10-24T10:00:00', '2026-10-24T10:45:30')).toBe(45);
    expect(minutosDeEspera('2026-10-24T10:00:00', '2026-10-24T09:00:00')).toBe(0);
    expect(ordemDaPrioridade('eletivo')).toBe(4);
  });

  it('estoura só quem ainda espera leito (sem reserva)', () => {
    const prazoEm = '2026-10-24T11:00:00';
    expect(prazoEstourado({ estado: 'em_analise', prazoEm }, '2026-10-24T11:01:00')).toBe(true);
    expect(prazoEstourado({ estado: 'solicitado', prazoEm }, '2026-10-24T10:59:00')).toBe(false);
    expect(prazoEstourado({ estado: 'reservado', prazoEm }, '2026-10-24T12:00:00')).toBe(false);
  });

  it('a ordem: prioridade, estourados, espera, número', () => {
    const agora = '2026-10-24T12:00:00';
    const f = ordenarFilaNir(
      [
        {
          id: 1,
          prioridade: 'urgente',
          estado: 'em_analise',
          solicitadoEm: '2026-10-24T11:00:00',
          prazoEm: '2026-10-24T15:00:00',
        },
        {
          id: 2,
          prioridade: 'urgente',
          estado: 'em_analise',
          solicitadoEm: '2026-10-24T11:30:00',
          prazoEm: '2026-10-24T11:40:00',
        },
        {
          id: 3,
          prioridade: 'emergencia',
          estado: 'solicitado',
          solicitadoEm: '2026-10-24T11:55:00',
          prazoEm: '2026-10-24T12:55:00',
        },
        {
          id: 4,
          prioridade: 'urgente',
          estado: 'em_analise',
          solicitadoEm: '2026-10-24T11:00:00',
          prazoEm: '2026-10-24T15:00:00',
        },
        {
          id: 5,
          prioridade: 'eletivo',
          estado: 'solicitado',
          solicitadoEm: '2026-10-23T08:00:00',
          prazoEm: '2026-10-25T08:00:00',
        },
      ],
      agora,
    );
    expect(f.map((x) => x.id)).toEqual([3, 2, 1, 4, 5]);
    expect(contagemPorEstado(f)).toEqual({ em_analise: 3, solicitado: 2 });
  });
});
