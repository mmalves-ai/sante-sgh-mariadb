// F3.8, 07-FIN linhas 98 e 99: reclassificação gerencial e permissões do financeiro (regras puras).
import { describe, expect, it } from 'vitest';
import { conferirEscopoConta, conferirTipoLancamento } from './permissao-financeiro.js';
import { planejarReclassificacao, type PedidoReclassificacao } from './reclassificacao.js';

const base: PedidoReclassificacao = {
  cancelado: false,
  competenciaFechada: false,
  valor: 1_000,
  antes: { natureza: 1, rateio: [{ centroCusto: 10, percentual: 100, valor: 1_000 }] },
  natureza: 2,
  rateio: [{ centroCusto: 10, percentual: 100 }],
  motivo: 'natureza lançada errada no título',
};

describe('reclassificação gerencial', () => {
  it('troca a natureza e reparte o rateio em centavos, com o centro principal de maior percentual', () => {
    const r = planejarReclassificacao({
      ...base,
      rateio: [
        { centroCusto: 10, percentual: 33.33 },
        { centroCusto: 20, percentual: 33.34 },
        { centroCusto: 30, percentual: 33.33 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.depois.rateio.map((x) => x.valor)).toEqual([333.3, 333.4, 333.3]);
    expect(r.centroPrincipal).toBe(20);
    expect(r.mudouNatureza && r.mudouRateio).toBe(true);
  });

  it('só o rateio muda: a natureza fica e o plano marca só o rateio', () => {
    const r = planejarReclassificacao({
      ...base,
      natureza: 1,
      rateio: [
        { centroCusto: 10, percentual: 60 },
        { centroCusto: 20, percentual: 40 },
      ],
    });
    expect(r.ok && [r.mudouNatureza, r.mudouRateio, r.centroPrincipal]).toEqual([false, true, 10]);
  });

  it('recusa: sem mudança, sem motivo, sem centro, cancelado, competência fechada e rateio que não fecha', () => {
    const cod = (p: Partial<PedidoReclassificacao>) => {
      const r = planejarReclassificacao({ ...base, ...p });
      return r.ok ? null : r.recusa.codigo;
    };
    expect(cod({ natureza: 1 })).toBe('reclassificacao-sem-mudanca');
    expect(cod({ tipoNaturezaAntes: 'despesa', tipoNaturezaNova: 'receita' })).toBe(
      'reclassificacao-tipo-trocado',
    );
    expect(cod({ tipoNaturezaAntes: 'despesa', tipoNaturezaNova: 'despesa' })).toBeNull();
    expect(cod({ motivo: ' erro ' })).toBe('reclassificacao-sem-motivo');
    expect(cod({ rateio: [] })).toBe('reclassificacao-sem-centro');
    expect(cod({ cancelado: true })).toBe('reclassificacao-cancelado');
    expect(cod({ competenciaFechada: true })).toBe('reclassificacao-periodo-fechado');
    expect(cod({ rateio: [{ centroCusto: 10, percentual: 90 }] })).toBe('rateio-nao-fecha');
    expect(
      cod({
        rateio: [
          { centroCusto: 10, percentual: 50 },
          { centroCusto: 10, percentual: 50 },
        ],
      }),
    ).toBe('rateio-repetido');
  });
});

describe('permissões do financeiro', () => {
  const escopo = {
    usuario: 7,
    quemMantem: 8,
    consultar: true,
    movimentar: true,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
  };
  it('escopo de conta: segregação, movimentar exige consultar, vigência não se inverte', () => {
    expect(conferirEscopoConta(escopo)).toBeNull();
    expect(conferirEscopoConta({ ...escopo, consultar: false, movimentar: false })).toBeNull();
    expect(conferirEscopoConta({ ...escopo, quemMantem: 7 })?.codigo).toBe('escopo-proprio');
    expect(conferirEscopoConta({ ...escopo, consultar: false })?.codigo).toBe(
      'escopo-movimentar-sem-consultar',
    );
    expect(conferirEscopoConta({ ...escopo, vigenciaFim: '2025-12-31' })?.codigo).toBe(
      'escopo-vigencia-invertida',
    );
  });
  it('tipo de lançamento: lista branca por perfil; sem lista, a permissão da operação vale', () => {
    expect(conferirTipoLancamento([], 5, 'Tarifa')).toBeNull();
    expect(conferirTipoLancamento([5, 6], 5, 'Tarifa')).toBeNull();
    expect(conferirTipoLancamento([6], 5, 'Tarifa')?.codigo).toBe('tipo-lancamento-nao-liberado');
  });
});
