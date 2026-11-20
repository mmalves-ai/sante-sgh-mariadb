// Regras 8 e 11: a chave do evento do fato (mesma versão relida → mesma chave), a identidade da entrega do consumidor
// e a releitura com sobreposição.
import { describe, expect, it } from 'vitest';
import { chaveDeOrdem, chaveEntrega, chaveEventoFato, inicioDaReleitura } from './idempotencia.js';

describe('chaves de idempotência', () => {
  const v = new Date('2026-07-05T10:11:12.345Z');
  it('a mesma versão do fato dá a mesma chave; outra versão, outra chave', () => {
    const a = chaveEventoFato('exame.apoio', 'pc', 123, v);
    expect(a).toBe('fato:exame.apoio:pc:123:20260705101112345');
    expect(chaveEventoFato('exame.apoio', 'pc', '123', new Date(v))).toBe(a);
    expect(chaveEventoFato('exame.apoio', 'pc', 123, new Date(v.getTime() + 1000))).not.toBe(a);
    expect(chaveEventoFato('exame.apoio', 'pc', 123, null)).toBe('fato:exame.apoio:pc:123:sem-carimbo');
  });
  it('recusa parte fora do formato (nada de dado livre na chave)', () => {
    expect(() => chaveEventoFato('exame apoio', 'pc', 1, v)).toThrow();
    expect(() => chaveEntrega('pc', 'k', 'Parceiro Com Espaço')).toThrow();
    expect(() => chaveEventoFato('x'.repeat(40), 'p'.repeat(40), '9'.repeat(40), v)).toThrow(/120/);
  });
  it('a entrega é o evento + estabelecimento + parceiro; a ordem é por objeto', () => {
    expect(chaveEntrega('pc', 'fato:x:pc:1:2', 'apoio-lab')).toBe('pc|fato:x:pc:1:2|apoio-lab');
    expect(chaveDeOrdem('paciente', 77)).toBe('paciente:77');
  });
  it('a releitura recua a janela de sobreposição', () => {
    expect(inicioDaReleitura(v)).toEqual(new Date(v.getTime() - 5000));
    expect(inicioDaReleitura(null)).toBeNull();
  });
});
