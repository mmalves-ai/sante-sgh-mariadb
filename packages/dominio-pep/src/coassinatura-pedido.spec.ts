import { describe, expect, it } from 'vitest';
import {
  novaRodadaDeCoassinatura,
  pedidoDeCoassinatura,
  RecusaCoassinatura,
  RecusaNovaRodada,
  vinculoDoCadastro,
} from './coassinatura-pedido.js';

const codigo = (f: () => unknown): string => {
  try {
    f();
    return 'sem-erro';
  } catch (e) {
    return e instanceof RecusaCoassinatura || e instanceof RecusaNovaRodada ? e.codigo : String(e);
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

  it('o tipo de vínculo vem do cadastro de supervisão', () => {
    expect(vinculoDoCadastro('preceptoria')).toBe('residente');
    expect(vinculoDoCadastro('titular_auxiliar')).toBe('profissional_em_treinamento');
    expect(vinculoDoCadastro('academico')).toBe('academico');
    expect(vinculoDoCadastro('estagio')).toBe('estagiario');
    expect(vinculoDoCadastro(null)).toBeUndefined();
    expect(vinculoDoCadastro('outro')).toBeUndefined();
  });

  it('nova rodada depois da recusa: sequência seguinte, pendente, com o mesmo ou outro preceptor', () => {
    const p = { autor: 1, preceptor: 5, preceptorVigente: true, vinculo: 'estagiario' as const };
    expect(
      novaRodadaDeCoassinatura(
        [
          { sequencia: 1, situacao: 'recusado' },
          { sequencia: 2, situacao: 'ajuste_solicitado' },
        ],
        p,
      ),
    ).toEqual({
      situacaoRegistro: 'aguardando_coassinatura',
      sequencia: 3,
      situacao: 'pendente',
      tipoVinculo: 'estagiario',
      supervisionado: 1,
      preceptor: 5,
    });
  });

  it('recusa a nova rodada com pedido pendente, registro coassinado, sem decisão contra, ou preceptor inválido', () => {
    const p = { autor: 1, preceptor: 5, preceptorVigente: true };
    expect(codigo(() => novaRodadaDeCoassinatura([{ sequencia: 1, situacao: 'pendente' }], p))).toBe(
      'rodada-pendente',
    );
    expect(codigo(() => novaRodadaDeCoassinatura([{ sequencia: 1, situacao: 'coassinado' }], p))).toBe(
      'registro-coassinado',
    );
    expect(codigo(() => novaRodadaDeCoassinatura([], p))).toBe('sem-decisao-anterior');
    expect(codigo(() => novaRodadaDeCoassinatura([{ sequencia: 1, situacao: 'cancelado' }], p))).toBe(
      'sem-decisao-anterior',
    );
    const recusado = [{ sequencia: 1, situacao: 'recusado' as const }];
    expect(codigo(() => novaRodadaDeCoassinatura(recusado, { ...p, preceptor: 1 }))).toBe(
      'preceptor-e-autor',
    );
    expect(codigo(() => novaRodadaDeCoassinatura(recusado, { ...p, preceptorVigente: false }))).toBe(
      'preceptor-indisponivel',
    );
  });
});
