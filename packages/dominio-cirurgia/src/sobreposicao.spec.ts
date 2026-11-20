// Sobreposição na sala com o intervalo de preparo (regra 5). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  conflitosNaSala,
  cruzam,
  idsSobrepostos,
  janelaOcupada,
  type OcupacaoSala,
  proximoInicioLivre,
  sobreposicoesNoMapa,
} from './sobreposicao.js';

const o = (id: number, inicio: string, duracaoMin: number, sala = 1, intervaloMin = 0): OcupacaoSala => ({
  id,
  sala,
  inicio,
  duracaoMin,
  intervaloMin,
});

describe('janela e cruzamento', () => {
  it('a janela vai do início ao fim da duração mais o maior preparo', () => {
    const j = janelaOcupada(o(1, '2026-11-03 07:00', 60, 1, 10), 20);
    expect(j.ate - j.de).toBe(80);
    expect(
      janelaOcupada(o(1, '2026-11-03 07:00', 0)).ate - janelaOcupada(o(1, '2026-11-03 07:00', 0)).de,
    ).toBe(1);
    expect(cruzam({ de: 0, ate: 10 }, { de: 10, ate: 20 })).toBe(false);
    expect(cruzam({ de: 0, ate: 11 }, { de: 10, ate: 20 })).toBe(true);
  });
});

describe('conflitos na sala', () => {
  const mapa = [
    o(10, '2026-11-03 07:00', 60),
    o(11, '2026-11-03 09:00', 120),
    o(12, '2026-11-03 08:00', 60, 2),
    o(13, '3203-10-02 08:00', 60),
  ];
  it('encostado não conflita; cruzado conflita; outra sala e data impossível não contam', () => {
    expect(conflitosNaSala(o(-1, '2026-11-03 08:00', 60), mapa)).toEqual([]);
    expect(conflitosNaSala(o(-1, '2026-11-03 08:30', 60), mapa).map((c) => c.com)).toEqual([11]);
    expect(conflitosNaSala(o(-1, '2026-11-03 06:30', 300), mapa).map((c) => c.com)).toEqual([10, 11]);
  });
  it('o preparo mínimo transforma o encostado em conflito', () => {
    expect(conflitosNaSala(o(-1, '2026-11-03 08:00', 60), mapa, 15).map((c) => c.com)).toEqual([10, 11]);
  });
  it('na remarcação o próprio agendamento não conflita consigo', () => {
    expect(conflitosNaSala(o(11, '2026-11-03 09:30', 60), mapa)).toEqual([]);
  });
});

describe('sobreposições já gravadas e próximo livre', () => {
  it('acha os pares sobrepostos do outro sistema', () => {
    const pares = sobreposicoesNoMapa([
      o(1, '2026-11-03 07:00', 120),
      o(2, '2026-11-03 08:00', 60),
      o(3, '2026-11-03 08:30', 60),
      o(4, '2026-11-03 07:00', 60, 2),
      o(5, '3203-01-01 07:00', 60),
    ]);
    expect(pares).toEqual([
      { sala: 1, a: 1, b: 2 },
      { sala: 1, a: 1, b: 3 },
      { sala: 1, a: 2, b: 3 },
    ]);
    expect([...idsSobrepostos(pares)].sort()).toEqual([1, 2, 3]);
  });
  it('próximo início livre no passo de 15 minutos; dia cheio devolve null', () => {
    const mapa = [o(1, '2026-11-03 07:00', 60), o(2, '2026-11-03 08:15', 60)];
    expect(proximoInicioLivre(1, '2026-11-03 07:00', 15, mapa)).toBe('2026-11-03 08:00');
    expect(proximoInicioLivre(1, '2026-11-03 07:00', 120, mapa)).toBe('2026-11-03 09:15');
    expect(proximoInicioLivre(1, '2026-11-03 07:00', 30, [o(9, '2026-11-03 00:00', 1439)])).toBeNull();
  });
});
