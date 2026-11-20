// Regra 5 do M49 (SBIS-37): pendente com espera crescente, aviso uma vez, falha ao esgotar, reabrir à mão.
import { describe, expect, it } from 'vitest';
import {
  esperaMin,
  NOVA,
  reabrir,
  registrarFalhaTransitoria,
  registrarSucesso,
  vencidasParaReprocessar,
  type SituacaoReprocessamento,
} from './reprocessamento.js';

const cfg = { maxTentativas: 4, esperaInicialMin: 5 };
const t0 = new Date('2026-10-24T12:00:00Z');

describe('reprocessamento da assinatura pendente', () => {
  it('espera dobra e para em 4 h', () => {
    expect([1, 2, 3, 4, 10].map((n) => esperaMin(n, 5))).toEqual([5, 10, 20, 40, 240]);
  });

  it('primeira falha: pendente, próxima em 5 min, avisa autor e diretor técnico', () => {
    const t = registrarFalhaTransitoria(NOVA, 'ocsp-indisponivel', t0, cfg);
    expect(t.situacao).toEqual({
      estado: 'pendente',
      tentativas: 1,
      falha: 'ocsp-indisponivel',
      proximaEm: new Date('2026-10-24T12:05:00Z'),
    });
    expect(t.avisar).toEqual(['autor', 'diretor-tecnico']);
    expect(t.evento).toBe('documento.assinatura.falhou');
  });

  it('falhas seguintes não repetem o aviso; esgotou, vira falha e avisa de novo', () => {
    let s: SituacaoReprocessamento = NOVA;
    const avisos: number[] = [];
    for (let i = 0; i < 4; i++) {
      const t = registrarFalhaTransitoria(s, 'act-indisponivel', t0, cfg);
      avisos.push(t.avisar.length);
      s = t.situacao;
    }
    expect(avisos).toEqual([2, 0, 0, 2]);
    expect(s).toEqual({ estado: 'falha', tentativas: 4, falha: 'act-indisponivel', proximaEm: null });
  });

  it('sucesso: assinada; assinada não volta a pendente nem reabre', () => {
    const p = registrarFalhaTransitoria(NOVA, 'lcr-indisponivel', t0, cfg).situacao;
    const a = registrarSucesso(p);
    expect(a.situacao.estado).toBe('assinada');
    expect(a.evento).toBe('documento.assinatura.assinado');
    expect(() => registrarFalhaTransitoria(a.situacao, 'lcr-indisponivel', t0, cfg)).toThrow();
    expect(() => registrarSucesso(a.situacao)).toThrow();
    expect(() => reabrir(a.situacao, t0)).toThrow();
  });

  it('reabrir à mão zera as tentativas e marca para já', () => {
    const f: SituacaoReprocessamento = {
      estado: 'falha',
      tentativas: 4,
      falha: 'psc-indisponivel',
      proximaEm: null,
    };
    expect(reabrir(f, t0)).toEqual({
      estado: 'pendente',
      tentativas: 0,
      falha: 'psc-indisponivel',
      proximaEm: t0,
    });
  });

  it('a rodada pega só as pendentes vencidas, mais antigas primeiro, até o teto', () => {
    const p = (id: number, min: number | null, estado: SituacaoReprocessamento['estado'] = 'pendente') => ({
      id,
      situacao: {
        estado,
        tentativas: 1,
        falha: null,
        proximaEm: min === null ? null : new Date(t0.getTime() + min * 60_000),
      },
    });
    const lista = [p(1, -1), p(2, -10), p(3, 5), p(4, -10), p(5, null), p(6, -20, 'falha')];
    expect(vencidasParaReprocessar(lista, t0, 10).map((x) => x.id)).toEqual([2, 4, 1]);
    expect(vencidasParaReprocessar(lista, t0, 1).map((x) => x.id)).toEqual([2]);
  });
});
