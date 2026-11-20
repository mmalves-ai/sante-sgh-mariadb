// M35: o prefixo das filas no Valkey separa o E2E de um worktree do `pnpm dev` do dono (FILAS_PREFIXO).
import { describe, expect, it } from 'vitest';
import { prefixoDasFilas } from './relay-outbox.js';

describe('prefixo das filas', () => {
  it('padrão sgh; o do E2E aceito; formato fora do padrão recusado', () => {
    expect(prefixoDasFilas({})).toBe('sgh');
    expect(prefixoDasFilas({ FILAS_PREFIXO: ' ' })).toBe('sgh');
    expect(prefixoDasFilas({ FILAS_PREFIXO: 'sgh-e2e3435' })).toBe('sgh-e2e3435');
    expect(() => prefixoDasFilas({ FILAS_PREFIXO: 'outro' })).toThrow(/FILAS_PREFIXO/);
    expect(() => prefixoDasFilas({ FILAS_PREFIXO: 'sgh:*' })).toThrow(/FILAS_PREFIXO/);
  });
});
