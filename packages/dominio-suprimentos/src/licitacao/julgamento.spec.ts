// M55, etapa 4 (Lei 14.133/2021, arts. 33 a 36, 59 e 60): a classificação por item, a proposta acima do estimado fora,
// o aviso de inexequível em obra, técnica e preço, maior desconto e maior lance, o empate e o desempate.
import { describe, expect, it } from 'vitest';
import { julgarItem, julgarLicitacao } from '../index.js';
import { item, proposta } from './fixtures.spec-util.js';

const lei = { regime: 'lei-14133', criterio: 'menor-preco', natureza: 'bens', pesoTecnica: null } as const;

describe('julgamento', () => {
  it('sem proposta: deserto; só inválidas: fracassado', () => {
    expect(julgarItem(item(1), [], lei).resultado).toBe('deserto');
    const r = julgarItem(
      item(1),
      [proposta(1, 5, 9, { situacao: 'desclassificada', motivo: 'Fora da especificação' })],
      lei,
    );
    expect(r.resultado).toBe('fracassado');
    expect(r.classificacao[0]).toMatchObject({ situacao: 'desclassificada', posicao: null });
  });
  it('menor preço: o lance vale sobre a proposta; acima do estimado sai (lei), fica (regulamento)', () => {
    const ps = [proposta(1, 5, 9.5, { lance: 8.9 }), proposta(1, 6, 9), proposta(1, 7, 12)];
    const r = julgarItem(item(1), ps, lei);
    expect(r).toMatchObject({ resultado: 'adjudicavel', vencedor: 5, valorUnitario: 8.9, valorTotal: 89 });
    expect(r.classificacao.map((c) => [c.fornecedor, c.posicao, c.situacao])).toEqual([
      [5, 1, 'valida'],
      [6, 2, 'valida'],
      [7, null, 'acima-estimado'],
    ]);
    const reg = julgarItem(item(1), ps, { ...lei, regime: 'regulamento' });
    expect(reg.classificacao.find((c) => c.fornecedor === 7)?.posicao).toBe(3);
  });
  it('obra: abaixo de 75% do estimado avisa inexequível', () => {
    const r = julgarItem(item(1), [proposta(1, 5, 7), proposta(1, 6, 8)], { ...lei, natureza: 'obra-comum' });
    expect(r.classificacao.map((c) => c.avisoInexequivel)).toEqual([true, false]);
  });
  it('empate sem desempate; com o desempate entre os empatados, vence o escolhido', () => {
    const ps = [proposta(1, 5, 9), proposta(1, 6, 9), proposta(1, 7, 9.5)];
    const e = julgarItem(item(1), ps, lei);
    expect(e).toMatchObject({ resultado: 'empate', vencedor: null, empatados: [5, 6] });
    expect(julgarItem(item(1), ps, lei, 7).resultado).toBe('empate');
    const d = julgarItem(item(1), ps, lei, 6);
    expect(d).toMatchObject({ resultado: 'adjudicavel', vencedor: 6, empatados: [5, 6] });
  });
  it('técnica e preço pelo peso; melhor técnica pela nota', () => {
    const ps = [proposta(1, 5, 10, { notaTecnica: 60 }), proposta(1, 6, 8, { notaTecnica: 50 })];
    const tp = julgarItem(item(1, { valorEstimado: 20 }), ps, {
      ...lei,
      criterio: 'tecnica-preco',
      pesoTecnica: 70,
    });
    // 5: 60×0,7 + (8/10)×100×0,3 = 42 + 24 = 66; 6: 50×0,7 + 100×0,3 = 35 + 30 = 65
    expect(tp.classificacao.map((c) => [c.fornecedor, c.pontuacao])).toEqual([
      [5, 66],
      [6, 65],
    ]);
    expect(tp.vencedor).toBe(5);
    const mt = julgarItem(item(1), ps, { ...lei, criterio: 'melhor-tecnica' });
    expect(mt.vencedor).toBe(5);
  });
  it('maior desconto e maior lance: o maior vence; o desconto não soma valor total', () => {
    const md = julgarItem(item(1), [proposta(1, 5, 12), proposta(1, 6, 15)], {
      ...lei,
      criterio: 'maior-desconto',
    });
    expect(md).toMatchObject({ vencedor: 6, valorTotal: null });
    const ml = julgarItem(
      item(1, { quantidade: 1 }),
      [proposta(1, 5, 500), proposta(1, 6, 450, { lance: 700 })],
      {
        ...lei,
        criterio: 'maior-lance',
      },
    );
    expect(ml).toMatchObject({ vencedor: 6, valorTotal: 700 });
  });
  it('o processo: total com as parcelas, contagem de empates, fracassos e desertos', () => {
    const itens = [item(1), item(2), item(3), item(4)];
    const ps = [proposta(1, 5, 9), proposta(2, 5, 8), proposta(2, 6, 8), proposta(3, 5, 50)];
    const j = julgarLicitacao(itens, ps, lei);
    expect(j).toMatchObject({
      valorTotal: 90,
      empates: 1,
      fracassados: 1,
      desertos: 1,
      conta: 'item 1: 90,00 = 90,00',
    });
    const d = julgarLicitacao(itens, ps, lei, [{ item: 2, fornecedor: 6 }]);
    expect(d.valorTotal).toBe(170);
    expect(d.conta).toBe('item 1: 90,00 + item 2: 80,00 = 170,00');
    expect(julgarLicitacao([item(9)], [], lei).conta).toBe('Nenhum item com valor adjudicado.');
  });
});
