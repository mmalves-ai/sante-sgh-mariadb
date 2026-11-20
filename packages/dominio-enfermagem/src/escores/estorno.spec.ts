// W0-03: a reavaliação do alerta NEWS2 quando o escore que o disparou é estornado.
import { describe, expect, it } from 'vitest';
import { reavaliarAlertaNews2 } from './estorno.js';

const agora = '2026-10-22T13:00:00';
describe('reavaliarAlertaNews2', () => {
  it('escore sem gatilho: sem alerta a reavaliar', () => {
    expect(reavaliarAlertaNews2({ id: 1, gatilho: 'nenhum' }, [], agora)).toEqual({
      alerta: 'sem-alerta',
      escoreMantem: null,
    });
  });
  it('nenhum outro NEWS2 válido com gatilho nas 12 h: encerrado', () => {
    const outros = [
      { id: 2, gatilho: 'nenhum', aferidoEm: '2026-10-22T12:00:00', estornado: false },
      { id: 3, gatilho: 'trr', aferidoEm: '2026-10-22T00:30:00', estornado: false },
      { id: 4, gatilho: 'trr', aferidoEm: '2026-10-22T11:00:00', estornado: true },
    ];
    expect(reavaliarAlertaNews2({ id: 1, gatilho: 'trr' }, outros, agora).alerta).toBe('encerrado');
  });
  it('outro NEWS2 válido com gatilho nas 12 h: mantido pelo mais recente', () => {
    const outros = [
      { id: 2, gatilho: 'avisar-medico', aferidoEm: '2026-10-22T09:00:00', estornado: false },
      { id: 5, gatilho: 'trr', aferidoEm: '2026-10-22T11:00:00', estornado: false },
      { id: 1, gatilho: 'trr', aferidoEm: '2026-10-22T12:00:00', estornado: false },
    ];
    expect(reavaliarAlertaNews2({ id: 1, gatilho: 'trr' }, outros, agora)).toEqual({
      alerta: 'mantido',
      escoreMantem: 5,
    });
  });
});
