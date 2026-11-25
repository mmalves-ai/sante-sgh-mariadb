// Lote de trabalho da bancada (F3.5, 05-SADT linha 8): a regra pura da montagem, da abertura, do fechamento e da
// impressão. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  conferirAberturaDoLote,
  conferirFechamentoDoLote,
  conferirImpressaoDoLote,
  montarLote,
  posicaoNoSuporte,
  situacaoNoFechamento,
} from './lote.js';

const c = (item: number, urgente = false, amostra: number | null = null) => ({ item, urgente, amostra });

describe('lote de trabalho da bancada', () => {
  it('monta com os urgentes primeiro, na ordem de chegada, com sequência e posição no suporte', () => {
    const lote = montarLote([c(10), c(11, true, 7), c(12), c(13, true)], null);
    expect(lote.map((x) => x.item)).toEqual([11, 13, 10, 12]);
    expect(lote.map((x) => x.sequencia)).toEqual([1, 2, 3, 4]);
    expect(lote.map((x) => x.posicaoSuporte)).toEqual(['001', '002', '003', '004']);
    expect(lote[0]!.amostra).toBe(7);
  });

  it('corta no limite do modelo de mapa: o urgente nunca fica de fora por causa de um de rotina', () => {
    const lote = montarLote([c(1), c(2), c(3, true)], 2);
    expect(lote.map((x) => x.item)).toEqual([3, 1]);
    expect(montarLote([c(1), c(2)], 0)).toHaveLength(2);
    expect(montarLote([], 5)).toEqual([]);
  });

  it('não repete o exame e continua a sequência do lote que já tem exames', () => {
    const lote = montarLote([c(1), c(1), c(2)], null, 3);
    expect(lote.map((x) => [x.item, x.sequencia, x.posicaoSuporte])).toEqual([
      [1, 4, '004'],
      [2, 5, '005'],
    ]);
    expect(posicaoNoSuporte(120)).toBe('120');
  });

  it('abre só com bancada, analista e ao menos um exame fora de lote', () => {
    const base = { bancadaExiste: true, analistaExiste: true, candidatos: 1 };
    expect(conferirAberturaDoLote(base)).toBeNull();
    expect(conferirAberturaDoLote({ ...base, bancadaExiste: false })).toBe('bancada-inexistente');
    expect(conferirAberturaDoLote({ ...base, analistaExiste: false })).toBe('analista-inexistente');
    expect(conferirAberturaDoLote({ ...base, candidatos: 0 })).toBe('sem-exames');
  });

  it('fecha só o lote em andamento; imprime o em andamento e o fechado, nunca o cancelado', () => {
    expect(conferirFechamentoDoLote('aberto')).toBeNull();
    expect(conferirFechamentoDoLote('em_processamento')).toBeNull();
    expect(conferirFechamentoDoLote('fechado')).toBe('lote-encerrado');
    expect(conferirFechamentoDoLote('cancelado')).toBe('lote-encerrado');
    expect(conferirFechamentoDoLote(null)).toBe('lote-inexistente');
    expect(conferirImpressaoDoLote('aberto')).toBeNull();
    expect(conferirImpressaoDoLote('fechado')).toBeNull();
    expect(conferirImpressaoDoLote('cancelado')).toBe('lote-encerrado');
    expect(conferirImpressaoDoLote(null)).toBe('lote-inexistente');
  });

  it('no fechamento, o pendente vira processado, cancelado ou volta à fila; o retido continua retido', () => {
    for (const s of ['resultado_digitado', 'revisado', 'liberado', 'entregue'])
      expect(situacaoNoFechamento('pendente', s)).toBe('processado');
    expect(situacaoNoFechamento('pendente', 'cancelado')).toBe('cancelado');
    expect(situacaoNoFechamento('pendente', 'recusado')).toBe('cancelado');
    expect(situacaoNoFechamento('pendente', 'em_analise')).toBe('pendente');
    // De volta à coleta (recoleta): não foi processado; fica pendente e só volta a um lote quando estiver em análise.
    expect(situacaoNoFechamento('pendente', 'coletado')).toBe('pendente');
    expect(situacaoNoFechamento('retido', 'liberado')).toBe('retido');
    expect(situacaoNoFechamento('repetir', 'em_analise')).toBe('repetir');
    expect(situacaoNoFechamento('processado', 'em_analise')).toBe('processado');
  });
});
