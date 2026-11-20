// Regras 1 e 2 do M32: o tipo de credor define o lançamento e as retenções; só grava título com credor válido.
import { describe, expect, it } from 'vitest';
import {
  conferirCredor,
  ehTipoCredor,
  FREQUENCIA_TIPO_CREDOR,
  regrasDoCredor,
  ROTULO_ORIGEM_TITULO,
  ROTULO_TIPO_CREDOR,
  TIPOS_CREDOR,
} from './index.js';

describe('credor (regras 1 e 2)', () => {
  it('os seis tipos do perfil somam os 71.266 títulos com tipo (F 55.792 + M 8.607 + E 5.421 + X 1.356 + C 80 + T 10)', () => {
    expect(TIPOS_CREDOR).toEqual(['F', 'M', 'E', 'X', 'C', 'T']);
    const soma = Object.values(FREQUENCIA_TIPO_CREDOR).reduce((s, n) => s + n, 0);
    expect(soma).toBe(55_792 + 8_607 + 5_421 + 1_356 + 80 + 10);
    expect(soma).toBe(71_266);
    expect(ROTULO_TIPO_CREDOR.E).toBe('Empresa médica');
    expect(ROTULO_ORIGEM_TITULO.R).toBe('Repasse médico');
  });
  it('médico exige o profissional; folha não nasce no lançamento manual; colaborador e tributos sem retenção', () => {
    expect(regrasDoCredor('M')).toEqual({
      exigeProfissional: true,
      admiteRetencao: true,
      lancamentoManual: true,
    });
    expect(regrasDoCredor('X').lancamentoManual).toBe(false);
    expect(regrasDoCredor('C').admiteRetencao).toBe(false);
    expect(regrasDoCredor('T').admiteRetencao).toBe(false);
    expect(regrasDoCredor('F').admiteRetencao).toBe(true);
    expect(regrasDoCredor('E').exigeProfissional).toBe(false);
    expect(ehTipoCredor('P')).toBe(false);
  });
  it.each([
    [{ tipo: 'Z', credorExiste: true, profissional: null }, 'tipo-credor-invalido'],
    [{ tipo: 'X', credorExiste: true, profissional: null }, 'tipo-credor-sem-lancamento'],
    [{ tipo: 'F', credorExiste: false, profissional: null }, 'credor-inexistente'],
    [{ tipo: 'M', credorExiste: true, profissional: null }, 'profissional-obrigatorio'],
    [
      { tipo: 'M', credorExiste: true, profissional: 9, profissionalExiste: false },
      'profissional-inexistente',
    ],
    [{ tipo: 'C', credorExiste: true, profissional: null, comRetencao: true }, 'retencao-nao-admitida'],
  ])('recusa %j com %s', (c, codigo) => {
    expect(conferirCredor(c)?.codigo).toBe(codigo);
  });
  it('aceita fornecedor existente e médico com profissional', () => {
    expect(
      conferirCredor({ tipo: 'F', credorExiste: true, profissional: null, comRetencao: true }),
    ).toBeNull();
    expect(
      conferirCredor({ tipo: 'M', credorExiste: true, profissional: 3, profissionalExiste: true }),
    ).toBeNull();
  });
});
