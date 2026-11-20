// Do item da tela ao item avaliado pelo motor (produtos, via, doses, a critério, ficha).
import { describe, expect, it } from 'vitest';
import { esquemaItemPrescricao } from '@sgh/contratos';
import { produto } from '../alertas/fabrica.spec-util.js';
import {
  foraDaCategoria,
  frequenciasDesconhecidas,
  itemAvaliado,
  produtosDoItem,
  tipoDoItem,
  viaDoItem,
} from './avaliacao.js';

const it_ = (detalhe: unknown, extra: Record<string, unknown> = {}) =>
  esquemaItemPrescricao.parse({ chave: 'k', detalhe, ...extra });
const med = it_(
  {
    tipo: 'medicamento',
    item: { produto: 1 },
    dose: 500,
    unidade: 'MG',
    via: 'VO',
    frequencia: 1,
    seNecessario: { motivos: [1], intervaloMinimoHoras: 6 },
  },
  {
    antimicrobiano: {
      indicacao: 'PNM',
      sitio: 'pulmão',
      tipo: 'empirico',
      culturaColhida: true,
      diaTratamento: 1,
    },
  },
);
const sol = it_({
  tipo: 'solucao',
  via: 'EV',
  frequencia: 4,
  componentes: [
    { produto: 2, dose: 500, unidade: 'ML', principal: true },
    { produto: 3, dose: 10, unidade: 'ML', principal: false },
  ],
  etapas: [{ etapa: 1, velocidade: 21, unidadeInfusao: 1 }],
});
const gli = it_({
  tipo: 'glicemia',
  procedimento: 9,
  frequencia: 13,
  faixas: [
    { de: 180, ate: 250, produto: 4, dose: 2, unidade: 'UI', via: 'SC' },
    { de: 251, ate: 999, produto: 4, dose: 4, unidade: 'UI', via: 'SC' },
  ],
});
const dieta = it_({ tipo: 'dieta-oral', dieta: 5, frequencia: null, quantidade: 200 });

describe('avaliação do item', () => {
  it('produtos, via e frequência por tipo', () => {
    expect(produtosDoItem(med)).toEqual([{ produto: 1, dose: 500, unidade: 'MG' }]);
    expect(produtosDoItem(sol)).toHaveLength(2);
    expect(produtosDoItem(gli)).toEqual([{ produto: 4, dose: 4, unidade: 'UI' }]);
    expect(produtosDoItem(dieta)).toEqual([]);
    expect([viaDoItem(med), viaDoItem(sol), viaDoItem(gli), viaDoItem(dieta)]).toEqual([
      'VO',
      'EV',
      'SC',
      null,
    ]);
    expect(tipoDoItem(gli)).toBe('glicemia');
  });
  it('item avaliado com o cadastro do produto; produto desconhecido fica de fora', () => {
    const a = itemAvaliado(med, new Map([[1, produto({ produto: 1, antimicrobiano: true })]]));
    expect(a).toMatchObject({
      chave: 'k',
      aCriterio: true,
      fichaAntimicrobiano: true,
      dosesNoPeriodo: 1,
      seNecessario: { motivos: [1] },
    });
    expect(a.produtos).toHaveLength(1);
    expect(itemAvaliado(sol, new Map()).produtos).toEqual([]);
    expect(itemAvaliado(gli, new Map(), true)).toMatchObject({
      dosesNoPeriodo: 6,
      intervaloHoras: 4,
      existente: true,
      aCriterio: false,
    });
  });
  it('fora da categoria e frequência desconhecida', () => {
    expect(foraDaCategoria([med, dieta], 'nutricionista')).toEqual(['k']);
    expect(frequenciasDesconhecidas([it_({ tipo: 'procedimento', procedimento: 1, frequencia: 6 })])).toEqual(
      ['k'],
    );
    expect(frequenciasDesconhecidas([med])).toEqual([]);
  });
});
