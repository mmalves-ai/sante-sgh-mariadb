import { describe, expect, it, vi } from 'vitest';
import { ATALHOS, RegistroDeAtalhos, atalhoDaTecla, emCampoDeTexto, type TeclaLida } from './atalhos.js';

const tecla = (key: string, mod: Partial<TeclaLida> = {}): TeclaLida => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mod,
});

describe('atalhos globais (regra 14)', () => {
  it('os 8 atalhos do cap-03 §3.4, na ordem', () => {
    expect(ATALHOS.map((a) => a.teclas)).toEqual([
      'Ctrl+K',
      '/',
      'F2',
      'Ctrl+Enter',
      'Alt+P',
      'Alt+E',
      'Esc',
      '?',
    ]);
  });

  it('reconhece cada tecla', () => {
    expect(atalhoDaTecla(tecla('k', { ctrlKey: true }))).toBe('paleta');
    expect(atalhoDaTecla(tecla('K', { metaKey: true }))).toBe('paleta');
    expect(atalhoDaTecla(tecla('/'))).toBe('busca-lista');
    expect(atalhoDaTecla(tecla('F2'))).toBe('salvar-rascunho');
    expect(atalhoDaTecla(tecla('Enter', { ctrlKey: true }))).toBe('concluir');
    expect(atalhoDaTecla(tecla('π', { altKey: true, code: 'KeyP' }))).toBe('nova-prescricao');
    expect(atalhoDaTecla(tecla('e', { altKey: true }))).toBe('nova-evolucao');
    expect(atalhoDaTecla(tecla('Escape'))).toBe('fechar');
    expect(atalhoDaTecla(tecla('?', { shiftKey: true }))).toBe('ajuda');
    expect(atalhoDaTecla(tecla('a'))).toBeNull();
    expect(atalhoDaTecla(tecla('x', { ctrlKey: true }))).toBeNull();
  });

  it('atalho sem ação não aparece no painel "?" e não faz nada', () => {
    const r = new RegistroDeAtalhos();
    expect(r.disponiveis()).toEqual([]);
    expect(r.tratar(tecla('F2'), null)).toBe(false);
    const salvar = vi.fn();
    const soltar = r.registrar('salvar-rascunho', salvar);
    expect(r.disponiveis().map((a) => a.id)).toEqual(['salvar-rascunho']);
    expect(r.tratar(tecla('F2'), null)).toBe(true);
    expect(salvar).toHaveBeenCalledTimes(1);
    soltar();
    expect(r.tratar(tecla('F2'), null)).toBe(false);
  });

  it('a ação mais recente vence; ao soltar, a anterior volta', () => {
    const r = new RegistroDeAtalhos();
    const a = vi.fn();
    const b = vi.fn();
    r.registrar('fechar', a);
    const soltarB = r.registrar('fechar', b);
    r.tratar(tecla('Escape'), null);
    expect(b).toHaveBeenCalledTimes(1);
    soltarB();
    r.tratar(tecla('Escape'), null);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('"/" e "?" não disparam enquanto se digita; Ctrl+K e F2 disparam também no campo', () => {
    const r = new RegistroDeAtalhos();
    const busca = vi.fn();
    const paleta = vi.fn();
    r.registrar('busca-lista', busca);
    r.registrar('paleta', paleta);
    const campo = { tagName: 'INPUT' } as unknown as EventTarget;
    expect(r.tratar(tecla('/'), campo)).toBe(false);
    expect(busca).not.toHaveBeenCalled();
    expect(r.tratar(tecla('k', { ctrlKey: true }), campo)).toBe(true);
    expect(paleta).toHaveBeenCalledTimes(1);
    expect(emCampoDeTexto({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(emCampoDeTexto(null)).toBe(false);
  });
});

describe('keydown sem key (preenchimento automático do navegador)', () => {
  it('não quebra e não aciona atalho', () => {
    expect(
      atalhoDaTecla({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as TeclaLida),
    ).toBeNull();
  });
});
