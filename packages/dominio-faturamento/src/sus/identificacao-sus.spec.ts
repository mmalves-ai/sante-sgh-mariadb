// Regra 5 do M51: CNS ou CPF válido; CBO e CNES na forma do Ministério. Documentos sintéticos.
import { describe, expect, it } from 'vitest';
import { cboValido, cnesValido, documentoInformado, identificarPessoa } from './identificacao-sus.js';
import { cnsSintetico, cnsValidoTeste, cpfSintetico } from './massa.spec-util.js';

describe('identificação SUS (regra 5)', () => {
  const cpf = cpfSintetico('123456789');
  const cns = cnsSintetico(42);

  it('"0", vazio e zeros são "não informado"', () => {
    expect(documentoInformado('0')).toBeNull();
    expect(documentoInformado('')).toBeNull();
    expect(documentoInformado(null)).toBeNull();
    expect(documentoInformado('000.000')).toBeNull();
    expect(documentoInformado('123.456')).toBe('123456');
  });

  it('basta um documento válido', () => {
    expect(identificarPessoa({ cns, cpf: null }, cnsValidoTeste)).toEqual({ cns, cpf: null, problemas: [] });
    expect(identificarPessoa({ cns: '0', cpf }, cnsValidoTeste)).toEqual({ cns: null, cpf, problemas: [] });
    // CPF do legado é número (DOUBLE): sem os zeros à esquerda.
    const curto = cpfSintetico('012345678');
    expect(identificarPessoa({ cns: null, cpf: curto.replace(/^0+/, '') }, cnsValidoTeste).cpf).toBe(curto);
    // CNS inválido com CPF válido: vale o CPF, sem crítica (o cadastro avisa no M11).
    expect(identificarPessoa({ cns: '700000000000001', cpf }, cnsValidoTeste).problemas).toEqual([]);
  });

  it('sem documento válido: a crítica diz qual', () => {
    expect(identificarPessoa({ cns: null, cpf: null }, cnsValidoTeste).problemas).toEqual([
      'sem-identificacao',
    ]);
    expect(
      identificarPessoa({ cns: '700000000000001', cpf: '11111111111' }, cnsValidoTeste).problemas,
    ).toEqual(['cns-invalido', 'cpf-invalido']);
  });

  it('CBO e CNES', () => {
    expect(cboValido('225125')).toBe(true);
    expect(cboValido('2231F9')).toBe(true);
    expect(cboValido('22512')).toBe(false);
    expect(cboValido(null)).toBe(false);
    expect(cnesValido(3132471)).toBe(true);
    expect(cnesValido('0')).toBe(false);
    expect(cnesValido(null)).toBe(false);
    expect(cnesValido('12345678')).toBe(false);
  });
});
