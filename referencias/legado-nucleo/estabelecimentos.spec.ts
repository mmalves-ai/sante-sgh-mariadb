import { describe, expect, it } from 'vitest';
import {
  ErroConfiguracaoEstabelecimentos,
  buscarEstabelecimento,
  chaveFb,
  lerCodigos,
  lerEstabelecimentos,
  lerRedePadrao,
} from './estabelecimentos.js';

// Códigos e valores fictícios: a lista vem do ambiente, nunca de código fixo (ARQ-1).
function ambienteCom(codigos: string[]): Record<string, string> {
  const env: Record<string, string> = { ESTABELECIMENTOS: codigos.join(','), REDE_PADRAO: 'rede-teste' };
  codigos.forEach((c, i) => {
    env[chaveFb(c, 'HOST')] = '127.0.0.1';
    env[chaveFb(c, 'PORTA')] = String(4000 + i);
    env[chaveFb(c, 'BANCO')] = `/dados/${c}.fdb`;
    env[chaveFb(c, 'USUARIO')] = 'USUARIO_TESTE';
    env[chaveFb(c, 'SENHA')] = 'senha-ficticia';
    env[chaveFb(c, 'NOME')] = `Estabelecimento ${c}`;
  });
  return env;
}

describe('estabelecimentos (ARQ-1)', () => {
  it('lê qualquer lista de códigos, na ordem, com as chaves FB_<COD>_*', () => {
    const lista = lerEstabelecimentos(ambienteCom(['abc', 'x1', 'zz9']));
    expect(lista.map((e) => e.codigo)).toEqual(['abc', 'x1', 'zz9']);
    expect(lista[1]).toMatchObject({
      host: '127.0.0.1',
      porta: 4001,
      banco: '/dados/x1.fdb',
      nome: 'Estabelecimento x1',
    });
  });

  it('a senha fica fora de JSON e de log, mas acessível', () => {
    const [e] = lerEstabelecimentos(ambienteCom(['abc']));
    expect(e?.senha).toBe('senha-ficticia');
    expect(JSON.stringify(e)).not.toContain('senha');
    expect(Object.keys(e ?? {})).not.toContain('senha');
  });

  it('ausente ou vazio: nenhum estabelecimento', () => {
    expect(lerCodigos({})).toEqual([]);
    expect(lerEstabelecimentos({ ESTABELECIMENTOS: ' ' })).toEqual([]);
  });

  it('recusa código inválido ou repetido', () => {
    expect(() => lerCodigos({ ESTABELECIMENTOS: 'PC' })).toThrow(ErroConfiguracaoEstabelecimentos);
    expect(() => lerCodigos({ ESTABELECIMENTOS: 'a' })).toThrow(/inválido/);
    expect(() => lerCodigos({ ESTABELECIMENTOS: 'ab,ab' })).toThrow(/repetido/);
  });

  it('lista as chaves que faltam, sem citar valores', () => {
    const env = ambienteCom(['abc']);
    delete env['FB_ABC_BANCO'];
    delete env['FB_ABC_NOME'];
    expect(() => lerEstabelecimentos(env)).toThrow('faltam FB_ABC_BANCO, FB_ABC_NOME');
    expect(() => lerEstabelecimentos({ ...ambienteCom(['abc']), FB_ABC_PORTA: 'x' })).toThrow(
      /porta inválida/,
    );
  });

  it('busca por código e recusa código fora da lista', () => {
    const lista = lerEstabelecimentos(ambienteCom(['abc', 'def']));
    expect(buscarEstabelecimento(lista, 'def').porta).toBe(4001);
    expect(() => buscarEstabelecimento(lista, 'ghi')).toThrow('configurados: abc, def');
  });
});

describe('rede padrão (ARQ-2)', () => {
  it('lê REDE_PADRAO; ausente é null; formato inválido é recusado', () => {
    expect(lerRedePadrao({ REDE_PADRAO: 'rede-teste' })).toBe('rede-teste');
    expect(lerRedePadrao({})).toBeNull();
    expect(() => lerRedePadrao({ REDE_PADRAO: 'Rede Teste' })).toThrow(/REDE_PADRAO/);
  });
});
