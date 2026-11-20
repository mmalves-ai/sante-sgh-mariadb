import { describe, expect, it } from 'vitest';
import { lerArgumentos } from './argumentos.ts';

describe('argumentos dos comandos da raiz', () => {
  it('lê --chave=valor, bandeiras e posicionais; ignora o -- do pnpm', () => {
    const a = lerArgumentos(['restaurar', '--', '--hospital=pc', '--destino=dev', '--conferir']);
    expect(a.posicionais).toEqual(['restaurar']);
    expect(a.opcoes).toEqual({ hospital: 'pc', destino: 'dev' });
    expect([...a.bandeiras]).toEqual(['conferir']);
  });
});
