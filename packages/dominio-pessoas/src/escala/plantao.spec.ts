// Forma do plantão (M52.2): dentro da competência, de 1 h a 24 h, sobreaviso com tempo de chegada.
import { describe, expect, it } from 'vitest';
import { conferirFormaDoPlantao, type PlantaoProposto } from './plantao.js';

const p = (x: Partial<PlantaoProposto> = {}): PlantaoProposto => ({
  tipo: 'presencial',
  inicio: '2026-11-02T07:00',
  fim: '2026-11-02T19:00',
  chegadaMin: null,
  ...x,
});
const codigo = (x: Partial<PlantaoProposto>, comp = '2026-11') => {
  const r = conferirFormaDoPlantao(p(x), comp);
  return r.ok ? 'ok' : r.codigo;
};

describe('forma do plantão', () => {
  it('aceita o plantão de 12 h e o noturno do último dia (termina no mês seguinte)', () => {
    expect(codigo({})).toBe('ok');
    expect(codigo({ inicio: '2026-11-30T19:00', fim: '2026-12-01T07:00' })).toBe('ok');
  });
  it('recusa fora da competência, fim antes do início, curto, longo', () => {
    expect(codigo({ inicio: '2026-10-31T19:00', fim: '2026-11-01T07:00' })).toBe('fora-da-competencia');
    expect(codigo({ fim: '2026-11-02T07:00' })).toBe('fim-antes-do-inicio');
    expect(codigo({ fim: '2026-11-02T07:59' })).toBe('plantao-curto');
    expect(codigo({ fim: '2026-11-03T07:01' })).toBe('plantao-longo');
    expect(codigo({ fim: '2026-11-03T07:00' })).toBe('ok');
  });
  it('sobreaviso pede o tempo de chegada; os outros não aceitam', () => {
    expect(codigo({ tipo: 'sobreaviso' })).toBe('sem-chegada');
    expect(codigo({ tipo: 'sobreaviso', chegadaMin: 0 })).toBe('sem-chegada');
    expect(codigo({ tipo: 'sobreaviso', chegadaMin: 30 })).toBe('ok');
    expect(codigo({ chegadaMin: 30 })).toBe('chegada-fora-do-sobreaviso');
  });
});
