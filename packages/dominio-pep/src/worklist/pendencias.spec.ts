// Regras 1 e 4 do M27: resultado novo e crítico não visto até a visualização ou a ciência (inclusive os liberados no
// outro sistema) e a ordem da fila por prioridade e prazo.
import type { PendenciaMedico } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  contarResultados,
  ordenarWorklistMedico,
  prazoMaisProximo,
  prioridadeDasPendencias,
  resultadoVisto,
} from './pendencias.js';

const r = (o: Partial<Parameters<typeof resultadoVisto>[0]> = {}) => ({
  exame: 1,
  liberadoEm: '2026-10-22T08:00:00',
  critico: false,
  visualizadoNoOutroSistema: false,
  vistoPeloMedico: false,
  ciencia: false,
  ...o,
});
const p = (tipo: PendenciaMedico['tipo'], quantidade = 1, prazo: string | null = null): PendenciaMedico => ({
  tipo,
  quantidade,
  prazo,
  texto: '',
  link: '/pep',
});

describe('resultado novo e crítico não visto', () => {
  it('liberado no outro sistema e ainda não visto: novo; o crítico conta à parte', () => {
    expect(contarResultados([r({ exame: 1 }), r({ exame: 2, critico: true })])).toEqual({
      novos: 1,
      criticos: 1,
    });
  });
  it('a visualização (no outro sistema ou pelo médico no novo) tira a marca', () => {
    expect(
      contarResultados([
        r({ exame: 1, visualizadoNoOutroSistema: true }),
        r({ exame: 2, critico: true, vistoPeloMedico: true }),
      ]),
    ).toEqual({ novos: 0, criticos: 0 });
  });
  it('a ciência tira a marca do crítico; sem liberação, nada conta', () => {
    expect(contarResultados([r({ critico: true, ciencia: true }), r({ liberadoEm: null })])).toEqual({
      novos: 0,
      criticos: 0,
    });
  });
});

describe('ordem da fila (prioridade e prazo)', () => {
  it('a prioridade é a soma dos pesos das pendências presentes (a quantidade não multiplica)', () => {
    expect(prioridadeDasPendencias([p('critico-nao-visto', 3), p('assinatura-pendente', 9)])).toBe(110);
    expect(prioridadeDasPendencias([p('resultado-novo', 0)])).toBe(0);
  });
  it('o prazo mais próximo', () => {
    expect(
      prazoMaisProximo([
        p('prescricao-a-renovar', 1, '2026-10-22T14:00'),
        p('parecer-atrasado', 1, '2026-10-22T09:00'),
      ]),
    ).toBe('2026-10-22T09:00');
    expect(prazoMaisProximo([p('resultado-novo')])).toBeNull();
  });
  it('ordena por prioridade, depois prazo (sem prazo por último), leito e nome', () => {
    const l = (
      paciente: number,
      prioridade: number,
      prazo: string | null,
      leito: string | null,
      nome = 'X',
    ) => ({
      paciente,
      prioridade,
      prazo,
      leito,
      nome,
    });
    const o = ordenarWorklistMedico([
      l(1, 10, null, '102'),
      l(2, 100, '2026-10-22T15:00', '201'),
      l(3, 100, '2026-10-22T09:00', '305'),
      l(4, 10, '2026-10-22T10:00', '101'),
      l(5, 10, null, '10', 'A'),
      l(6, 10, null, null, 'B'),
    ]);
    expect(o.map((x) => x.paciente)).toEqual([3, 2, 4, 5, 1, 6]);
  });
});
