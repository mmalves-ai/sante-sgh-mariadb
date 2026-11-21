import { describe, expect, it } from 'vitest';
import {
  booleanoDoBanco,
  booleanoParaBanco,
  esquemaBooleano,
  esquemaBooleanoConsulta,
  formatarBooleano,
} from './booleano.js';

describe('booleano neutro', () => {
  it('o contrato aceita só boolean', () => {
    expect(esquemaBooleano.parse(true)).toBe(true);
    expect(esquemaBooleano.safeParse('true').success).toBe(false);
    expect(esquemaBooleano.safeParse(1).success).toBe(false);
  });

  it('a consulta aceita true/false/1/0 e recusa o resto', () => {
    expect(esquemaBooleanoConsulta.parse('true')).toBe(true);
    expect(esquemaBooleanoConsulta.parse('1')).toBe(true);
    expect(esquemaBooleanoConsulta.parse('false')).toBe(false);
    expect(esquemaBooleanoConsulta.parse('0')).toBe(false);
    expect(esquemaBooleanoConsulta.parse(false)).toBe(false);
    for (const x of ['sim', 'yes', '', 'TRUE', 2])
      expect(esquemaBooleanoConsulta.safeParse(x).success).toBe(false);
  });

  it('lê e grava o BOOLEAN do banco sem trocar inválido por falso', () => {
    expect(booleanoDoBanco(1)).toBe(true);
    expect(booleanoDoBanco('0')).toBe(false);
    expect(booleanoDoBanco(true)).toBe(true);
    expect(booleanoDoBanco(null)).toBeNull();
    expect(() => booleanoDoBanco(2)).toThrow(/inválido/);
    expect(() => booleanoDoBanco('x')).toThrow(/inválido/);
    expect(booleanoParaBanco(true)).toBe(1);
    expect(booleanoParaBanco(false)).toBe(0);
    expect(booleanoParaBanco(null)).toBeNull();
  });

  it('formata para a tela', () => {
    expect(formatarBooleano(true)).toBe('Sim');
    expect(formatarBooleano(false)).toBe('Não');
    expect(formatarBooleano(null)).toBe('');
  });
});
