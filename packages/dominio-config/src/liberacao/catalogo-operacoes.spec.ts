// O catálogo das operações liberáveis: só operações do produto (modulo.operacao), sem os eventos de convivência,
// sem repetição e em ordem; sem lista usa as declaradas; lista vazia é recusada; fora do catálogo o estado é nulo.
import { describe, expect, it } from 'vitest';
import { catalogoOperacoesProprio, operacoesDeclaradas } from './catalogo-operacoes.js';

describe('catálogo das operações liberáveis', () => {
  it('as declaradas seguem modulo.operacao, sem convivência, sem repetição e em ordem de nome', () => {
    const ops = operacoesDeclaradas();
    expect(ops.length).toBeGreaterThan(0);
    const nomes = ops.map((o) => o.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect([...nomes].sort()).toEqual(nomes);
    for (const o of ops) {
      expect(o.nome).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
      expect(o.nome).not.toMatch(/Legado$/);
      expect(o.modulo).toBe(o.nome.slice(0, o.nome.indexOf('.')));
      expect(o.descricao.length).toBeGreaterThan(0);
    }
  });

  it('sem lista usa as declaradas; a operação do catálogo nasce liberada e a de fora é nula', () => {
    const c = catalogoOperacoesProprio();
    expect(c.operacoes()).toEqual(operacoesDeclaradas());
    const [primeira] = c.operacoes();
    expect(c.estado(primeira!.nome, 'aa')).toBe('liberada');
    expect(c.estado('modulo.inexistente', 'aa')).toBeNull();
  });

  it('lista própria vale como dada e a lista vazia é recusada', () => {
    const c = catalogoOperacoesProprio([{ nome: 'x.y', modulo: 'x', descricao: 'Y' }]);
    expect(c.operacoes().map((o) => o.nome)).toEqual(['x.y']);
    expect(c.estado('x.y', 'aa')).toBe('liberada');
    expect(() => catalogoOperacoesProprio([])).toThrow(/vazio/);
  });
});
