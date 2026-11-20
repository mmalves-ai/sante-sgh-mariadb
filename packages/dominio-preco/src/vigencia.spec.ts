import { describe, expect, it } from 'vitest';
import { dataDeCalendario, dataDeVigencia, linhaDoTempo, proximaVigencia, vigenteEm } from './vigencia.js';

const v = (data: string, valor: number) => ({ data, valor });
const lista = [v('2024-01-01', 10), v('2025-03-15', 12), v('2026-10-20', 15), v('1899-12-30', 1)];

describe('vigência (regra 1: maior data ≤ data-base)', () => {
  it('data exata da vigência vale ela mesma', () => {
    expect(vigenteEm(lista, '2025-03-15')?.valor).toBe(12);
  });
  it('entre duas vigências vale a anterior', () => {
    expect(vigenteEm(lista, '2025-12-31')?.valor).toBe(12);
    expect(vigenteEm(lista, '2026-10-19')?.valor).toBe(12);
    expect(vigenteEm(lista, '2026-10-21')?.valor).toBe(15);
  });
  it('antes da primeira vigência não há valor', () => {
    expect(vigenteEm(lista, '2023-12-31')).toBeNull();
  });
  it('a sentinela 1899-12-30 é ausente, nunca vigência', () => {
    expect(vigenteEm([v('1899-12-30', 1)], '2026-01-01')).toBeNull();
    expect(dataDeVigencia('1899-12-30')).toBe(false);
  });
  it('datas inválidas são ignoradas (anos 0218 e 2201, dia que não existe)', () => {
    expect(vigenteEm([v('0218-05-01', 9), v('2201-01-01', 8)], '2300-01-01')).toBeNull();
    expect(dataDeCalendario('2026-02-30')).toBe(false);
    expect(dataDeCalendario('26-02-01')).toBe(false);
    expect(dataDeVigencia(null)).toBe(false);
  });
  it('próxima vigência (futura) e linha do tempo', () => {
    expect(proximaVigencia(lista, '2025-03-15')?.valor).toBe(15);
    expect(proximaVigencia(lista, '2026-10-20')).toBeNull();
    const t = linhaDoTempo(lista, '2025-06-01');
    expect(t.map((x) => x.data)).toEqual(['2026-10-20', '2025-03-15', '2024-01-01', '1899-12-30']);
    expect(t.find((x) => x.vigente)?.data).toBe('2025-03-15');
    expect(t[0]?.futura).toBe(true);
    expect(t[3]?.invalida).toBe(true);
  });
});
