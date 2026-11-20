import { describe, expect, it } from 'vitest';
import { cpfDaPlataforma, segredosNaResposta } from './segredos.js';

describe('regra 10 do M10: segredos e dado pessoal fora das respostas', () => {
  it('acha chave proibida (forma do banco e camelCase) e texto em forma de CPF', () => {
    expect(segredosNaResposta({ usuario: { login: 'X', senha: 'a' } }).map((a) => a.caminho)).toEqual([
      '$.usuario.senha',
    ]);
    expect(segredosNaResposta([{ codigoVerificacao: 1 }, { E_MAIL: 'x' }])).toHaveLength(2);
    expect(segredosNaResposta({ nota: 'documento 12345678901 citado' })[0]?.motivo).toMatch(/CPF/);
    expect(segredosNaResposta({ campo: 'SENHA_SEC' })[0]?.motivo).toMatch(/citada/);
  });
  it('não acusa os campos que só dizem se está definido', () => {
    expect(
      segredosNaResposta({
        cpfInformado: true,
        senhaDefinida: false,
        usuarioDefinido: true,
        cnpj: '00000000000191',
      }),
    ).toEqual([]);
    expect(segredosNaResposta({ coluna: 'EXCPAC', n: 3, x: null })).toEqual([]);
  });
  it('exceção da plataforma: o CPF entra só na forma de 11 dígitos (ou null), e a chave cpf segue proibida na conferência', () => {
    const cpf = `9${'0'.repeat(8)}17`;
    expect(cpfDaPlataforma(cpf)).toBe(cpf);
    expect(cpfDaPlataforma(null)).toBeNull();
    expect(() => cpfDaPlataforma('123.456.789-0')).toThrow();
    expect(segredosNaResposta({ usuario: { cpf: null } }).map((a) => a.caminho)).toEqual(['$.usuario.cpf']);
  });
});
