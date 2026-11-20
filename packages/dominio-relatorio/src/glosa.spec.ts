// Regra 12: glosa não é a marca de baixa. A marca indica o item baixado; o valor glosado é cobrado − pago dos
// baixados; sem a maturação, o mês recente leria "glosa de 0%". Casos de `sante-api: test/gestao.test.js`.
import { describe, expect, it } from 'vitest';
import { glosaDosBaixados, seriesFinanceiras } from './paineis.js';

describe('glosa sobre os itens baixados', () => {
  it('cobrado − pago dos baixados, sobre o cobrado baixado', () => {
    expect(glosaDosBaixados(27_000_000, 22_910_000)).toEqual({ valor: 4_090_000, percentual: 15.1 });
    expect(glosaDosBaixados(0, 0)).toEqual({ valor: 0, percentual: null });
  });

  it('mês sem baixa: glosa sem valor e maturação zero (nunca "0% de glosa")', () => {
    const s = seriesFinanceiras(
      [
        {
          periodo: '2026-06',
          regua: 'data-do-item',
          cobrado: 100,
          pago: 0,
          cobradoBaixado: 0,
          pagoBaixado: 0,
        },
        {
          periodo: '2026-01',
          regua: 'data-do-item',
          cobrado: 100,
          pago: 8,
          cobradoBaixado: 10,
          pagoBaixado: 8,
        },
      ],
      ['2026-01', '2026-06'],
      '2026-07',
    );
    const glosa = s.find((x) => x.codigo === 'glosa-baixados')!;
    const mat = s.find((x) => x.codigo === 'maturacao')!;
    expect(glosa.valores.map((v) => v.valor)).toEqual([20, null]);
    expect(mat.valores.map((v) => v.valor)).toEqual([10, 0]);
  });
});
