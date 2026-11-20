import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hex, sha256 } from './sha256.js';

describe('SHA-256 puro (sem node:crypto, para o barril carregado pelas telas)', () => {
  it('dá o mesmo resumo do node:crypto (vazio, curto, acentos e mais de um bloco)', () => {
    for (const t of [
      '',
      'abc',
      'estudo:pc:PC0000000042',
      'ação é ü',
      'x'.repeat(55),
      'y'.repeat(64),
      'z'.repeat(1000),
    ])
      expect(hex(sha256(t))).toBe(createHash('sha256').update(t, 'utf8').digest('hex'));
  });
});
