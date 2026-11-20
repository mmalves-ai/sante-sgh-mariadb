// Indicadores da reunião de leitos (mina M41, regra 17): cada um com numerador e denominador.
import { describe, expect, it } from 'vitest';
import { indicadoresNir } from './indicadores.js';

describe('indicadores do NIR', () => {
  it('espera média, dentro do prazo, vermelhos e altas previstas para hoje', () => {
    const r = indicadoresNir({
      concluidas: [
        {
          solicitadoEm: '2026-10-24T08:00:00',
          internadoEm: '2026-10-24T09:00:00',
          prazoEm: '2026-10-24T09:00:00',
        },
        {
          solicitadoEm: '2026-10-24T08:00:00',
          internadoEm: '2026-10-24T11:00:00',
          prazoEm: '2026-10-24T10:00:00',
        },
      ],
      internados: [{ cor: 'vermelho' }, { cor: 'verde' }, { cor: 'amarelo' }, { cor: 'vermelho' }],
      altasHoje: [{ altaMedicaDecidida: true }, { altaMedicaDecidida: false }, { altaMedicaDecidida: false }],
    });
    expect(r.map((x) => [x.codigo, x.numerador, x.denominador, x.valor])).toEqual([
      ['nir.esperaMedia', 240, 2, 120],
      ['nir.dentroDoPrazo', 1, 2, 50],
      ['nir.vermelhos', 2, 4, 50],
      ['nir.altasPrevistasHoje', 1, 3, 33.3],
    ]);
  });

  it('sem denominador, sem valor (nunca divide por zero)', () => {
    const r = indicadoresNir({ concluidas: [], internados: [], altasHoje: [] });
    expect(r.every((x) => x.valor === null && x.denominador === 0)).toBe(true);
  });
});
