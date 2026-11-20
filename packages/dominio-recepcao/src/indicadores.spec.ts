import { describe, expect, it } from 'vitest';
import {
  esperaAte,
  esperasPorGuiche,
  esperasPorHora,
  maisAntigas,
  resumirEsperas,
  resumirFila,
} from './indicadores.js';

describe('esperas e painel do supervisor', () => {
  it('resumo das esperas (emissão → chamada, chamada → fim, por prioridade)', () => {
    const r = resumirEsperas([
      {
        prioridade: '2',
        emitidaEm: '2026-10-21T08:00:00Z',
        chamadaEm: '2026-10-21T08:10:00Z',
        concluidaEm: '2026-10-21T08:15:00Z',
      },
      {
        prioridade: '1',
        emitidaEm: '2026-10-21T08:00:00Z',
        chamadaEm: '2026-10-21T08:02:00Z',
        concluidaEm: null,
      },
      { prioridade: '2', emitidaEm: '2026-10-21T08:00:00Z', chamadaEm: null, concluidaEm: null },
      {
        prioridade: '2',
        emitidaEm: '2026-10-21T08:30:00Z',
        chamadaEm: '2026-10-21T08:20:00Z',
        concluidaEm: null,
      },
    ]);
    expect(r).toEqual({
      medidas: 2,
      chegadaChamadaMedia: 6,
      chamadaFimMedia: 5,
      prioritariasMedia: 2,
      normaisMedia: 10,
    });
    expect(resumirEsperas([])).toEqual({
      medidas: 0,
      chegadaChamadaMedia: null,
      chamadaFimMedia: null,
      prioritariasMedia: null,
      normaisMedia: null,
    });
  });

  it('espera até agora nunca negativa', () => {
    expect(esperaAte('2026-10-21T08:00:00Z', '2026-10-21T08:30:59Z')).toBe(30);
    expect(esperaAte('2026-10-21T09:00:00Z', '2026-10-21T08:30:00Z')).toBe(0);
  });

  it('resumo da fila com o tempo-alvo', () => {
    const f = resumirFila(
      [
        { prioridade: '2', emitidaEm: '2026-10-21T08:00:00Z' },
        { prioridade: '0', emitidaEm: '2026-10-21T08:20:00Z' },
        { prioridade: '2', emitidaEm: '2026-10-21T08:25:00Z' },
      ],
      '2026-10-21T08:30:00Z',
      20,
    );
    expect(f).toEqual({
      aguardando: 3,
      prioritarias: 1,
      esperaMediaMinutos: 15,
      maiorEsperaMinutos: 30,
      acimaDaMeta: 1,
    });
    expect(resumirFila([], '2026-10-21T08:30:00Z', 0)).toEqual({
      aguardando: 0,
      prioritarias: 0,
      esperaMediaMinutos: 0,
      maiorEsperaMinutos: 0,
      acimaDaMeta: 0,
    });
  });

  it('mais antigas', () => {
    const xs = [
      { id: 2, emitidaEm: '2026-10-21T08:00:00Z' },
      { id: 1, emitidaEm: '2026-10-21T08:00:00Z' },
      { id: 3, emitidaEm: '2026-10-21T07:00:00Z' },
    ];
    expect(maisAntigas(xs, 2).map((x) => x.id)).toEqual([3, 1]);
  });
  it('esperas por hora da emissão e por guichê da primeira chamada (os dois sistemas)', () => {
    const ts = [
      {
        prioridade: '2',
        emitidaEm: '2026-10-21T08:00:00',
        chamadaEm: '2026-10-21T08:10:00',
        concluidaEm: '2026-10-21T08:14:00',
        recepcao: 2,
        guiche: 1,
      },
      {
        prioridade: '2',
        emitidaEm: '2026-10-21T08:30:00',
        chamadaEm: '2026-10-21T08:34:00',
        concluidaEm: null,
        recepcao: 2,
        guiche: 1,
      },
      {
        prioridade: '1',
        emitidaEm: '2026-10-21T09:05:00',
        chamadaEm: '2026-10-21T09:07:00',
        concluidaEm: null,
        recepcao: 2,
        guiche: 3,
      },
      {
        prioridade: '2',
        emitidaEm: '2026-10-21T09:10:00',
        chamadaEm: null,
        concluidaEm: null,
        recepcao: 2,
        guiche: null,
      },
      {
        prioridade: '2',
        emitidaEm: '2026-10-21T10:00:00',
        chamadaEm: '2026-10-21T09:00:00',
        concluidaEm: null,
        recepcao: 2,
        guiche: 3,
      },
    ];
    expect(esperasPorHora(ts)).toEqual([
      { hora: 8, medidas: 2, esperaMedia: 7 },
      { hora: 9, medidas: 1, esperaMedia: 2 },
    ]);
    expect(esperasPorGuiche(ts)).toEqual([
      { recepcao: 2, guiche: 1, chamadas: 2, esperaMedia: 7, chamadaFimMedia: 4 },
      { recepcao: 2, guiche: 3, chamadas: 1, esperaMedia: 2, chamadaFimMedia: null },
    ]);
    expect(esperasPorGuiche([])).toEqual([]);
  });
});
