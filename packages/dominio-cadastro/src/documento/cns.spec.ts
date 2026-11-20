import { describe, expect, it } from 'vitest';
import { cnsDoLegado, cnsValido, mascararCns, tipoCns } from './cns.js';

describe('CNS (regra 3)', () => {
  it('definitivo (1 ou 2): base do PIS + 000/001 + dígito', () => {
    expect(tipoCns('198000000000008')).toBe('definitivo');
    expect(tipoCns('298000000010018')).toBe('definitivo');
    expect(cnsValido('198 0000 0000 0008')).toBe(true);
    expect(cnsValido('198000000000009')).toBe(false);
  });
  it('provisório (7, 8 ou 9): soma ponderada múltipla de 11', () => {
    expect(tipoCns('700000000000005')).toBe('provisorio');
    expect(tipoCns('898000000000002')).toBe('provisorio');
    expect(cnsValido('700000000000006')).toBe(false);
  });
  it('recusa outro começo, tamanho errado e repetição', () => {
    expect(tipoCns('300000000000000')).toBeNull();
    expect(tipoCns('12345')).toBeNull();
    expect(tipoCns('777777777777777')).toBeNull();
    expect(tipoCns(null)).toBeNull();
  });
  it('o "0" das inclusões do legado é "não informado"; máscara de 4 dígitos', () => {
    expect(cnsDoLegado('0')).toBeNull();
    expect(cnsDoLegado('')).toBeNull();
    expect(cnsDoLegado(null)).toBeNull();
    expect(cnsDoLegado('198000000000008')).toBe('198000000000008');
    expect(mascararCns('198000000000008')).toBe('***********0008');
    expect(mascararCns(null)).toBeNull();
  });
});
