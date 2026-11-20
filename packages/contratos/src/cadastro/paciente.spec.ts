// Revisão do M04: o charset e o tamanho do CP1252 são conferidos DEPOIS da conversão para maiúsculas.
import { describe, expect, it } from 'vitest';
import { esquemaCadastrarPaciente } from './paciente.js';

const base = {
  nome: 'PACIENTE SINTETICO SGH',
  nascimento: '1990-01-01',
  sexo: 'F' as const,
  cpf: '900.000.001-75', // o mesmo CPF sintético de receitas.spec.ts (0 linha na cópia)
  naturalidade: 'CIDADE SINTETICA',
  cep: '00000-000',
};

describe('cadastrarPaciente: maiúsculas antes do CP1252', () => {
  it('aceita o texto comum e grava em maiúsculas', () => {
    const r = esquemaCadastrarPaciente.parse({ ...base, nome: 'paciente sintético sgh' });
    expect(r.nome).toBe('PACIENTE SINTÉTICO SGH');
  });
  it("recusa 'µ' (vira 'Μ', fora do CP1252) antes do banco", () => {
    const r = esquemaCadastrarPaciente.safeParse({ ...base, nome: 'PACIENTE µ SINTETICO' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('nome');
  });
  it("recusa 'ß' que, em maiúsculas ('SS'), passa do tamanho da coluna", () => {
    const nome = `${'A'.repeat(69)}ß`;
    expect(nome.length).toBe(70);
    const r = esquemaCadastrarPaciente.safeParse({ ...base, nome });
    expect(r.success).toBe(false);
  });
});

describe('alterarPaciente (M11)', () => {
  it('aceita só os campos alteráveis, em maiúsculas, e apagar com null', async () => {
    const { esquemaAlterarPaciente } = await import('./paciente.js');
    const r = esquemaAlterarPaciente.parse({
      idPaciente: 10,
      versao: '{}',
      alteracoes: { nome: 'novo nome', celular: null, cep: '30.130-000' },
    });
    expect(r.alteracoes).toEqual({ nome: 'NOVO NOME', celular: null, cep: '30130000' });
    expect(esquemaAlterarPaciente.safeParse({ idPaciente: 10, versao: '{}', alteracoes: {} }).success).toBe(
      false,
    );
    expect(
      esquemaAlterarPaciente.safeParse({ idPaciente: 10, versao: '{}', alteracoes: { cns: '1' } }).success,
    ).toBe(false);
    expect(
      esquemaAlterarPaciente.safeParse({
        idPaciente: 10,
        versao: '{}',
        alteracoes: { cpf: '111.111.111-11' },
      }).success,
    ).toBe(false);
  });
});
