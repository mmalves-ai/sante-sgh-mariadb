import { describe, expect, it } from 'vitest';
import { pedidoDeCoassinatura, RecusaCoassinatura } from './coassinatura-pedido.js';

const codigo = (f: () => unknown): string => {
  try {
    f();
    return 'sem-erro';
  } catch (e) {
    return e instanceof RecusaCoassinatura ? e.codigo : String(e);
  }
};

describe('pedidoDeCoassinatura', () => {
  it('o registro aguarda a coassinatura e o pedido nasce pendente, primeira rodada, residente por padrão', () => {
    expect(pedidoDeCoassinatura({ autor: 1, preceptor: 2, preceptorVigente: true })).toEqual({
      situacaoRegistro: 'aguardando_coassinatura',
      sequencia: 1,
      situacao: 'pendente',
      tipoVinculo: 'residente',
      supervisionado: 1,
      preceptor: 2,
    });
    expect(
      pedidoDeCoassinatura({ autor: 1, preceptor: 2, preceptorVigente: true, vinculo: 'academico' })
        .tipoVinculo,
    ).toBe('academico');
  });

  it('recusa o autor como preceptor e o preceptor sem vínculo vigente', () => {
    expect(codigo(() => pedidoDeCoassinatura({ autor: 3, preceptor: 3, preceptorVigente: true }))).toBe(
      'preceptor-e-autor',
    );
    expect(codigo(() => pedidoDeCoassinatura({ autor: 3, preceptor: 4, preceptorVigente: false }))).toBe(
      'preceptor-indisponivel',
    );
  });
});
