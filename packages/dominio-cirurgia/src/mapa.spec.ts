// Mapa do dia por sala com o alerta de sobreposição.
import { describe, expect, it } from 'vitest';
import { diasDaJanela, montarMapa, ocupacaoDaSala } from './mapa.js';

describe('mapa cirúrgico', () => {
  const ocup = [
    { id: 1, sala: 1, inicio: '2026-11-03 07:00', duracaoMin: 120, intervaloMin: 0 },
    { id: 2, sala: 1, inicio: '2026-11-03 08:00', duracaoMin: 60, intervaloMin: 0 },
    { id: 3, sala: 2, inicio: '2026-11-03 10:00', duracaoMin: 90, intervaloMin: 0 },
    { id: 4, sala: 2, inicio: '2026-11-04 10:00', duracaoMin: 90, intervaloMin: 0 },
  ];
  it('monta os blocos do dia por sala e marca os sobrepostos', () => {
    const m = montarMapa('2026-11-03', [1, 2, 3], ocup);
    expect(m.abertura).toBe('07:00');
    expect(m.fechamento).toBe('21:00');
    expect(m.sobreposicoes).toBe(1);
    expect(m.salas[0]!.blocos.map((b) => [b.id, b.topo, b.altura, b.sobreposto])).toEqual([
      [1, 0, 120, true],
      [2, 60, 60, true],
    ]);
    expect(m.salas[1]!.blocos[0]).toMatchObject({ id: 3, fim: '2026-11-03 11:30', sobreposto: false });
    expect(m.salas[2]!.blocos).toEqual([]);
    expect(montarMapa('2026-11-03', [1], ocup, 0, 'xx').abertura).toBe('07:00');
  });
  it('janela de até 7 dias e ocupação da sala no turno', () => {
    expect(diasDaJanela('2026-11-03', 3)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
    expect(diasDaJanela('2026-11-03', 30)).toHaveLength(7);
    expect(diasDaJanela('2026-11-03', 0)).toEqual(['2026-11-03']);
    expect(ocupacaoDaSala([{ topo: 0, altura: 420 }])).toBe(50);
    expect(ocupacaoDaSala([{ topo: -60, altura: 120 }], 600)).toBe(10);
    expect(ocupacaoDaSala([], 0)).toBe(0);
  });
});
