// Estados do agendamento (situação do agendamento cirúrgico): transições e ações da tela.
import { describe, expect, it } from 'vitest';
import {
  acoesDoEstado,
  ESTADOS_AGENDAMENTO,
  estadoEfetivo,
  estadoValido,
  ocupaSala,
  podeIr,
  proximosEstados,
  ROTULOS_ESTADO,
} from './estados.js';

describe('estados do agendamento cirúrgico', () => {
  it('oito estados com rótulo; solicitado não ocupa a sala', () => {
    expect(ESTADOS_AGENDAMENTO).toHaveLength(8);
    expect(Object.keys(ROTULOS_ESTADO)).toHaveLength(8);
    expect(estadoValido('em-sala')).toBe(true);
    expect(estadoValido('pronto')).toBe(false);
    expect(ocupaSala('solicitado')).toBe(false);
    expect(ocupaSala('em-sala')).toBe(true);
  });
  it('transições permitidas e terminais', () => {
    expect(podeIr('solicitado', 'confirmado')).toBe(true);
    expect(podeIr('em-sala', 'cancelado')).toBe(false);
    expect(podeIr('suspenso', 'solicitado')).toBe(true);
    expect(proximosEstados('realizado')).toEqual([]);
    expect(proximosEstados('cancelado')).toEqual([]);
  });
  it('estado efetivo: a realizada manda; sem registro do novo, a cirurgia do mapa é confirmada', () => {
    expect(estadoEfetivo(null, false)).toBe('confirmado');
    expect(estadoEfetivo('no-bloco', true)).toBe('realizado');
    expect(estadoEfetivo('suspenso', false)).toBe('suspenso');
  });
  it('ações da tela por estado', () => {
    expect(acoesDoEstado('solicitado')).toMatchObject({ confirmar: true, registrar: false, cancelar: true });
    expect(acoesDoEstado('confirmado')).toMatchObject({ mover: true, registrar: true, marcarNoBloco: true });
    expect(acoesDoEstado('suspenso')).toMatchObject({ retomar: true, mover: false, suspender: false });
    expect(acoesDoEstado('realizado')).toMatchObject({ cancelar: false, registrar: false });
  });
  it('não informada na origem (V-D1): fora da sala; só cancelar ou reagendar (volta a pedido de sala)', () => {
    expect(ROTULOS_ESTADO['nao-informada']).toBe('Não informada na origem');
    expect(ocupaSala('nao-informada')).toBe(false);
    expect(proximosEstados('nao-informada')).toEqual(['solicitado', 'cancelado']);
    for (const e of ['confirmado', 'no-bloco', 'em-sala', 'realizado', 'suspenso'] as const)
      expect(podeIr('nao-informada', e)).toBe(false);
    for (const e of ESTADOS_AGENDAMENTO) expect(podeIr(e, 'nao-informada')).toBe(false);
    expect(acoesDoEstado('nao-informada')).toEqual({
      confirmar: false,
      mover: false,
      cancelar: true,
      suspender: false,
      retomar: true,
      registrar: false,
      marcarNoBloco: false,
      marcarEmSala: false,
    });
  });
});
