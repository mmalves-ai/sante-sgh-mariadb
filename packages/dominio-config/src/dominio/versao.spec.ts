import { describe, expect, it } from 'vitest';
import { camposMudados, lerVersao, versaoDoItem } from './versao.js';

describe('versão do item (controle otimista pelas colunas mostradas)', () => {
  it('ida e volta, independente da ordem das chaves', () => {
    const v = versaoDoItem({ b: 2, a: 'x', c: null }, true);
    expect(v).toBe(versaoDoItem({ a: 'x', c: null, b: 2 }, true));
    expect(lerVersao(v)).toEqual({ valores: { a: 'x', b: 2, c: null }, ativo: true });
  });
  it('versão malformada é recusada', () => {
    expect(lerVersao('não é json')).toBeNull();
    expect(lerVersao('{"v":1,"a":true}')).toBeNull();
    expect(lerVersao('{"v":{"a":{}},"a":true}')).toBeNull();
    expect(lerVersao('{"v":{},"a":"sim"}')).toBeNull();
    expect(lerVersao('null')).toBeNull();
  });
  it('campos mudados (espaço à direita do CHAR não conta)', () => {
    expect(camposMudados({ a: 'x ', b: 1, c: null }, { a: 'x', b: 2, d: 'novo' })).toEqual(['b', 'd']);
  });
});
