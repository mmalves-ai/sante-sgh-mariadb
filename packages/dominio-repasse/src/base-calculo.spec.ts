// Regra 4 do M33: base explícita por regra (cobrado, recebido, misto); recebido só depois da conciliação.
import { describe, expect, it } from 'vitest';
import { baseDoItem } from './base-calculo.js';
import { item } from './fixtures.spec-util.js';

describe('baseDoItem', () => {
  it('cobrado: o valor cobrado, conciliado ou não', () => {
    expect(baseDoItem(item({ conciliado: false }), 'cobrado', 'recebido')).toEqual({
      ok: true,
      valor: { base: 'cobrado', origem: 'cobrado', centavos: 20000 },
    });
  });

  it('recebido: pago 150,00 + recurso deferido 30,00 = 180,00; sem conciliação, pendente', () => {
    expect(baseDoItem(item(), 'recebido', 'cobrado')).toEqual({
      ok: true,
      valor: { base: 'recebido', origem: 'recebido', centavos: 18000 },
    });
    expect(baseDoItem(item({ conciliado: false }), 'recebido', 'cobrado')).toEqual({
      ok: false,
      pendencia: 'nao-conciliado',
    });
  });

  it('misto: cobrado antes da conciliação, recebido depois', () => {
    const antes = baseDoItem(item({ conciliado: false }), 'misto', 'cobrado');
    const depois = baseDoItem(item(), 'misto', 'cobrado');
    expect(antes.ok && antes.valor).toEqual({ base: 'misto', origem: 'cobrado', centavos: 20000 });
    expect(depois.ok && depois.valor).toEqual({ base: 'misto', origem: 'recebido', centavos: 18000 });
  });

  it('regra sem base usa o padrão do parâmetro', () => {
    const r = baseDoItem(item(), null, 'recebido');
    expect(r.ok && r.valor.base).toBe('recebido');
  });
});
