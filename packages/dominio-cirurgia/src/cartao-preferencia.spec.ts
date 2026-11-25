import { describe, expect, it } from 'vitest';
import {
  cartaoAplicavel,
  chaveItemCartao,
  itensParaGasto,
  sugestaoParaMapa,
  validarCartaoPreferencia,
  type EntradaCartaoPreferencia,
} from './cartao-preferencia.js';

const base: EntradaCartaoPreferencia = {
  cirurgiao: 7,
  procedimento: 3,
  tempoMinutos: 90,
  itens: [{ natureza: 'material', insumo: 11, quantidade: 2 }],
};
const campos = (e: EntradaCartaoPreferencia) => validarCartaoPreferencia(e).map((p) => p.campo);

describe('validarCartaoPreferencia', () => {
  it('aceita o cartão completo', () => {
    expect(
      validarCartaoPreferencia({
        ...base,
        tamanhoLuva: '7,5',
        itens: [
          { natureza: 'material', insumo: 11, quantidade: 2 },
          { natureza: 'instrumental', caixaInstrumental: 4, quantidade: 1 },
          { natureza: 'equipamento', equipamento: 9, quantidade: 1 },
          { natureza: 'fio', descricao: 'Poliglactina 3-0', quantidade: 3 },
          { natureza: 'outro', descricao: 'Coxim de gel', quantidade: 1 },
        ],
      }),
    ).toEqual([]);
  });

  it('exige o cirurgião e algum conteúdo', () => {
    expect(campos({ cirurgiao: null, itens: [] })).toEqual(['cirurgiao', 'itens']);
  });

  it('recusa tempo fora da faixa e luva sem tamanho válido', () => {
    expect(campos({ ...base, tempoMinutos: 3 })).toEqual(['tempoMinutos']);
    expect(campos({ ...base, tempoMinutos: 1441 })).toEqual(['tempoMinutos']);
    expect(campos({ ...base, tamanhoLuva: '12' })).toEqual(['tamanhoLuva']);
    expect(campos({ ...base, tamanhoLuva: '8' })).toEqual([]);
  });

  it('confere a referência pela natureza, a descrição livre, a quantidade e o repetido', () => {
    expect(campos({ ...base, itens: [{ natureza: 'instrumental', insumo: 11, quantidade: 1 }] })).toEqual([
      'itens.0',
      'itens.0.descricao',
    ]);
    expect(campos({ ...base, itens: [{ natureza: 'equipamento', quantidade: 1 }] })).toEqual([
      'itens.0.descricao',
    ]);
    expect(campos({ ...base, itens: [{ natureza: 'material', insumo: 11, quantidade: 0 }] })).toEqual([
      'itens.0.quantidade',
    ]);
    expect(
      campos({
        ...base,
        itens: [
          { natureza: 'material', insumo: 11, quantidade: 1 },
          { natureza: 'medicamento', insumo: 11, quantidade: 1 },
        ],
      }),
    ).toEqual(['itens.1']);
    expect(
      chaveItemCartao({ natureza: 'outro', descricao: ' Coxim ', quantidade: 1 }) ===
        chaveItemCartao({ natureza: 'outro', descricao: 'coxim', quantidade: 2 }),
    ).toBe(true);
  });
});

describe('cartaoAplicavel', () => {
  const cartoes = [
    { id: 1, cirurgiao: 7, procedimento: null, ativo: true },
    { id: 2, cirurgiao: 7, procedimento: 3, ativo: true },
    { id: 3, cirurgiao: 7, procedimento: 4, ativo: false },
    { id: 4, cirurgiao: 8, procedimento: 3, ativo: true },
  ];
  it('o do procedimento ganha; sem ele (ou fora de uso), o geral; de outro cirurgião, nada', () => {
    expect(cartaoAplicavel(cartoes, 7, 3)?.id).toBe(2);
    expect(cartaoAplicavel(cartoes, 7, 4)?.id).toBe(1);
    expect(cartaoAplicavel(cartoes, 7, null)?.id).toBe(1);
    expect(cartaoAplicavel(cartoes, 9, 3)).toBeNull();
    expect(cartaoAplicavel(cartoes, 8, 5)).toBeNull();
  });
});

describe('sugestões do cartão', () => {
  it('mapa: sala, tempo e posição (vazios como nulo)', () => {
    expect(sugestaoParaMapa({ sala: 2, tempoMinutos: 60 })).toEqual({
      sala: 2,
      tempoMinutos: 60,
      posicao: null,
    });
  });
  it('gasto de sala: só os produtos do estoque, somados', () => {
    expect(
      itensParaGasto([
        { natureza: 'material', insumo: 11, quantidade: 2 },
        { natureza: 'instrumental', caixaInstrumental: 4, quantidade: 1 },
        { natureza: 'fio', insumo: 12, quantidade: 1 },
        { natureza: 'outro', descricao: 'Coxim', quantidade: 1 },
      ]),
    ).toEqual([
      { insumo: 11, quantidade: 2 },
      { insumo: 12, quantidade: 1 },
    ]);
  });
});
