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
  it('a ordem da lista não importa: vale a maior data até a base e a menor data depois dela', () => {
    const fora = [v('2026-10-20', 15), v('2024-01-01', 10), v('2025-03-15', 12), v('2027-02-01', 18)];
    expect(vigenteEm(fora, '2026-12-31')?.valor).toBe(15);
    expect(vigenteEm(fora, '2025-12-31')?.valor).toBe(12);
    expect(proximaVigencia(fora, '2024-06-01')?.valor).toBe(12);
    expect(proximaVigencia([v('2027-02-01', 18), v('2026-10-20', 15)], '2026-01-01')?.valor).toBe(15);
    // Data futura inválida nunca é a próxima vigência.
    expect(proximaVigencia([v('2026-02-30', 1), v('2201-01-01', 2)], '2026-01-01')).toBeNull();
  });
  it('linha do tempo: datas iguais mantêm a ordem; inválida não é futura nem vigente', () => {
    const iguais = [v('2025-01-01', 1), v('2025-01-01', 2), v('2026-02-30', 3)];
    const t = linhaDoTempo(iguais, '2025-06-01');
    expect(t.map((x) => x.valor)).toEqual([3, 1, 2]);
    expect(t.map((x) => [x.vigente, x.futura, x.invalida])).toEqual([
      [false, false, true],
      [true, false, false],
      [false, false, false],
    ]);
    expect(linhaDoTempo([], '2025-06-01')).toEqual([]);
  });
  it('vigência aceita de 1900 a 2100 e só datas de calendário', () => {
    expect(dataDeVigencia('1900-01-01')).toBe(true);
    expect(dataDeVigencia('2100-12-31')).toBe(true);
    expect(dataDeVigencia('1899-12-31')).toBe(false);
    expect(dataDeVigencia('')).toBe(false);
    expect(dataDeVigencia(undefined)).toBe(false);
    expect(dataDeCalendario('2024-02-29')).toBe(true);
    expect(dataDeCalendario('2025-02-29')).toBe(false);
    expect(dataDeCalendario('2025-13-01')).toBe(false);
  });
});
