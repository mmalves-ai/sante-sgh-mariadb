import { describe, expect, it } from 'vitest';
import { buscaDaListaAtual, haBuscaDaLista, registrarBuscaDaLista } from './busca-da-lista.js';

describe('busca da lista atual (atalho "/")', () => {
  it('a mais recente vence; ao soltar, volta a anterior', () => {
    const a = document.createElement('input');
    const div = document.createElement('div');
    const b = document.createElement('input');
    div.appendChild(b);
    const soltarA = registrarBuscaDaLista(a);
    const soltarB = registrarBuscaDaLista(div);
    expect(buscaDaListaAtual()).toBe(b);
    soltarB();
    expect(buscaDaListaAtual()).toBe(a);
    soltarA();
    expect(haBuscaDaLista()).toBe(false);
    expect(buscaDaListaAtual()).toBeNull();
  });
});
