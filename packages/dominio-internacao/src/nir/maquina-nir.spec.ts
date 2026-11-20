// Ficha do M44, regra 9: a máquina do NIR, todas as transições válidas e inválidas.
import {
  ACOES_SOLICITACAO_NIR,
  CODIGOS_ESTADO_NIR,
  type AcaoSolicitacaoNir,
  type EstadoSolicitacaoNir,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { acoesPossiveis, estadoFinal, transicao } from './maquina.js';

const VALIDAS: readonly [EstadoSolicitacaoNir, AcaoSolicitacaoNir, EstadoSolicitacaoNir][] = [
  ['solicitado', 'analisar', 'em_analise'],
  ['solicitado', 'reservar', 'reservado'],
  ['em_analise', 'reservar', 'reservado'],
  ['reservado', 'liberarReserva', 'em_analise'],
  ['em_transito', 'liberarReserva', 'em_analise'],
  ['reservado', 'transito', 'em_transito'],
  ['reservado', 'internar', 'internado'],
  ['em_transito', 'internar', 'internado'],
  ['solicitado', 'priorizar', 'solicitado'],
  ['em_analise', 'priorizar', 'em_analise'],
  ['reservado', 'priorizar', 'reservado'],
  ['em_transito', 'priorizar', 'em_transito'],
  ...(['solicitado', 'em_analise', 'reservado', 'em_transito'] as const).flatMap(
    (e) =>
      [
        [e, 'cancelar', 'cancelado'],
        [e, 'rejeitar', 'rejeitado'],
      ] as [EstadoSolicitacaoNir, AcaoSolicitacaoNir, EstadoSolicitacaoNir][],
  ),
];

describe('máquina de estados do NIR (regra 9)', () => {
  it.each(VALIDAS)('%s --%s--> %s', (de, acao, para) => {
    expect(transicao(de, acao)).toEqual({ ok: true, de, para });
  });

  it('todas as outras combinações são recusadas, com o motivo', () => {
    const validas = new Set(VALIDAS.map(([de, a]) => `${de}:${a}`));
    let recusadas = 0;
    for (const e of CODIGOS_ESTADO_NIR)
      for (const { codigo: a } of ACOES_SOLICITACAO_NIR) {
        if (validas.has(`${e}:${a}`)) continue;
        const r = transicao(e, a);
        expect(r.ok, `${e}:${a}`).toBe(false);
        if (!r.ok) expect(r.motivo.length).toBeGreaterThan(10);
        recusadas++;
      }
    expect(recusadas).toBe(CODIGOS_ESTADO_NIR.length * ACOES_SOLICITACAO_NIR.length - VALIDAS.length);
  });

  it('estado final não muda (internado, cancelado, rejeitado)', () => {
    for (const e of ['internado', 'cancelado', 'rejeitado'] as const) {
      expect(estadoFinal(e)).toBe(true);
      expect(transicao(e, 'cancelar')).toMatchObject({ ok: false, codigo: 'estado-final' });
      expect(acoesPossiveis(e)).toEqual([]);
    }
    expect(transicao('solicitado', 'internar')).toMatchObject({ ok: false, codigo: 'transicao-invalida' });
  });

  it('as ações possíveis de cada estado aberto', () => {
    expect(acoesPossiveis('solicitado')).toEqual([
      'analisar',
      'reservar',
      'priorizar',
      'cancelar',
      'rejeitar',
    ]);
    expect(acoesPossiveis('reservado')).toEqual([
      'liberarReserva',
      'transito',
      'internar',
      'priorizar',
      'cancelar',
      'rejeitar',
    ]);
  });
});
