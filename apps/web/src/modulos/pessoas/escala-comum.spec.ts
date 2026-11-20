// Comuns da escala (M52.2): competência seguinte, fim do plantão que atravessa a meia-noite e os rótulos da grade.
import { describe, expect, it } from 'vitest';
import {
  descricaoPlantao,
  diaDaSemana,
  fimDoPlantao,
  horasTexto,
  inteiroDe,
  proximaCompetencia,
  rotuloCelula,
} from './escala-comum.js';

describe('comuns da escala', () => {
  it('competência seguinte e o fim do plantão', () => {
    expect(proximaCompetencia('2026-10-25')).toBe('2026-11');
    expect(proximaCompetencia('2026-12-31')).toBe('2027-01');
    expect(fimDoPlantao('2026-11-30', '19:00', 720)).toBe('2026-12-01T07:00');
    expect(fimDoPlantao('2026-11-02', '07:30', 360)).toBe('2026-11-02T13:30');
  });

  it('rótulos da grade e textos', () => {
    const p = { tipo: 'sobreaviso' as const, inicio: '2026-11-02T19:00', fim: '2026-11-03T07:30' };
    expect(rotuloCelula(p)).toBe('19h–07h30 S');
    expect(rotuloCelula({ ...p, tipo: 'presencial' })).toBe('19h–07h30');
    expect(rotuloCelula({ ...p, tipo: 'diarista' })).toBe('19h–07h30 D');
    expect(descricaoPlantao(p)).toBe('Sobreaviso de 02/11 19:00 a 03/11 07:30');
    expect(diaDaSemana('2026-11-02')).toBe('seg');
    expect(horasTexto(660)).toBe('11 h');
    expect(horasTexto(659)).toBe('10 h 59 min');
    expect(inteiroDe(' 12 ')).toBe(12);
    expect(inteiroDe('1,5')).toBeNull();
  });
});
