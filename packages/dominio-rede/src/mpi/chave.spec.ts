// Chave do par (M57, regra 4): a mesma dos dois lados, só identificadores, forma canônica conferida.
import { describe, expect, it } from 'vitest';
import { chavePar, ErroChaveRede, ladoLocalERemoto, ladosDaChave } from './chave.js';

describe('chave do par', () => {
  it('a mesma nos dois sentidos', () => {
    const k = chavePar({ estabelecimento: 'pc', id: 7 }, { estabelecimento: 'hs', id: 12 });
    expect(k).toBe('hs:12|pc:7');
    expect(chavePar({ estabelecimento: 'hs', id: 12 }, { estabelecimento: 'pc', id: 7 })).toBe(k);
  });

  it('recusa o mesmo estabelecimento, chave malformada e fora de ordem', () => {
    expect(() => chavePar({ estabelecimento: 'pc', id: 1 }, { estabelecimento: 'pc', id: 2 })).toThrow(
      ErroChaveRede,
    );
    expect(() => ladosDaChave('pc:1')).toThrow(ErroChaveRede);
    expect(() => ladosDaChave('pc:1|PC:2')).toThrow(ErroChaveRede);
    expect(() => ladosDaChave('pc:1|hs:2')).toThrow(ErroChaveRede);
    expect(() => ladosDaChave('pc:0|qq:2')).toThrow(ErroChaveRede);
    expect(() => chavePar({ estabelecimento: 'pc', id: 0 }, { estabelecimento: 'hs', id: 2 })).toThrow(
      ErroChaveRede,
    );
  });

  it('lado local e remoto', () => {
    expect(ladoLocalERemoto('hs:12|pc:7', 'pc')).toEqual({
      local: { estabelecimento: 'pc', id: 7 },
      remoto: { estabelecimento: 'hs', id: 12 },
    });
    expect(ladoLocalERemoto('hs:12|pc:7', 'hs').local.id).toBe(12);
    expect(() => ladoLocalERemoto('hs:12|pc:7', 'zz')).toThrow(ErroChaveRede);
  });
});
