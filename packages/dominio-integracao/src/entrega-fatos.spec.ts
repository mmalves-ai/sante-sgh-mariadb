import { describe, expect, it } from 'vitest';
import {
  assinaturaDoEvento,
  estadoDaLiberacao,
  exameVaiAoApoio,
  fatoDaLiberacao,
  reservaVencida,
  type EventoLiberacao,
} from './entrega-fatos.js';

const t = (s: number) => new Date(Date.UTC(2026, 10, 21, 10, 0, s));
const ev = (id: number, etapa: string, operacao: string, s: number): EventoLiberacao => ({
  id,
  etapa,
  operacao,
  ocorridoEm: t(s),
});

describe('estado da liberação do exame para o parceiro', () => {
  it('a liberação vigente vira o fato; a técnica e a publicação no portal não', () => {
    const h = [ev(1, 'conferencia_tecnica', 'inclusao', 1), ev(2, 'liberacao_clinica', 'inclusao', 2)];
    expect(fatoDaLiberacao(h, 1)).toBeNull();
    expect(fatoDaLiberacao(h, 2)).toBe('fato.resultado.liberado');
    expect(fatoDaLiberacao([...h, ev(3, 'publicacao_portal', 'inclusao', 3)], 2)).toBe(
      'fato.resultado.liberado',
    );
    expect(estadoDaLiberacao(h)).toBe('liberado');
  });

  it('a liberação desfeita ou revogada depois não sai como liberada; a retirada sai como revogação', () => {
    const desfeita = [ev(1, 'liberacao_clinica', 'inclusao', 1), ev(2, 'liberacao_clinica', 'exclusao', 2)];
    expect(fatoDaLiberacao(desfeita, 1)).toBeNull();
    expect(fatoDaLiberacao(desfeita, 2)).toBe('fato.resultado.revogado');
    expect(estadoDaLiberacao(desfeita)).toBe('desfeito');
    const revogada = [ev(1, 'liberacao_clinica', 'inclusao', 1), ev(2, 'revogacao', 'inclusao', 2)];
    expect(fatoDaLiberacao(revogada, 1)).toBeNull();
    expect(fatoDaLiberacao(revogada, 2)).toBe('fato.resultado.revogado');
    expect(estadoDaLiberacao(revogada)).toBe('revogado');
  });

  it('desfazer a revogação devolve a liberação; revogar o que não estava liberado não gera fato', () => {
    const h = [
      ev(1, 'liberacao_clinica', 'inclusao', 1),
      ev(2, 'revogacao', 'inclusao', 2),
      ev(3, 'revogacao', 'exclusao', 3),
    ];
    expect(fatoDaLiberacao(h, 3)).toBe('fato.resultado.liberado');
    expect(fatoDaLiberacao(h, 2)).toBeNull();
    expect(fatoDaLiberacao([ev(5, 'revogacao', 'inclusao', 1)], 5)).toBeNull();
    expect(fatoDaLiberacao(h, 99)).toBeNull();
  });

  it('a nova liberação depois da retirada vale; a ordem é o instante e, no empate, a linha', () => {
    const h = [
      ev(4, 'liberacao_clinica', 'inclusao', 3),
      ev(2, 'revogacao', 'inclusao', 2),
      ev(1, 'liberacao_clinica', 'inclusao', 1),
    ];
    expect(fatoDaLiberacao(h, 4)).toBe('fato.resultado.liberado');
    const empate = [ev(8, 'revogacao', 'inclusao', 1), ev(7, 'liberacao_clinica', 'inclusao', 1)];
    expect(fatoDaLiberacao(empate, 8)).toBe('fato.resultado.revogado');
  });
});

describe('entrega dos fatos', () => {
  it('quem assina o resultado liberado recebe a revogação dele', () => {
    expect(assinaturaDoEvento('fato.resultado.revogado')).toBe('fato.resultado.liberado');
    expect(assinaturaDoEvento('fato.exame.apoio')).toBe('fato.exame.apoio');
  });

  it('o pedido ao apoio nasce na remessa fechada, nunca para exame cancelado ou recusado', () => {
    expect(exameVaiAoApoio('aberta', 'coletado', 'enviado')).toBe(false);
    expect(exameVaiAoApoio('fechada', 'coletado', 'enviado')).toBe(true);
    expect(exameVaiAoApoio('enviada', 'cancelado', 'enviado')).toBe(false);
    expect(exameVaiAoApoio('fechada', 'recusado', 'enviado')).toBe(false);
    expect(exameVaiAoApoio('cancelada', 'coletado', 'enviado')).toBe(false);
    expect(exameVaiAoApoio('fechada', 'coletado', 'cancelado')).toBe(false);
  });

  it('a reserva do envio vence depois do prazo', () => {
    expect(reservaVencida(t(0), new Date(t(0).getTime() + 14 * 60_000))).toBe(false);
    expect(reservaVencida(t(0), new Date(t(0).getTime() + 15 * 60_000))).toBe(true);
    expect(reservaVencida(null, t(0))).toBe(true);
  });
});
