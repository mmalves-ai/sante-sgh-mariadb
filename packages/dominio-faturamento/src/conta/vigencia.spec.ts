// Regra 9 (ficha do M30): vale o último valor com data ≤ data-base (casos da sante-api reescritos com dados sintéticos).
import { describe, expect, it } from 'vitest';
import { dataBaseDoItem, vigenteNaData } from '../index.js';

const v = [
  { data: '2025-01-01', valor: 10 },
  { data: '2025-07-01', valor: 12 },
  { data: '2026-01-01', valor: 15 },
  { data: '1899-12-30', valor: 99 },
];

describe('vigência (regra 9)', () => {
  it('o último valor até a data-base, inclusive no próprio dia', () => {
    expect(vigenteNaData(v, '2025-06-30')?.valor).toBe(10);
    expect(vigenteNaData(v, '2025-07-01')?.valor).toBe(12);
    expect(vigenteNaData(v, '2027-01-01')?.valor).toBe(15);
  });
  it('antes da primeira vigência: nenhum; a sentinela nunca vale', () => {
    expect(vigenteNaData(v, '2024-12-31')).toBeNull();
    expect(vigenteNaData([{ data: '1899-12-30', valor: 1 }], '2026-01-01')).toBeNull();
  });
  it('ordem da lista não importa; data com hora conta pelo dia', () => {
    expect(vigenteNaData([...v].reverse(), '2025-08-15T10:00:00')?.valor).toBe(12);
  });
  it('a data-base é a data do lançamento', () => {
    expect(dataBaseDoItem({ data: '2026-03-04T12:00:00' })).toBe('2026-03-04');
  });
});
