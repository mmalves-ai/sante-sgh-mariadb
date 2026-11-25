import { describe, expect, it } from 'vitest';
import {
  decidirPedidoManual,
  duracaoDaCarga,
  situacaoVisivel,
  TETO_CARGA_ABERTA_MS,
} from './datamart-pedido.js';

const AGORA = new Date('2026-11-25T12:00:00.000Z');
const antes = (ms: number) => new Date(AGORA.getTime() - ms);

describe('controle da carga do data mart na administração (01-REL L113)', () => {
  it('aceita o pedido sem carga aberta e recusa com carga aberta há menos do que o teto', () => {
    expect(decidirPedidoManual([], AGORA)).toEqual({ aceito: true });
    expect(decidirPedidoManual([{ id: 7, ocorridoEm: antes(60_000) }], AGORA)).toEqual({
      aceito: false,
      motivo: 'carga-em-andamento',
      carga: 7,
    });
    // A aberta há mais do que o teto está interrompida: não bloqueia o pedido.
    expect(decidirPedidoManual([{ id: 8, ocorridoEm: antes(TETO_CARGA_ABERTA_MS) }], AGORA)).toEqual({
      aceito: true,
    });
  });

  it('a situação visível separa aguardando, em execução e interrompida', () => {
    const recente = antes(1000);
    expect(
      situacaoVisivel({ situacao: 'em_execucao', pedido: 'aguardando', ocorridoEm: recente }, AGORA),
    ).toBe('aguardando');
    expect(situacaoVisivel({ situacao: 'em_execucao', pedido: 'iniciado', ocorridoEm: recente }, AGORA)).toBe(
      'em_execucao',
    );
    expect(situacaoVisivel({ situacao: 'em_execucao', pedido: null, ocorridoEm: recente }, AGORA)).toBe(
      'em_execucao',
    );
    expect(
      situacaoVisivel(
        { situacao: 'em_execucao', pedido: 'aguardando', ocorridoEm: antes(TETO_CARGA_ABERTA_MS + 1) },
        AGORA,
      ),
    ).toBe('interrompida');
    expect(situacaoVisivel({ situacao: 'falhou', pedido: null, ocorridoEm: recente }, AGORA)).toBe('falhou');
    expect(() => situacaoVisivel({ situacao: 'x', pedido: null, ocorridoEm: recente }, AGORA)).toThrow(
      /desconhecida/,
    );
  });

  it('a duração só existe com a carga fechada e o relógio em ordem', () => {
    expect(duracaoDaCarga(antes(500), AGORA)).toBe(500);
    expect(duracaoDaCarga(AGORA, null)).toBeNull();
    expect(duracaoDaCarga(AGORA, antes(1))).toBeNull();
  });
});
