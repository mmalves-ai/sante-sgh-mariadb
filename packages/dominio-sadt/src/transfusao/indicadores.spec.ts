// Indicadores de hemovigilância com o numerador e o denominador.
import { describe, expect, it } from 'vitest';
import { indicadoresHemovigilancia } from './indicadores.js';

describe('indicadores de hemovigilância', () => {
  it('reações por mil, sinais completos, urgentes no prazo e indicação escrita', () => {
    const atos = [
      ...Array.from({ length: 998 }, () => ({ sinaisCompletos: true, comReacao: false })),
      { sinaisCompletos: false, comReacao: true },
      { sinaisCompletos: true, comReacao: true },
    ];
    const r = indicadoresHemovigilancia({
      atos,
      reacoesGraves: 1,
      requisicoesUrgentes: [{ noPrazo: true }, { noPrazo: false }, { noPrazo: true }],
      requisicoes: [{ comIndicacao: true }, { comIndicacao: true }],
    });
    expect(r.map((i) => [i.codigo, i.numerador, i.denominador, i.valor, i.unidade])).toEqual([
      ['reacoesPorMil', 2, 1000, 2, 'por mil'],
      ['gravesPorMil', 1, 1000, 1, 'por mil'],
      ['sinaisCompletos', 999, 1000, 99.9, '%'],
      ['urgentesNoPrazo', 2, 3, 66.7, '%'],
      ['comIndicacao', 2, 2, 100, '%'],
    ]);
  });

  it('denominador zero dá valor nulo', () => {
    const r = indicadoresHemovigilancia({
      atos: [],
      reacoesGraves: 0,
      requisicoesUrgentes: [],
      requisicoes: [],
    });
    expect(r.every((i) => i.valor === null && i.denominador === 0)).toBe(true);
  });
});
