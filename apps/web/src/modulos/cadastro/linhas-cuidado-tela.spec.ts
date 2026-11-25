import { describe, expect, it } from 'vitest';
import type { EstadoPrograma } from './api-linhas-cuidado.js';
import { faltasInscricao, faltasMudanca, hojeIso, pedeMotivo } from './linhas-cuidado-tela.js';

const HOJE = '2026-11-25';
const estado = (id: number, tipo: EstadoPrograma['tipo'], encerra = false): EstadoPrograma => ({
  id,
  codigo: tipo,
  descricao: tipo,
  tipo,
  encerra,
  ativo: true,
});
const ESTADOS = [estado(1, 'incluido'), estado(2, 'ativo'), estado(3, 'suspenso'), estado(4, 'alta', true)];
const PROGRAMAS = [
  { id: 10, exigeReferencia: true },
  { id: 11, exigeReferencia: false },
];

describe('linhas de cuidado na tela', () => {
  it('hoje no fuso do navegador', () => {
    expect(hojeIso(new Date(2026, 10, 25, 23, 30))).toBe('2026-11-25');
  });

  it('pede o motivo só ao suspender ou encerrar', () => {
    expect(pedeMotivo(estado(2, 'ativo'))).toBe(false);
    expect(pedeMotivo(estado(3, 'suspenso'))).toBe(true);
    expect(pedeMotivo(estado(4, 'alta', true))).toBe(true);
    expect(pedeMotivo(estado(5, 'obito'))).toBe(true);
    expect(pedeMotivo({ tipo: 'ativo', encerra: true })).toBe(true);
    expect(pedeMotivo(null)).toBe(false);
  });

  it('inscrição: programa, data não futura, referência quando o programa exige e uma só viva', () => {
    expect(faltasInscricao({ linha: 0, referencia: null, vigenciaInicio: '' }, PROGRAMAS, [], HOJE)).toEqual([
      'programa',
      'data',
    ]);
    expect(
      faltasInscricao({ linha: 10, referencia: null, vigenciaInicio: '2026-12-01' }, PROGRAMAS, [], HOJE),
    ).toEqual(['dataFutura', 'referencia']);
    expect(faltasInscricao({ linha: 10, referencia: 7, vigenciaInicio: HOJE }, PROGRAMAS, [], HOJE)).toEqual(
      [],
    );
    const viva = { linha: { id: 11, codigo: 'X', descricao: 'X' }, encerrada: false };
    const encerrada = { ...viva, encerrada: true };
    expect(
      faltasInscricao({ linha: 11, referencia: null, vigenciaInicio: HOJE }, PROGRAMAS, [viva], HOJE),
    ).toEqual(['jaInscrito']);
    expect(
      faltasInscricao({ linha: 11, referencia: null, vigenciaInicio: HOJE }, PROGRAMAS, [encerrada], HOJE),
    ).toEqual([]);
  });

  it('mudança: só para os próximos estados, sem data futura nem anterior ao estado atual, motivo ao suspender', () => {
    const insc = { proximos: [2, 3, 4], estadoDesde: '2026-11-10' };
    expect(faltasMudanca({ estado: 1, data: HOJE, motivo: '' }, insc, ESTADOS, HOJE)).toEqual(['estado']);
    expect(faltasMudanca({ estado: 2, data: HOJE, motivo: '' }, insc, ESTADOS, HOJE)).toEqual([]);
    expect(faltasMudanca({ estado: 3, data: '2026-11-01', motivo: 'abc' }, insc, ESTADOS, HOJE)).toEqual([
      'dataAntes',
      'motivo',
    ]);
    expect(
      faltasMudanca({ estado: 4, data: '2026-11-30', motivo: 'Alta por meta atingida' }, insc, ESTADOS, HOJE),
    ).toEqual(['dataFutura']);
    expect(faltasMudanca({ estado: 4, data: HOJE, motivo: 'Meta atingida' }, insc, ESTADOS, HOJE)).toEqual(
      [],
    );
  });
});
