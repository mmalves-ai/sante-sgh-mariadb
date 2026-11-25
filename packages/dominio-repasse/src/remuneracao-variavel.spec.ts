// Remuneração variável (F8, 07-FIN linha 157): mínimo garantido, resultado, produtividade por meta e custo do prestador.
import { describe, expect, it } from 'vitest';
import {
  calcularRemuneracaoVariavel,
  conflitoDeVigencia,
  type EntradaRemuneracaoVariavel,
  faixaDoValor,
  validarMeta,
  validarMinimoGarantido,
  validarRegraResultado,
  validarValorFixo,
  vigenteNaCompetencia,
} from './remuneracao-variavel.js';

const base: EntradaRemuneracaoVariavel = {
  competencia: '2026-10-01',
  producaoCentavos: 800_000,
  minimo: null,
  resultados: [],
  metas: [],
  custos: [],
};

describe('remuneração variável: regras', () => {
  it('vigência na competência considera o mês inteiro', () => {
    expect(vigenteNaCompetencia({ inicio: '2026-10-31', fim: null }, '2026-10-01')).toBe(true);
    expect(vigenteNaCompetencia({ inicio: '2026-01-01', fim: '2026-09-30' }, '2026-10-01')).toBe(false);
    expect(vigenteNaCompetencia({ inicio: '2026-11-01', fim: null }, '2026-10-01')).toBe(false);
  });

  it('recusa mínimo sem valor, percentual fora de 0..100 e vigência invertida', () => {
    expect(validarMinimoGarantido({ valorMinimo: 0, inicio: '2026-01-01', fim: null })).toHaveLength(1);
    expect(validarRegraResultado({ percentual: 120, inicio: '2026-02-01', fim: '2026-01-01' })).toHaveLength(
      2,
    );
    expect(validarRegraResultado({ percentual: 5, inicio: '2026-01-01', fim: null })).toEqual([]);
  });

  it('recusa regra que cruza outra vigente do mesmo profissional', () => {
    expect(
      conflitoDeVigencia({ inicio: '2026-06-01', fim: null }, [{ inicio: '2026-01-01', fim: null }]),
    ).toHaveLength(1);
    expect(
      conflitoDeVigencia({ inicio: '2026-06-01', fim: null }, [{ inicio: '2026-01-01', fim: '2026-05-31' }]),
    ).toEqual([]);
  });

  it('faixas da meta: sem sobreposição, prêmio positivo e percentual até 100', () => {
    const ok = validarMeta({
      forma: 'percentual_producao',
      peso: 100,
      inicio: '2026-01-01',
      fim: null,
      faixas: [
        { de: 80, ate: 89.99, premio: 5 },
        { de: 90, ate: null, premio: 10 },
      ],
    });
    expect(ok).toEqual([]);
    const ruim = validarMeta({
      forma: 'percentual_producao',
      peso: 0,
      inicio: '2026-01-01',
      fim: null,
      faixas: [
        { de: 80, ate: 95, premio: 150 },
        { de: 90, ate: null, premio: 0 },
      ],
    });
    expect(ruim.map((p) => p.campo)).toEqual(['peso', 'faixas.0', 'faixas.1', 'faixas.1']);
    expect(
      validarMeta({ forma: 'valor_fixo', peso: 50, inicio: '2026-01-01', fim: null, faixas: [] }),
    ).toHaveLength(1);
  });

  it('faixa do valor apurado', () => {
    const f = [
      { de: 80, ate: 89.99, premio: 5 },
      { de: 90, ate: null, premio: 10 },
    ];
    expect(faixaDoValor(f, 79)).toBeNull();
    expect(faixaDoValor(f, 85)?.premio).toBe(5);
    expect(faixaDoValor(f, 99)?.premio).toBe(10);
  });
});

describe('remuneração variável: cálculo', () => {
  it('complementa a produção até o mínimo garantido; acima do mínimo, nada', () => {
    const r = calcularRemuneracaoVariavel({ ...base, minimo: { id: 1, valorMinimo: 10_000, evento: 7 } });
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({
      tipo: 'complemento_minimo',
      valorCentavos: 200_000,
      sentido: 'credito',
    });
    expect(r.creditoCentavos).toBe(200_000);
    expect(
      calcularRemuneracaoVariavel({ ...base, minimo: { id: 1, valorMinimo: 5_000, evento: 7 } }).itens,
    ).toEqual([]);
  });

  it('percentual do resultado só sobre margem positiva; sem custeio apurado vira pendência', () => {
    const r = calcularRemuneracaoVariavel({
      ...base,
      resultados: [
        { id: 2, percentual: 2.5, evento: 8, centroCusto: 3, margemCentavos: 4_000_000 },
        { id: 3, percentual: 10, evento: 8, centroCusto: 4, margemCentavos: -100 },
        { id: 4, percentual: 10, evento: 8, centroCusto: 5, margemCentavos: null },
      ],
    });
    expect(r.itens.map((i) => [i.regra, i.valorCentavos])).toEqual([[2, 100_000]]);
    expect(r.pendencias).toHaveLength(1);
  });

  it('produtividade: faixa do indicador × peso, em percentual da produção ou valor fixo', () => {
    const r = calcularRemuneracaoVariavel({
      ...base,
      metas: [
        {
          id: 5,
          indicador: 'SATISF',
          forma: 'percentual_producao',
          peso: 50,
          evento: 9,
          valorApurado: 92,
          faixas: [
            { de: 80, ate: 89.99, premio: 5 },
            { de: 90, ate: null, premio: 10 },
          ],
        },
        {
          id: 6,
          indicador: 'TEMPO',
          forma: 'valor_fixo',
          peso: 100,
          evento: 9,
          valorApurado: 30,
          faixas: [{ de: 0, ate: 40, premio: 300 }],
        },
        {
          id: 7,
          indicador: 'FORA',
          forma: 'valor_fixo',
          peso: 100,
          evento: 9,
          valorApurado: 99,
          faixas: [{ de: 0, ate: 40, premio: 300 }],
        },
      ],
    });
    expect(r.itens.map((i) => [i.regra, i.valorCentavos])).toEqual([
      [5, 40_000],
      [6, 30_000],
    ]);
  });

  it('custo do prestador: valor, percentual, faixa de produção e frequência única', () => {
    const custo = {
      tipoDesconto: 1,
      descricao: 'Sala',
      natureza: 'desconto' as const,
      valor: null,
      percentual: null,
      faixaInicial: null,
      faixaFinal: null,
      frequencia: 'mensal' as const,
      jaDescontada: false,
    };
    const r = calcularRemuneracaoVariavel({
      ...base,
      custos: [
        { ...custo, id: 10, forma: 'valor', valor: 500 },
        { ...custo, id: 11, forma: 'percentual', percentual: 3 },
        { ...custo, id: 12, forma: 'valor', valor: 100, faixaInicial: 9_000 },
        { ...custo, id: 13, forma: 'valor', valor: 100, frequencia: 'unica', jaDescontada: true },
        { ...custo, id: 14, forma: 'valor', valor: 100, natureza: 'acrescimo' },
      ],
    });
    expect(r.itens.map((i) => [i.regra, i.valorCentavos, i.sentido])).toEqual([
      [10, 50_000, 'debito'],
      [11, 24_000, 'debito'],
    ]);
    expect(r.debitoCentavos).toBe(74_000);
  });

  it('item sem evento fica pendente; o referente identifica a regra e a competência', () => {
    const r = calcularRemuneracaoVariavel({ ...base, minimo: { id: 1, valorMinimo: 10_000, evento: null } });
    expect(r.pendencias).toHaveLength(1);
    expect(r.itens[0]!.referente).toBe('Complemento do mínimo garantido 2026-10 (regra 1)');
  });
});

describe('valor fixo mensal e mínimo garantido (C2-100)', () => {
  const fixo = { id: 7, descricao: 'COORDENACAO', valorMensal: 3000, evento: 9, lancadoNaCompetencia: false };

  it('recusa valor fixo sem descrição, sem valor, dia fora de 1..31 e vigência invertida', () => {
    const p = validarValorFixo({
      descricao: ' ',
      valorMensal: 0,
      diaPagamento: 32,
      inicio: '2026-10-01',
      fim: '2026-09-01',
    });
    expect(p.map((x) => x.campo).sort()).toEqual(['descricao', 'diaPagamento', 'fim', 'valorMensal']);
    expect(
      validarValorFixo({
        descricao: 'X',
        valorMensal: 10,
        diaPagamento: null,
        inicio: '2026-10-01',
        fim: null,
      }),
    ).toEqual([]);
  });

  it('o fixo entra uma vez por competência, qualquer que seja a produção', () => {
    const r = calcularRemuneracaoVariavel({ ...base, producaoCentavos: 0, fixos: [fixo] });
    expect(r.itens).toEqual([
      expect.objectContaining({
        tipo: 'valor_fixo',
        valorCentavos: 300_000,
        evento: 9,
        referente: 'Valor fixo mensal 2026-10 (regra 7)',
      }),
    ]);
    expect(r.creditoCentavos).toBe(300_000);
    const ja = calcularRemuneracaoVariavel({ ...base, fixos: [{ ...fixo, lancadoNaCompetencia: true }] });
    expect(ja.itens).toEqual([]);
  });

  it('o mínimo completa só a produção até o piso; o fixo não conta como produção', () => {
    const r = calcularRemuneracaoVariavel({
      ...base,
      producaoCentavos: 600_000,
      minimo: { id: 1, valorMinimo: 10_000, evento: 9 },
      fixos: [fixo],
    });
    const comp = r.itens.find((i) => i.tipo === 'complemento_minimo');
    expect(comp?.valorCentavos).toBe(400_000);
    expect(r.creditoCentavos).toBe(700_000);
    const acima = calcularRemuneracaoVariavel({
      ...base,
      producaoCentavos: 1_200_000,
      minimo: { id: 1, valorMinimo: 10_000, evento: 9 },
    });
    expect(acima.itens).toEqual([]);
  });

  it('fixo sem evento fica nas pendências', () => {
    const r = calcularRemuneracaoVariavel({ ...base, fixos: [{ ...fixo, evento: null }] });
    expect(r.pendencias).toEqual(['O valor fixo 7 não tem evento do lançamento: defina o evento na regra.']);
  });
});
