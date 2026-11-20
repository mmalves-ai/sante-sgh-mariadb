// Regra 5 do M32: nenhuma baixa sem aprovação na alçada; faixa por valor, centro de custo e tipo de credor, dupla
// aprovação acima do limite, vigência. As parcelas de cada conta estão escritas no teste.
import { describe, expect, it } from 'vitest';
import {
  alcadaAplicavel,
  type AprovacaoRegistrada,
  conferirAprovacao,
  conferirFaixas,
  conferirPagamento,
  type FaixaAlcada,
  pagosSemAprovacao,
  situacaoAprovacao,
} from './index.js';

const f = (x: Partial<FaixaAlcada> & { id: number }): FaixaAlcada => ({
  empresa: 1,
  centroCusto: null,
  tipoCredor: null,
  valorDe: 0,
  valorAte: null,
  aprovacoes: 1,
  permissao: 'financeiro.tituloPagar.aprovar',
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativa: true,
  ...x,
});

const FAIXAS = [
  f({ id: 1, valorDe: 0, valorAte: 10_000 }),
  f({
    id: 2,
    valorDe: 10_000.01,
    valorAte: null,
    aprovacoes: 2,
    permissao: 'financeiro.tituloPagar.aprovarDiretoria',
  }),
  f({ id: 3, valorDe: 0, valorAte: 5_000, centroCusto: 40, tipoCredor: 'M' }),
  f({ id: 4, valorDe: 0, valorAte: 50_000, centroCusto: 40 }),
  f({ id: 5, valorDe: 0, valorAte: null, vigenciaFim: '2025-12-31', vigenciaInicio: '2025-01-01' }),
];
const titulo = { empresa: 1, centroCusto: null, tipo: 'F' as const, valor: 2_500 };

describe('alçada (regra 5)', () => {
  it('a faixa mais específica que cabe no valor e na vigência', () => {
    expect(alcadaAplicavel(FAIXAS, titulo, '2026-03-01')?.id).toBe(1);
    expect(alcadaAplicavel(FAIXAS, { ...titulo, valor: 10_000.01 }, '2026-03-01')?.id).toBe(2);
    expect(
      alcadaAplicavel(FAIXAS, { ...titulo, centroCusto: 40, tipo: 'M', valor: 4_999.99 }, '2026-03-01')?.id,
    ).toBe(3);
    expect(
      alcadaAplicavel(FAIXAS, { ...titulo, centroCusto: 40, tipo: 'M', valor: 5_000.01 }, '2026-03-01')?.id,
    ).toBe(4);
    expect(alcadaAplicavel(FAIXAS, titulo, '2025-06-01')?.id).toBe(5);
    expect(alcadaAplicavel([], titulo, '2026-03-01')).toBeNull();
    expect(alcadaAplicavel(FAIXAS, { ...titulo, empresa: 2 }, '2026-03-01')).toBeNull();
    expect(alcadaAplicavel([f({ id: 9, ativa: false })], titulo, '2026-03-01')).toBeNull();
  });
  it('faixas: invertidas e sobrepostas recusadas; vigências sem encontro convivem', () => {
    expect(conferirFaixas([f({ id: 1, valorDe: 10, valorAte: 5 })])?.codigo).toBe('faixa-invertida');
    expect(
      conferirFaixas([f({ id: 1, vigenciaInicio: '2026-02-01', vigenciaFim: '2026-01-01' })])?.codigo,
    ).toBe('vigencia-invertida');
    expect(conferirFaixas([f({ id: 1, valorAte: 100 }), f({ id: 2, valorDe: 50 })])?.codigo).toBe(
      'faixas-sobrepostas',
    );
    expect(conferirFaixas([f({ id: 1, valorAte: 100 }), f({ id: 2, valorDe: 100.01 })])).toBeNull();
    expect(
      conferirFaixas([f({ id: 1, vigenciaFim: '2025-12-31', vigenciaInicio: '2025-01-01' }), f({ id: 2 })]),
    ).toBeNull();
    expect(conferirFaixas([f({ id: 1 }), f({ id: 2, centroCusto: 40 })])).toBeNull();
  });
  it('dupla aprovação: 2 pessoas diferentes; a mesma pessoa duas vezes conta uma', () => {
    const faixa = FAIXAS[1] as FaixaAlcada;
    const a = (aprovador: string): AprovacaoRegistrada => ({
      aprovador,
      ordem: 1,
      faixa: 2,
      em: '2026-03-01',
    });
    expect(situacaoAprovacao(faixa, [a('BRUNO')])).toEqual({
      aprovado: false,
      exigidas: 2,
      feitas: 1,
      faltam: 1,
    });
    expect(situacaoAprovacao(faixa, [a('BRUNO'), a('bruno')]).feitas).toBe(1);
    expect(situacaoAprovacao(faixa, [a('BRUNO'), a('DORA')]).aprovado).toBe(true);
    expect(situacaoAprovacao(null, []).aprovado).toBe(false);
  });
  it('aprovar: recusas na ordem (baixado, sem faixa, quem lançou, fora da alçada, já aprovou, já aprovado)', () => {
    const base = {
      faixa: FAIXAS[0] as FaixaAlcada,
      aprovacoes: [] as AprovacaoRegistrada[],
      aprovador: 'BRUNO',
      lancador: 'ANA',
      temPermissaoDaFaixa: true,
      valor: 2_500,
      emAberto: true,
    };
    expect(conferirAprovacao({ ...base, emAberto: false })?.codigo).toBe('titulo-baixado');
    expect(conferirAprovacao({ ...base, faixa: null })?.mensagem).toContain('R$ 2.500,00');
    expect(conferirAprovacao({ ...base, aprovador: 'ana' })?.codigo).toBe('segregacao-lancou-aprova');
    expect(conferirAprovacao({ ...base, temPermissaoDaFaixa: false })?.codigo).toBe('fora-da-alcada');
    const feita = { aprovador: 'BRUNO', ordem: 1 as const, faixa: 1, em: '2026-03-01' };
    expect(conferirAprovacao({ ...base, aprovacoes: [feita] })?.codigo).toBe('ja-aprovou');
    expect(conferirAprovacao({ ...base, aprovador: 'DORA', aprovacoes: [feita] })?.codigo).toBe(
      'ja-aprovado',
    );
    expect(conferirAprovacao(base)).toBeNull();
  });
  it('pagar: sem aprovação (ou com 1 de 2) recusa; quem lançou ou aprovou não paga', () => {
    const faixa = FAIXAS[1] as FaixaAlcada;
    const um = [{ aprovador: 'BRUNO', ordem: 1 as const, faixa: 2, em: '2026-03-01' }];
    expect(conferirPagamento({ faixa, aprovacoes: [], pagador: 'CARLA', lancador: 'ANA' })?.codigo).toBe(
      'sem-aprovacao',
    );
    expect(
      conferirPagamento({ faixa, aprovacoes: um, pagador: 'CARLA', lancador: 'ANA' })?.mensagem,
    ).toContain('1 de 2');
    const dois = [...um, { aprovador: 'DORA', ordem: 2 as const, faixa: 2, em: '2026-03-02' }];
    expect(conferirPagamento({ faixa, aprovacoes: dois, pagador: 'ANA', lancador: 'ANA' })?.codigo).toBe(
      'segregacao-lancou-paga',
    );
    expect(conferirPagamento({ faixa, aprovacoes: dois, pagador: 'DORA', lancador: 'ANA' })?.codigo).toBe(
      'segregacao-aprovou-paga',
    );
    expect(conferirPagamento({ faixa, aprovacoes: dois, pagador: 'CARLA', lancador: 'ANA' })).toBeNull();
  });
  it('indicador "pagos sem aprovação" nos dois sistemas: 3 pagos sem aprovação no outro, 0 no novo, de 5 pagos', () => {
    const r = pagosSemAprovacao([
      { pago: true, aprovado: true, pagoPeloNovo: true },
      { pago: true, aprovado: true, pagoPeloNovo: true },
      { pago: true, aprovado: false, pagoPeloNovo: false },
      { pago: true, aprovado: false, pagoPeloNovo: false },
      { pago: true, aprovado: false, pagoPeloNovo: false },
      { pago: false, aprovado: false, pagoPeloNovo: false },
    ]);
    // 3 / 5 = 60%.
    expect(r).toEqual({
      pagos: 5,
      comAprovacao: 2,
      semAprovacaoNoNovo: 0,
      semAprovacaoNoOutro: 3,
      percentual: 60,
    });
    expect(pagosSemAprovacao([]).percentual).toBe(0);
  });
});
