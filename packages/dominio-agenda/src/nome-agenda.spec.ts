// Regra 10 (nome da agenda) e regra 11 (contato: 8 últimos dígitos; '0' ou '' = sem telefone).
import { describe, expect, it } from 'vitest';
import {
  mesmoTelefone,
  nomeDaAgenda,
  nomeMascarado,
  partesDoNome,
  semTelefone,
  somenteDigitos,
  telefoneMascarado,
} from './nome-agenda.js';

describe('nome da agenda', () => {
  it('corta no PRIMEIRO hífen, com espaçamento irregular', () => {
    expect(partesDoNome('CARDIOLOGIA - DR X')).toEqual({ procedimento: 'CARDIOLOGIA', profissional: 'DR X' });
    expect(partesDoNome('CARDIOLOGIA- DR X - TARDE')).toEqual({
      procedimento: 'CARDIOLOGIA',
      profissional: 'DR X - TARDE',
    });
    expect(partesDoNome('ODONTOLOGIA')).toEqual({ procedimento: 'ODONTOLOGIA', profissional: null });
    expect(partesDoNome('- DR X')).toEqual({ procedimento: '- DR X', profissional: 'DR X' });
    expect(partesDoNome('CLINICA -')).toEqual({ procedimento: 'CLINICA', profissional: null });
  });
  it('nome novo em maiúsculas, até 40 caracteres', () => {
    expect(nomeDaAgenda('cardiologia', ' dr   fulano ')).toBe('CARDIOLOGIA - DR FULANO');
    expect(nomeDaAgenda('CLINICA MEDICA', 'DRA NOME MUITO MUITO COMPRIDO DEMAIS').length).toBeLessThanOrEqual(
      40,
    );
  });
});

describe('contato', () => {
  it('telefone pelos 8 últimos dígitos, com ou sem DDD e máscara', () => {
    expect(mesmoTelefone('(22) 99999-1234', '999991234')).toBe(true);
    expect(mesmoTelefone('2299991234', '9999-1235')).toBe(false);
  });
  it("'0' ou '' = sem telefone (e nunca casa)", () => {
    expect(semTelefone('0')).toBe(true);
    expect(semTelefone('')).toBe(true);
    expect(semTelefone(null)).toBe(true);
    expect(semTelefone('--')).toBe(true);
    expect(mesmoTelefone('0', '0')).toBe(false);
    expect(somenteDigitos(undefined)).toBe('');
  });
  it('mascarados para as listas', () => {
    expect(telefoneMascarado('(22) 99999-1234')).toBe('•••• 1234');
    expect(telefoneMascarado('0')).toBe('');
    expect(nomeMascarado('MARIA DA SILVA SOUZA')).toBe('MARIA S. S.');
    expect(nomeMascarado('')).toBe('');
    expect(nomeMascarado(null)).toBe('');
  });
});
