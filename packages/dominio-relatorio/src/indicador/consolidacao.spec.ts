// Regra 8 do M57 (etapa 3): mesma ficha técnica nos estabelecimentos; consolidado = Σ numeradores ÷ Σ denominadores,
// nunca a média das taxas; as parcelas impressas. Massa sintética (só contagens).
import type { SeriePainel } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { fichaDe } from '../fichas.js';
import {
  consolidarSerie,
  consolidarSeriePainel,
  consolidarValor,
  contaImpressa,
  ErroConsolidacao,
  mediaDasTaxas,
  type ParcelaIndicador,
} from './consolidacao.js';

const V1 = { versao: 1, parametros: {} };
const mortalidade = fichaDe('taxaMortalidadeGeral')!;
const parcela = (
  estabelecimento: string,
  numerador: number | null,
  denominador: number | null,
  periodo = '2026-05',
  definicao = V1,
): ParcelaIndicador => ({
  estabelecimento,
  definicao,
  valor: {
    periodo,
    numerador,
    denominador,
    valor: numerador !== null && denominador ? (numerador / denominador) * 100 : null,
    parcial: false,
  },
});

function recusa(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErroConsolidacao) return e.motivo;
    throw e;
  }
  return 'aceito';
}

describe('consolidação da Rede (regra 8)', () => {
  it('soma dos numeradores sobre a soma dos denominadores, diferente da média das taxas', () => {
    // A: 2 óbitos em 10 saídas (20%); B: 10 em 1.000 (1%). Média das taxas: 10,5%. Consolidado: 12/1.010 = 1,19%.
    const c = consolidarValor(mortalidade, [parcela('pc', 2, 10), parcela('hs', 10, 1_000)]);
    expect(c).toMatchObject({ numerador: 12, denominador: 1_010, valor: 1.19, parcial: false });
    expect(mediaDasTaxas(c.parcelas.map((p) => p.valor))).toBe(10.5);
    expect(c.valor).not.toBe(mediaDasTaxas(c.parcelas.map((p) => p.valor)));
    expect(c.parcelas.map((p) => [p.estabelecimento, p.numerador, p.denominador])).toEqual([
      ['pc', 2, 10],
      ['hs', 10, 1_000],
    ]);
  });

  it('a média de taxas é recusada: parcela só com a taxa (sem numerador ou denominador)', () => {
    const soTaxa: ParcelaIndicador = {
      estabelecimento: 'hs',
      definicao: V1,
      valor: { periodo: '2026-05', numerador: undefined, denominador: undefined, valor: 1, parcial: false },
    };
    expect(recusa(() => consolidarValor(mortalidade, [parcela('pc', 2, 10), soTaxa]))).toBe('media-de-taxas');
    expect(recusa(() => consolidarValor(mortalidade, [parcela('pc', 2, null)]))).toBe('media-de-taxas');
    expect(recusa(() => consolidarValor(mortalidade, [parcela('pc', Number.NaN, 3)]))).toBe('media-de-taxas');
  });

  it('as parcelas impressas: a conta pode ser refeita por quem lê', () => {
    const c = consolidarValor(mortalidade, [parcela('pc', 2, 10), parcela('hs', 10, 1_000)]);
    expect(contaImpressa(mortalidade, c)).toBe('(2 + 10) ÷ (10 + 1.000) × 100 = 1,19');
    const um = consolidarValor(mortalidade, [parcela('pc', 2, 10)]);
    expect(contaImpressa(mortalidade, um)).toBe('2 ÷ 10 × 100 = 20');
    const adm = fichaDe('admissoes')!;
    const soma = consolidarValor(adm, [parcela('pc', 120, null), parcela('hs', 80, null)]);
    expect(soma).toMatchObject({ numerador: 200, denominador: null, valor: 200 });
    expect(contaImpressa(adm, soma)).toBe('120 + 80 = 200');
    expect(contaImpressa(adm, consolidarValor(adm, [parcela('pc', 7, null)]))).toBe('7 = 7');
    const zero = consolidarValor(mortalidade, [parcela('pc', 0, 0), parcela('hs', 0, 0)]);
    expect(zero.valor).toBeNull();
    expect(contaImpressa(mortalidade, zero)).toMatch(/sem valor/);
  });

  it('os dias do período não se somam: o censo médio diário da Rede é Σ pacientes-dia ÷ dias do mês', () => {
    const f = fichaDe('mediaPacientesDia')!;
    const c = consolidarValor(f, [parcela('pc', 300, 31), parcela('hs', 620, 31)]);
    expect(c).toMatchObject({ numerador: 920, denominador: 31, valor: 29.68 });
    expect(contaImpressa(f, c)).toBe('(300 + 620) ÷ 31 = 29,68');
    expect(recusa(() => consolidarValor(f, [parcela('pc', 300, 31), parcela('hs', 620, 30)]))).toBe(
      'periodo-diferente',
    );
  });

  it('a mesma ficha técnica: versão ou parâmetro da definição diferente recusa o consolidado', () => {
    const f = fichaDe('taxaOcupacaoIntensiva')!;
    const a = { versao: 1, parametros: { intensivas: '3,7' } };
    const b = { versao: 1, parametros: { intensivas: '3' } };
    expect(
      recusa(() =>
        consolidarValor(f, [parcela('pc', 1, 2, '2026-05', a), parcela('hs', 1, 2, '2026-05', b)]),
      ),
    ).toBe('ficha-diferente');
    expect(
      recusa(() =>
        consolidarValor(f, [
          parcela('pc', 1, 2, '2026-05', V1),
          parcela('hs', 1, 2, '2026-05', { versao: 2, parametros: {} }),
        ]),
      ),
    ).toBe('ficha-diferente');
    expect(recusa(() => consolidarValor(f, []))).toBe('sem-parcelas');
    expect(
      recusa(() => consolidarValor(f, [parcela('pc', 1, 2, '2026-05'), parcela('hs', 1, 2, '2026-04')])),
    ).toBe('periodo-diferente');
  });

  it('a série: mês a mês, cada mês com as parcelas que têm o mês; o parcial vem de qualquer parcela', () => {
    const s = consolidarSerie(mortalidade, [
      {
        estabelecimento: 'pc',
        definicao: V1,
        valores: [
          { periodo: '2026-04', numerador: 1, denominador: 10, valor: 10, parcial: false },
          { periodo: '2026-05', numerador: 2, denominador: 10, valor: 20, parcial: true },
        ],
      },
      {
        estabelecimento: 'hs',
        definicao: V1,
        valores: [{ periodo: '2026-05', numerador: 0, denominador: 30, valor: 0, parcial: false }],
      },
    ]);
    expect(
      s.map((x) => [x.periodo, x.numerador, x.denominador, x.valor, x.parcial, x.parcelas.length]),
    ).toEqual([
      ['2026-04', 1, 10, 10, false, 1],
      ['2026-05', 2, 40, 5, true, 2],
    ]);
    expect(mediaDasTaxas([])).toBeNull();
  });

  it('séries dos painéis: contagens e reais se somam; percentual por Σ÷Σ; taxa sozinha recusada', () => {
    const serie = (
      codigo: string,
      unidade: SeriePainel['unidade'],
      vs: SeriePainel['valores'],
    ): SeriePainel => ({
      codigo,
      rotulo: codigo,
      unidade,
      regua: null,
      valores: vs,
    });
    const v = (valor: number | null, numerador: number | null = null, denominador: number | null = null) => ({
      periodo: '2026-05',
      valor,
      numerador,
      denominador,
      parcial: false,
    });
    const q = consolidarSeriePainel([
      { estabelecimento: 'pc', serie: serie('cirurgias', 'quantidade', [v(10)]) },
      { estabelecimento: 'hs', serie: serie('cirurgias', 'quantidade', [v(5)]) },
    ]);
    expect(q.valores[0]).toMatchObject({ valor: 15, numerador: null });
    expect(q.parcelas.map((p) => p.valores[0]!.valor)).toEqual([10, 5]);
    const vazio = consolidarSeriePainel([
      { estabelecimento: 'pc', serie: serie('cirurgias', 'quantidade', [v(null)]) },
    ]);
    expect(vazio.valores[0]!.valor).toBeNull();
    const g = consolidarSeriePainel([
      { estabelecimento: 'pc', serie: serie('glosa', 'percentual', [v(50, 50, 100)]) },
      { estabelecimento: 'hs', serie: serie('glosa', 'percentual', [v(10, 100, 1_000)]) },
    ]);
    expect(g.valores[0]).toMatchObject({ numerador: 150, denominador: 1_100, valor: 13.6 });
    const r = consolidarSeriePainel([
      { estabelecimento: 'pc', serie: serie('x', 'razao', [v(2, 4, 2)]) },
      { estabelecimento: 'hs', serie: serie('x', 'razao', [v(0, 0, 0)]) },
    ]);
    expect(r.valores[0]!.valor).toBe(2);
    const z = consolidarSeriePainel([{ estabelecimento: 'pc', serie: serie('x', 'razao', [v(null, 0, 0)]) }]);
    expect(z.valores[0]!.valor).toBeNull();
    expect(
      recusa(() =>
        consolidarSeriePainel([
          { estabelecimento: 'pc', serie: serie('glosa', 'percentual', [v(50, 50, 100)]) },
          { estabelecimento: 'hs', serie: serie('glosa', 'percentual', [v(10)]) },
        ]),
      ),
    ).toBe('media-de-taxas');
    expect(
      recusa(() =>
        consolidarSeriePainel([
          { estabelecimento: 'pc', serie: serie('a', 'quantidade', [v(1)]) },
          { estabelecimento: 'hs', serie: serie('b', 'quantidade', [v(1)]) },
        ]),
      ),
    ).toBe('ficha-diferente');
    expect(recusa(() => consolidarSeriePainel([]))).toBe('sem-parcelas');
  });
});
