// Equipe: sete pares (COD, ID) + pediatra; ausente = ID 1; o sentinela nunca aparece na tela (regra 6).
import { describe, expect, it } from 'vitest';
import {
  ehSentinela,
  equipeDaLinha,
  FUNCOES_REGISTRO,
  paresDaAgenda,
  paresDoRegistro,
  repetidosNaEquipe,
  rotuloFuncao,
  SENTINELA_PROFISSIONAL,
  SENTINELA_TRILHA,
} from './equipe.js';

describe('pares da agenda', () => {
  it('equipe mínima: só o cirurgião; os seis apoios no par (0, 1)', () => {
    const p = paresDaAgenda({ cirurgiao: { id: 549, cod: 12345 } });
    expect(p).toMatchObject({ CRM: 12345, ID_CRM: 549, AUX1: 0, ID_AUX1: 1, CIRCUL: 0, ID_CIRCUL: 1 });
    expect(Object.keys(p)).toHaveLength(14);
  });
  it('equipe completa usa o código e o ID de cada um', () => {
    const p = paresDaAgenda({
      cirurgiao: { id: 2, cod: 20 },
      auxiliar1: { id: 3, cod: 30 },
      anestesista: { id: 4, cod: 40 },
      circulante: null,
    });
    expect(p).toMatchObject({
      AUX1: 30,
      ID_AUX1: 3,
      ANEST: 40,
      ID_ANEST: 4,
      ID_CIRCUL: SENTINELA_PROFISSIONAL,
    });
  });
});

describe('pares do registro', () => {
  it('oito funções e o quarto auxiliar só por ID', () => {
    const p = paresDoRegistro({ cirurgiao: { id: 2, cod: 20 }, pediatra: { id: 7, cod: 70 } });
    expect(p).toMatchObject({ CIRUR: 20, ID_CIRUR: 2, PED: 70, ID_PED: 7, ID_CIRC: 1, ID_TBCBOPRO_AUX4: 1 });
    expect(paresDoRegistro({}, 9)['ID_TBCBOPRO_AUX4']).toBe(9);
  });
});

describe('leitura e conferência', () => {
  it('os sentinelas 1 e 488 (e nulo) somem da equipe lida', () => {
    expect(ehSentinela(SENTINELA_TRILHA)).toBe(true);
    expect(ehSentinela(null)).toBe(true);
    expect(ehSentinela(549)).toBe(false);
    const e = equipeDaLinha({
      CRM: 12345,
      ID_CRM: 549,
      AUX1: 0,
      ID_AUX1: 1,
      ANEST: 0,
      ID_ANEST: 488,
      ID_CIRCUL: null,
    });
    expect(e).toEqual([{ funcao: 'cirurgiao', id: 549, cod: 12345 }]);
    expect(
      equipeDaLinha({ CIRUR: 1, ID_CIRUR: 5, PED: 2, ID_PED: 6 }, FUNCOES_REGISTRO).map((x) => x.funcao),
    ).toEqual(['cirurgiao', 'pediatra']);
  });
  it('a mesma pessoa em duas funções é apontada', () => {
    expect(
      repetidosNaEquipe({
        cirurgiao: { id: 5, cod: 1 },
        auxiliar1: { id: 5, cod: 1 },
        auxiliar2: { id: 1, cod: 0 },
      }),
    ).toEqual(['auxiliar1']);
    expect(repetidosNaEquipe({ cirurgiao: { id: 5, cod: 1 }, auxiliar1: null })).toEqual([]);
  });
  it('rótulos das funções', () => {
    expect(rotuloFuncao('anestesista')).toBe('Anestesista');
    expect(rotuloFuncao('pediatra')).toBe('Pediatra');
    expect(rotuloFuncao('outra')).toBe('outra');
  });
});
