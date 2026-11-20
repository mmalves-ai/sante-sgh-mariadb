// ARQ-2 (critério de aceite do M02): chave de cache, fila ou arquivo montada sem o código da rede falha.
import { describe, expect, it } from 'vitest';
import {
  camposDeLog,
  chaveDaRede,
  chaveDoContexto,
  conferirContexto,
  ErroContexto,
  resolvedorRedeDev,
} from './contexto.js';

describe('contexto rede + estabelecimento', () => {
  it.each(['cache', 'fila', 'arquivo', 'log', 'trava'] as const)('chave de %s sem rede falha', (tipo) => {
    expect(() => chaveDaRede(undefined, tipo, 'pc', 'x')).toThrow(ErroContexto);
    expect(() => chaveDaRede(null, tipo, 'pc')).toThrow(/sem o código da rede/);
    expect(() => chaveDaRede('', tipo, 'pc')).toThrow(/sem o código da rede/);
    expect(() => chaveDaRede('Rede Inválida', tipo, 'pc')).toThrow(/sem o código da rede/);
  });

  it('chave com rede começa pelo código da rede', () => {
    expect(chaveDaRede('rede-teste', 'cache', 'pc', 'menu')).toBe('rede-teste:cache:pc:menu');
    expect(chaveDaRede('rede-teste', 'arquivo', 'pc', 'laudos')).toBe('rede-teste/pc/laudos');
    expect(chaveDoContexto({ rede: 'rede-teste', hospital: 'pc' }, 'fila', 'pdf')).toBe(
      'rede-teste:fila:pc:pdf',
    );
    expect(() =>
      chaveDoContexto({ rede: undefined as unknown as string, hospital: 'pc' }, 'fila', 'pdf'),
    ).toThrow();
  });

  it('parte vazia ou com separador é recusada', () => {
    expect(() => chaveDaRede('rede-teste', 'cache')).toThrow(/parte vazia/);
    expect(() => chaveDaRede('rede-teste', 'cache', 'a:b')).toThrow(/separador/);
    expect(() => chaveDaRede('rede-teste', 'arquivo', '../x/y')).toThrow(/separador/);
  });

  it('contexto exige rede, estabelecimento e traceId', () => {
    expect(conferirContexto({ rede: 'rede-teste', hospital: 'pc', traceId: 't1' })).toMatchObject({
      hospital: 'pc',
    });
    expect(() => conferirContexto({ hospital: 'pc', traceId: 't' })).toThrow(/rede/);
    expect(() => conferirContexto({ rede: 'rede-teste', traceId: 't' })).toThrow(/estabelecimento/);
    expect(() => conferirContexto({ rede: 'rede-teste', hospital: 'pc' })).toThrow(/traceId/);
  });

  it('log leva rede, estabelecimento e traceId', () => {
    expect(camposDeLog({ rede: 'rede-teste', hospital: 'pc', traceId: 't1' })).toEqual({
      rede: 'rede-teste',
      estabelecimento: 'pc',
      traceId: 't1',
    });
  });

  it('resolvedor de dev: localhost → REDE_PADRAO; outro endereço não resolve', () => {
    const r = resolvedorRedeDev('rede-teste');
    expect(r.resolver('localhost:5300')).toBe('rede-teste');
    expect(r.resolver('127.0.0.1')).toBe('rede-teste');
    expect(r.resolver('outra.exemplo.invalid')).toBeNull();
    expect(resolvedorRedeDev(null).resolver('localhost')).toBeNull();
  });
});
