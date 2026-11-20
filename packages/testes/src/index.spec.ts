import { describe, expect, it } from 'vitest';
import { sequenciaSintetica } from './index.js';

describe('massa sintética', () => {
  it('gera identificadores sintéticos estáveis', () => {
    expect(sequenciaSintetica('PAC', 2)).toEqual(['PAC-001', 'PAC-002']);
  });
});
