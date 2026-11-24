import { describe, expect, it } from 'vitest';
import {
  conferirPreCadastro,
  conferirSemelhanca,
  decidirConversao,
  type PreCadastroProposto,
} from './pre-cadastro.js';

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
      divergencias: [],
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
  describe('escolha da recepção, sempre conferida', () => {
    const preCompleto = { nascimento: '1990-02-03', nome: 'ANA SOUZA', cpf: '529.982.247-25' };
    const ana = { id: 9, nascimento: '1990-02-03', nome: 'Ána Maria Souza', cpf: '52998224725' };
    it('liga quando nome, nascimento e CPF batem', () =>
      expect(decidirConversao(preCompleto, [{ id: 9, nascimento: '1990-02-03' }], ana)).toEqual({
        acao: 'vincular',
        paciente: 9,
        divergencias: [],
      }));
    it('recusa sempre quando o CPF do pré-cadastro é de outro paciente, mesmo com motivo', () =>
      expect(
        decidirConversao(
          preCompleto,
          [{ id: 5, nascimento: '1990-02-03' }],
          ana,
          'confirmado com a paciente',
        ),
      ).toMatchObject({ acao: 'recusar', codigo: 'cpf-de-outro-paciente' }));
    it('nascimento, nome ou CPF divergentes pedem o motivo', () => {
      const outra = { id: 9, nascimento: '1970-01-01', nome: 'JOANA SILVA', cpf: '11144477735' };
      expect(decidirConversao(preCompleto, [], outra)).toEqual({
        acao: 'recusar',
        codigo: 'dados-divergentes',
        mensagem: expect.stringContaining('cpf, nascimento, nome'),
        divergencias: ['cpf', 'nascimento', 'nome'],
      });
      expect(decidirConversao(preCompleto, [], outra, 'curto')).toMatchObject({
        codigo: 'dados-divergentes',
      });
      expect(decidirConversao(preCompleto, [], outra, 'nascimento digitado errado na marcação')).toEqual({
        acao: 'vincular',
        paciente: 9,
        divergencias: ['cpf', 'nascimento', 'nome'],
      });
    });
  });
});

describe('semelhança na gravação do pré-cadastro', () => {
  it('CPF de paciente cadastrado recusa sempre: marque no paciente', () =>
    expect(conferirSemelhanca({ porCpf: [4], porNomeNascimento: [] }, true)?.codigo).toBe(
      'paciente-ja-cadastrado',
    ));
  it('nome e nascimento iguais recusam até confirmar que é outra pessoa', () => {
    expect(conferirSemelhanca({ porCpf: [], porNomeNascimento: [4] }, false)?.codigo).toBe(
      'paciente-semelhante',
    );
    expect(conferirSemelhanca({ porCpf: [], porNomeNascimento: [4] }, true)).toBeNull();
    expect(conferirSemelhanca({ porCpf: [], porNomeNascimento: [] }, false)).toBeNull();
  });
});
