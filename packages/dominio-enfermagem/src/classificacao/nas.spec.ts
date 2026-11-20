// Regra 9 do M45: NAS (Miranda et al., 2003) por turno na UTI: soma dos pesos em % do tempo de um profissional em 24 h.
import { ITENS_NAS } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { classificar, classificarNas } from './classificacao.js';

describe('NAS', () => {
  it('os pesos da publicação somam 176,8 no máximo', () => {
    const max = ITENS_NAS.reduce(
      (s, i) => s + (i.subitens ? Math.max(...i.subitens.map((x) => x.peso)) : (i.peso ?? 0)),
      0,
    );
    expect(Math.round(max * 10) / 10).toBe(176.8);
  });
  it('paciente típico: 1a, 2, 3, 4a, 6a, 7a, 8a, 9, 17 = 44,5 + ...; horas = total × 24 ÷ 100', () => {
    const r = classificarNas({
      '1': '1a',
      '2': 'sim',
      '3': 'sim',
      '4': '4a',
      '6': '6a',
      '7': '7a',
      '8': '8a',
      '9': 'sim',
      '17': 'sim',
    });
    // 4,5 + 4,3 + 5,6 + 4,1 + 5,5 + 4,0 + 4,2 + 1,4 + 7,0 = 40,6
    expect(r).toMatchObject({ ok: true, total: 40.6, horas24h: 9.7, categoria: 'nas' });
    expect(r.ok && r.rotuloCategoria).toBe('40,6% do tempo de um profissional');
    expect(classificar('nas', {})).toMatchObject({ ok: true, total: 0, horas24h: 0 });
  });
  it('subitem inexistente, item desconhecido e valor de item simples fora de "sim" são recusados', () => {
    expect(classificarNas({ '1': '1d' })).toMatchObject({
      ok: false,
      codigo: 'valor-nunca-visto',
      itens: ['1'],
    });
    expect(classificarNas({ '99': 'sim' })).toMatchObject({ ok: false, itens: ['99'] });
    expect(classificarNas({ '2': 'nao' })).toMatchObject({ ok: false, itens: ['2'] });
  });
});
