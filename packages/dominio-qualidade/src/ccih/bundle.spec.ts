// W0-04 (M1): turno do instante, conferência do checklist do bundle e o alerta de permanência longa (a sonda vesical
// acima de 48 h sem a indicação revisada nas últimas 24 h).
import { describe, expect, it } from 'vitest';
import { alertaPermanencia, conferirBundle, itensDoBundle, turnoDe } from './bundle.js';

describe('turno do bundle', () => {
  it('manhã, tarde e a noite que passa da meia-noite é do dia em que começou', () => {
    expect(turnoDe('2026-11-18T07:00')).toEqual({ data: '2026-11-18', turno: 'manha' });
    expect(turnoDe('2026-11-18T13:00')).toEqual({ data: '2026-11-18', turno: 'tarde' });
    expect(turnoDe('2026-11-18T22:00')).toEqual({ data: '2026-11-18', turno: 'noite' });
    expect(turnoDe('2026-11-19T03:00')).toEqual({ data: '2026-11-18', turno: 'noite' });
  });
});

describe('checklist do bundle', () => {
  const base = {
    tipo: 'sondaVesical',
    ativo: true,
    data: '2026-11-18',
    turno: 'manha' as const,
    agora: '2026-11-18T10:00',
  };
  const todos = Object.fromEntries(itensDoBundle('sondaVesical').map((k) => [k, true]));
  it('conforme só com todos os itens; a indicação revisada vem do item "indicacao"', () => {
    expect(conferirBundle({ ...base, itens: todos })).toEqual({ conforme: true, indicacaoRevisada: true });
    expect(conferirBundle({ ...base, itens: { ...todos, higieneMeato: false } })).toEqual({
      conforme: false,
      indicacaoRevisada: true,
    });
  });
  it('recusa o item de outro tipo, o turno futuro, o dispositivo inativo e o tipo sem bundle', () => {
    expect(conferirBundle({ ...base, itens: { cabeceira: true } })).toEqual({ recusa: 'item-de-outro-tipo' });
    expect(conferirBundle({ ...base, turno: 'tarde', itens: todos })).toEqual({ recusa: 'bundle-no-futuro' });
    expect(conferirBundle({ ...base, ativo: false, itens: todos })).toEqual({
      recusa: 'dispositivo-inativo',
    });
    expect(conferirBundle({ ...base, tipo: 'dreno', itens: {} })).toEqual({ recusa: 'bundle-sem-itens' });
  });
});

describe('alerta de permanência longa', () => {
  const svd = { tipo: 'sondaVesical', inseridoEm: '2026-11-15T08:00', retiradoEm: null };
  it('SVD acima de 48 h sem indicação revisada nas últimas 24 h: alerta', () => {
    expect(alertaPermanencia(svd, [], '2026-11-18T10:00')).toEqual({
      horas: 74,
      limiteHoras: 48,
      ultimaIndicacao: null,
    });
    expect(alertaPermanencia(svd, ['2026-11-16T09:00:00'], '2026-11-18T10:00')).toMatchObject({
      ultimaIndicacao: '2026-11-16T09:00:00',
    });
  });
  it('sem alerta: até 48 h, com indicação nas últimas 24 h, retirada, cancelada ou tipo sem limite', () => {
    expect(alertaPermanencia(svd, [], '2026-11-17T08:00')).toBeNull();
    expect(alertaPermanencia(svd, ['2026-11-18T08:30:00'], '2026-11-18T10:00')).toBeNull();
    expect(alertaPermanencia({ ...svd, retiradoEm: '2026-11-18T09:00' }, [], '2026-11-18T10:00')).toBeNull();
    expect(alertaPermanencia({ ...svd, canceladoEm: '2026-11-18T09:00' }, [], '2026-11-18T10:00')).toBeNull();
    expect(alertaPermanencia({ ...svd, tipo: 'dreno' }, [], '2026-11-30T10:00')).toBeNull();
  });
});
