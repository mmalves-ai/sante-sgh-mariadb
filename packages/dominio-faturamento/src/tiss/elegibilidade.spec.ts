import { describe, expect, it } from 'vitest';
import {
  conferirPedidoElegibilidade,
  conferirRespostaElegibilidade,
  elegibilidadeDoDia,
} from './elegibilidade.js';

describe('consulta de elegibilidade', () => {
  it('o pedido exige a carteira e não aceita a vencida', () => {
    expect(
      conferirPedidoElegibilidade({
        carteira: 'SINT001',
        validadeCarteira: '2027-01-01',
        hoje: '2026-11-24',
      }),
    ).toEqual([]);
    expect(
      conferirPedidoElegibilidade({ carteira: ' ', validadeCarteira: '2026-11-23', hoje: '2026-11-24' }).map(
        (p) => p.campo,
      ),
    ).toEqual(['carteira', 'validadeCarteira']);
  });

  it('a resposta: só sobre a pendente, negativa com motivo, validação só na elegível', () => {
    const ok = {
      situacao: 'elegivel' as const,
      motivoNegativa: null,
      motivoGlosa: null,
      codigoValidacao: 'V123',
    };
    expect(conferirRespostaElegibilidade('pendente', ok)).toEqual([]);
    expect(conferirRespostaElegibilidade('elegivel', ok)[0]?.campo).toBe('consulta');
    expect(
      conferirRespostaElegibilidade('pendente', {
        situacao: 'inelegivel',
        motivoNegativa: null,
        motivoGlosa: null,
        codigoValidacao: 'X',
      }).map((p) => p.campo),
    ).toEqual(['motivoNegativa', 'codigoValidacao']);
    expect(
      conferirRespostaElegibilidade('pendente', {
        situacao: 'inelegivel',
        motivoNegativa: null,
        motivoGlosa: 7,
        codigoValidacao: null,
      }),
    ).toEqual([]);
  });

  it('a elegível do dia vale para a mesma carteira', () => {
    const u = { situacao: 'elegivel' as const, dia: '2026-11-24', carteira: 'SINT001' };
    expect(elegibilidadeDoDia(u, 'SINT001 ', '2026-11-24')).toBe(true);
    expect(elegibilidadeDoDia(u, 'SINT001', '2026-11-25')).toBe(false);
    expect(elegibilidadeDoDia({ ...u, situacao: 'inelegivel' }, 'SINT001', '2026-11-24')).toBe(false);
    expect(elegibilidadeDoDia(null, 'SINT001', '2026-11-24')).toBe(false);
  });
});
