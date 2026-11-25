// C2-030 (05-SUP linha 26): os lances da disputa aberta do pregão e do leilão (Lei 14.133, art. 56 e 57).
import { describe, expect, it } from 'vitest';
import {
  classificacaoDosLances,
  type LanceParaConferir,
  ofertaAnterior,
  podeRegistrarLance,
  sentidoDaDisputa,
} from '../index.js';

const lance = (x: Partial<LanceParaConferir> = {}): LanceParaConferir => ({
  etapa: 'sessao',
  modalidade: 'pregao_eletronico',
  proposta: { valor: 10, desclassificada: false, inabilitada: false },
  lancesProprios: [],
  valor: 9.5,
  intervaloMinimoPercentual: null,
  ...x,
});
const codigo = (x: Partial<LanceParaConferir>) => podeRegistrarLance(lance(x))?.codigo ?? null;

describe('lances da disputa aberta', () => {
  it('o sentido da disputa pela modalidade: pregão menor, leilão maior, as demais sem lance', () => {
    expect(sentidoDaDisputa('pregao-eletronico')).toBe('menor');
    expect(sentidoDaDisputa('pregao_presencial')).toBe('menor');
    expect(sentidoDaDisputa('leilao')).toBe('maior');
    expect(sentidoDaDisputa('concorrencia')).toBeNull();
    expect(codigo({ modalidade: 'concorrencia' })).toBe('lance-modalidade');
  });

  it('só na sessão, com valor positivo de até 4 casas', () => {
    expect(codigo({})).toBeNull();
    expect(codigo({ etapa: 'julgado' })).toBe('lance-etapa-invalida');
    expect(codigo({ valor: 0 })).toBe('lance-valor');
    expect(codigo({ valor: 9.12345 })).toBe('lance-valor');
    expect(codigo({ valor: 9.1234 })).toBeNull();
  });

  it('só quem tem proposta válida no item: sem proposta, desclassificada ou inabilitado ficam fora', () => {
    expect(codigo({ proposta: null })).toBe('lance-sem-proposta');
    expect(codigo({ proposta: { valor: 10, desclassificada: true, inabilitada: false } })).toBe(
      'lance-proposta-desclassificada',
    );
    expect(codigo({ proposta: { valor: 10, desclassificada: false, inabilitada: true } })).toBe(
      'lance-licitante-inabilitado',
    );
  });

  it('no pregão o lance fica abaixo da melhor oferta própria (proposta e lances anteriores)', () => {
    expect(ofertaAnterior('menor', 10, [9.5, 9.2])).toBe(9.2);
    expect(codigo({ lancesProprios: [9.5, 9.2], valor: 9.2 })).toBe('lance-nao-melhora');
    expect(codigo({ lancesProprios: [9.5, 9.2], valor: 9.3 })).toBe('lance-nao-melhora');
    expect(codigo({ lancesProprios: [9.5, 9.2], valor: 9.1 })).toBeNull();
    expect(codigo({ valor: 10 })).toBe('lance-nao-melhora');
  });

  it('no leilão o lance fica acima da oferta própria', () => {
    expect(codigo({ modalidade: 'leilao', valor: 9.5 })).toBe('lance-nao-melhora');
    expect(codigo({ modalidade: 'leilao', lancesProprios: [11], valor: 11.5 })).toBeNull();
    expect(ofertaAnterior('maior', 10, [11, 10.5])).toBe(11);
  });

  it('o intervalo mínimo do edital vale sobre a oferta anterior (art. 57)', () => {
    expect(codigo({ intervaloMinimoPercentual: 1, valor: 9.95 })).toBe('lance-intervalo-minimo');
    expect(codigo({ intervaloMinimoPercentual: 1, valor: 9.9 })).toBeNull();
    expect(codigo({ intervaloMinimoPercentual: 0, valor: 9.99 })).toBeNull();
  });

  it('a classificação parcial: a melhor oferta de cada licitante; no empate, quem chegou primeiro', () => {
    const r = classificacaoDosLances('menor', [
      { fornecedor: 1, valor: 9.5, ordem: 1 },
      { fornecedor: 2, valor: 9.4, ordem: 2 },
      { fornecedor: 1, valor: 9.0, ordem: 3 },
      { fornecedor: 3, valor: 9.0, ordem: 4 },
    ]);
    expect(r).toEqual([
      { fornecedor: 1, valor: 9, posicao: 1 },
      { fornecedor: 3, valor: 9, posicao: 2 },
      { fornecedor: 2, valor: 9.4, posicao: 3 },
    ]);
    expect(classificacaoDosLances('maior', [{ fornecedor: 1, valor: 5, ordem: 1 }])[0]?.posicao).toBe(1);
  });
});
