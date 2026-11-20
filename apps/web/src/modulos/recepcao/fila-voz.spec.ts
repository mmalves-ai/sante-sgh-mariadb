import { describe, expect, it } from 'vitest';
import { chamadasNovas, FilaDeVoz, type Sintetizador, TETO_CHAVES_FALADAS } from './fila-voz.js';

describe('voz do painel de chamada', () => {
  it('duas chamadas na mesma leitura: as duas, na ordem em que aconteceram; nenhuma falada duas vezes', () => {
    const faladas = new Set<string>(['1:1']);
    // A leitura traz a mais nova primeiro (dois guichês chamaram entre duas leituras).
    const leitura = [{ chave: '3:1' }, { chave: '2:1' }, { chave: '1:1' }];
    expect(chamadasNovas(faladas, leitura).map((c) => c.chave)).toEqual(['2:1', '3:1']);
    expect(chamadasNovas(faladas, leitura)).toEqual([]);
    // Chamar de novo a mesma senha muda a chave: fala outra vez.
    expect(chamadasNovas(faladas, [{ chave: '2:2' }, ...leitura]).map((c) => c.chave)).toEqual(['2:2']);
  });

  it('as chaves lembradas têm teto', () => {
    const faladas = new Set<string>();
    chamadasNovas(
      faladas,
      Array.from({ length: TETO_CHAVES_FALADAS + 50 }, (_, i) => ({ chave: `${i}:1` })),
    );
    expect(faladas.size).toBe(TETO_CHAVES_FALADAS);
  });

  it('a fila fala uma por vez: a seguinte só no fim da anterior; a falha passa à seguinte', () => {
    const ditos: string[] = [];
    const fins: (() => void)[] = [];
    const s: Sintetizador = {
      falar(texto, fim) {
        if (texto === 'quebra') throw new Error('sem voz');
        ditos.push(texto);
        fins.push(fim);
      },
    };
    const f = new FilaDeVoz(s);
    f.enfileirar('Senha EX 001, guichê 1', 'Senha EX 002, guichê 2');
    expect(ditos).toEqual(['Senha EX 001, guichê 1']);
    expect(f.pendentes).toBe(2);
    fins[0]?.();
    fins[0]?.(); // o fim repetido não pula a fila
    expect(ditos).toEqual(['Senha EX 001, guichê 1', 'Senha EX 002, guichê 2']);
    f.enfileirar('quebra', 'Senha EX 003, guichê 3');
    fins[1]?.();
    expect(ditos.at(-1)).toBe('Senha EX 003, guichê 3');
    fins[2]?.();
    expect(f.pendentes).toBe(0);
  });
});
