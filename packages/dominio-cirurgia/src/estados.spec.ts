// Estados do agendamento (SGH_CC_AGENDA_ESTADO): transições e ações da tela.
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
  it('sete estados com rótulo; solicitado não ocupa a sala', () => {
    expect(ESTADOS_AGENDAMENTO).toHaveLength(7);
    expect(Object.keys(ROTULOS_ESTADO)).toHaveLength(7);
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
});
