// Leitura das respostas RESP em bytes: o tamanho do bulk é em bytes (texto acentuado em UTF-8 tem mais bytes
// que caracteres) e a resposta pode chegar em pedaços.
import { describe, expect, it } from 'vitest';
import { lerResposta } from './valkey.js';

describe('respostas do Valkey (RESP)', () => {
  it('bulk com acento: tamanho em bytes', () => {
    const texto = 'ação ½ €';
    const n = Buffer.byteLength(texto);
    expect(n).toBeGreaterThan(texto.length);
    expect(lerResposta(Buffer.from(`$${n}\r\n${texto}\r\n`))).toEqual({ valor: texto });
  });

  it('pedaço incompleto (corte no meio de um caractere de 2 bytes) espera o resto', () => {
    const inteiro = Buffer.from(`$4\r\nção\r\n`.replace('ção', 'çã'));
    expect(lerResposta(inteiro.subarray(0, 6))).toBeUndefined();
    expect(lerResposta(inteiro)).toEqual({ valor: 'çã' });
  });

  it('+OK, :inteiro, nulo e erro', () => {
    expect(lerResposta(Buffer.from('+OK\r\n'))).toEqual({ valor: 'OK' });
    expect(lerResposta(Buffer.from(':3\r\n'))).toEqual({ valor: 3 });
    expect(lerResposta(Buffer.from('$-1\r\n'))).toEqual({ valor: null });
    expect(lerResposta(Buffer.from('-ERR x\r\n'))).toEqual({ erro: 'ERR x' });
    expect(lerResposta(Buffer.from('+OK'))).toBeUndefined();
  });
});
