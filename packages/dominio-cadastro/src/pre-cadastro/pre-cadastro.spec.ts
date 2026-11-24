import { describe, expect, it } from 'vitest';
import { conferirPreCadastro, decidirConversao, type PreCadastroProposto } from './pre-cadastro.js';

const HOJE = '2026-11-24';
const base: PreCadastroProposto = { nome: 'ANA SOUZA', nascimento: '1990-02-03', celular: '(31) 99999-0000' };
const codigos = (p: PreCadastroProposto) => conferirPreCadastro(p, HOJE).map((r) => r.codigo);

describe('pré-cadastro na marcação', () => {
  it('aceita o mínimo: nome, nascimento e um telefone', () => expect(codigos(base)).toEqual([]));
  it('recusa nome sem sobrenome, nascimento futuro e falta de telefone', () => {
    expect(codigos({ nome: 'ANA', nascimento: '2027-01-01', celular: '123' })).toEqual([
      'nome-incompleto',
      'nascimento-futuro',
      'contato-obrigatorio',
    ]);
  });
  it('recusa CPF inválido e carteira sem fonte pagadora', () => {
    expect(codigos({ ...base, cpf: '111.111.111-11', numeroCarteira: '9' })).toEqual([
      'cpf-invalido',
      'fonte-pagadora-obrigatoria',
    ]);
  });
});

describe('conversão na chegada', () => {
  const pre = { nascimento: '1990-02-03' };
  it('reaproveita o paciente do mesmo CPF e nascimento', () =>
    expect(decidirConversao(pre, [{ id: 5, nascimento: '1990-02-03' }])).toEqual({
      acao: 'vincular',
      paciente: 5,
    }));
  it('sem paciente pelo CPF, cadastra', () =>
    expect(decidirConversao(pre, [])).toEqual({ acao: 'cadastrar' }));
  it('recusa CPF de outro nascimento e CPF em vários pacientes', () => {
    expect(decidirConversao(pre, [{ id: 5, nascimento: '1970-01-01' }])).toMatchObject({
      codigo: 'cpf-com-outro-nascimento',
    });
    expect(
      decidirConversao(pre, [
        { id: 5, nascimento: null },
        { id: 6, nascimento: null },
      ]),
    ).toMatchObject({ codigo: 'cpf-em-varios-pacientes' });
  });
  it('a escolha da recepção prevalece', () =>
    expect(decidirConversao(pre, [], 9)).toEqual({ acao: 'vincular', paciente: 9 }));
});
