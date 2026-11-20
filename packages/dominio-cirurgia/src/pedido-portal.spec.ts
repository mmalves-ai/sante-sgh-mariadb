import { describe, expect, it } from 'vitest';
import {
  codigosDoProfissional,
  conferirPedidoPortal,
  codigosExclusivos,
  dentroDoLimiteDePedidos,
  janelaAgendaPortal,
  registroDoPedido,
  reservarPedido,
} from './pedido-portal.js';

const registros = [
  { id: 5001, codigo: 9001, uf: 'SP' },
  { id: 5003, codigo: 7001, uf: 'SP' },
  { id: 5004, codigo: 54321, uf: 'SP' },
  { id: 1, codigo: 0, uf: 'SP' },
];

describe('registros do profissional (regra 6: só os dele)', () => {
  it('cirurgiões pelo ID e prestadores pelo código, sem o "não informado" e sem repetição', () => {
    expect(codigosDoProfissional([...registros, { id: 5001, codigo: 9001, uf: 'SP' }])).toEqual({
      cirurgioes: [5001, 5003, 5004],
      prestadores: [9001, 7001, 54321],
    });
    expect(codigosDoProfissional([])).toEqual({ cirurgioes: [], prestadores: [] });
  });

  it('o registro do pedido é o do conselho da conta; senão o primeiro; sem registro, nenhum', () => {
    expect(registroDoPedido(registros, { uf: 'SP', numero: '54321' })).toBe(5004);
    expect(registroDoPedido(registros, { uf: 'RJ', numero: '54321' })).toBe(5001);
    expect(registroDoPedido(registros, { uf: null, numero: null })).toBe(5001);
    expect(registroDoPedido([{ id: 1, codigo: 0, uf: 'SP' }], { uf: 'SP', numero: '1' })).toBeNull();
  });
});

describe('janela da agenda', () => {
  it('padrão de hoje a 30 dias; fim antes do início e período longo recusados', () => {
    expect(janelaAgendaPortal(null, null, '2026-10-25', 62)).toEqual({ de: '2026-10-25', ate: '2026-11-24' });
    expect(janelaAgendaPortal('2026-10-01', '2026-10-31', '2026-10-25', 62)).toEqual({
      de: '2026-10-01',
      ate: '2026-10-31',
    });
    expect(janelaAgendaPortal('2026-10-10', '2026-10-01', '2026-10-25', 62)).toEqual({
      recusa: 'periodo-invalido',
    });
    expect(janelaAgendaPortal('x', null, '2026-10-25', 62)).toEqual({ recusa: 'periodo-invalido' });
    expect(janelaAgendaPortal('2026-10-01', '2026-12-31', '2026-10-25', 62)).toEqual({
      recusa: 'periodo-longo',
    });
    expect(janelaAgendaPortal('2026-10-01', '2026-12-01', '2026-10-25', 62)).toEqual({
      de: '2026-10-01',
      ate: '2026-12-01',
    });
  });
});

describe('conferência do pedido de cirurgia', () => {
  const ctx = { hoje: '2026-10-25', diasMax: 180, salas: [1, 2], convenios: [10], procedimentoExiste: true };
  const p = { data: '2026-11-03', nascimento: '1970-05-02', sala: 2, convenio: 10, procedimento: 30101271 };
  it('aceita o pedido que faz sentido', () => {
    expect(conferirPedidoPortal(p, ctx)).toBeNull();
  });
  it.each([
    [{ ...p, data: '2026-10-25' }, ctx, 'data-passada'],
    [{ ...p, data: '2026-10-20' }, ctx, 'data-passada'],
    [{ ...p, data: '2027-05-01' }, ctx, 'data-distante'],
    [{ ...p, nascimento: '2026-10-25' }, ctx, 'nascimento-invalido'],
    [{ ...p, nascimento: '1899-12-31' }, ctx, 'nascimento-invalido'],
    [{ ...p, sala: 9 }, ctx, 'sala-inexistente'],
    [{ ...p, convenio: 11 }, ctx, 'convenio-inexistente'],
    [p, { ...ctx, procedimentoExiste: false }, 'procedimento-inexistente'],
  ] as const)('recusa %#', (pedido, c, esperado) => {
    expect(conferirPedidoPortal(pedido, c)).toBe(esperado);
  });
  it('o último dia aceito é hoje + o máximo', () => {
    expect(conferirPedidoPortal({ ...p, data: '2027-04-23' }, ctx)).toBeNull();
    expect(conferirPedidoPortal({ ...p, data: '2027-04-24' }, ctx)).toBe('data-distante');
  });
});

describe('limite de pedidos por conta', () => {
  it('no máximo o teto por hora; os de mais de uma hora não contam', () => {
    const agora = 10_000_000;
    expect(dentroDoLimiteDePedidos([], agora, 2)).toBe(true);
    expect(dentroDoLimiteDePedidos([agora - 1000], agora, 2)).toBe(true);
    expect(dentroDoLimiteDePedidos([agora - 1000, agora - 2000], agora, 2)).toBe(false);
    expect(dentroDoLimiteDePedidos([agora - 3_600_000, agora - 2000], agora, 2)).toBe(true);
  });
});

describe('códigos exclusivos do profissional', () => {
  it('o código que outro profissional (ou registro sem profissional) também tem fica retido', () => {
    const donos = new Map<number, Set<number>>([
      [9001, new Set([6801])],
      [7001, new Set([6801, 6899])],
      [54321, new Set([6801, 0])],
    ]);
    expect(codigosExclusivos([9001, 7001, 54321, 1234], donos, 6801)).toEqual({
      exclusivos: [9001, 1234],
      retidos: [7001, 54321],
    });
    expect(codigosExclusivos([], donos, 6801)).toEqual({ exclusivos: [], retidos: [] });
  });
});

describe('reserva síncrona do pedido', () => {
  it('reserva até o teto na hora; os antigos saem da lista', () => {
    const agora = 10_000_000;
    expect(reservarPedido([], agora, 2)).toEqual([agora]);
    expect(reservarPedido([agora - 3_600_000, agora - 10], agora, 2)).toEqual([agora - 10, agora]);
    expect(reservarPedido([agora - 20, agora - 10], agora, 2)).toBeNull();
  });
});
