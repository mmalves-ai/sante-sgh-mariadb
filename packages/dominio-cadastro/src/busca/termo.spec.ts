import { describe, expect, it } from 'vitest';
import { dataDoTermo, ErroTermo, interpretarTermo } from './termo.js';

describe('termo da busca única', () => {
  it('auto: CPF válido, CNS, nascimento, prontuário, telefone e nome', () => {
    expect(interpretarTermo('900.000.001-75')).toEqual({ tipo: 'cpf', cpf: 90000000175 });
    expect(interpretarTermo('198000000000008')).toEqual({ tipo: 'cns', cns: '198000000000008' });
    expect(interpretarTermo('01/02/1990')).toEqual({ tipo: 'nascimento', data: '1990-02-01' });
    expect(interpretarTermo('1990-02-01')).toEqual({ tipo: 'nascimento', data: '1990-02-01' });
    expect(interpretarTermo('123456')).toEqual({ tipo: 'prontuario', prontuario: 123456 });
    expect(interpretarTermo('(31) 99876-5432')).toEqual({ tipo: 'telefone', ultimos8: '98765432' });
    expect(interpretarTermo('maria da silva')).toEqual({ tipo: 'nome', palavras: ['MARIA', 'SILVA'] });
  });
  it('tipo escolhido: mãe e telefone de 8 dígitos', () => {
    expect(interpretarTermo('ana souza', 'mae')).toEqual({ tipo: 'mae', palavras: ['ANA', 'SOUZA'] });
    expect(interpretarTermo('98765432', 'telefone')).toEqual({ tipo: 'telefone', ultimos8: '98765432' });
  });
  it('recusas com código e mensagem em português', () => {
    const codigo = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof ErroTermo ? e.codigo : 'outro';
      }
      return 'nenhum';
    };
    expect(codigo(() => interpretarTermo('111.111.111-11', 'cpf'))).toBe('cpf-invalido');
    expect(codigo(() => interpretarTermo('abc', 'prontuario'))).toBe('prontuario-invalido');
    expect(codigo(() => interpretarTermo('123', 'cns'))).toBe('cns-invalido');
    expect(codigo(() => interpretarTermo('31/02/1990', 'nascimento'))).toBe('data-invalida');
    expect(codigo(() => interpretarTermo('123', 'telefone'))).toBe('telefone-invalido');
    expect(codigo(() => interpretarTermo('DR J', 'nome'))).toBe('termo-curto');
    expect(codigo(() => interpretarTermo('x', 'qualquer' as never))).toBe('tipo-invalido');
  });
  it('data: dia inexistente e ano antigo recusados', () => {
    expect(dataDoTermo('29/02/2024')).toBe('2024-02-29');
    expect(dataDoTermo('29/02/2023')).toBeNull();
    expect(dataDoTermo('01/01/1850')).toBeNull();
    expect(dataDoTermo('ontem')).toBeNull();
  });
});
