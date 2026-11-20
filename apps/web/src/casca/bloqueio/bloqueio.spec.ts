import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EventosSessao,
  RelogioInatividade,
  eventosSessao,
  isolarForaDaCasca,
  usarBloqueio,
} from './bloqueio.js';

describe('bloqueio de sessão (regra 16)', () => {
  afterEach(() => vi.useRealTimers());

  it('os eventos de sessão (M05) bloqueiam e desbloqueiam', () => {
    setActivePinia(createPinia());
    const b = usarBloqueio();
    eventosSessao.emitir('bloquear');
    expect(b.bloqueada).toBe(true);
    eventosSessao.emitir('desbloquear');
    expect(b.bloqueada).toBe(false);
  });

  it('inatividade dispara depois do prazo; atividade reinicia; 0 desliga', () => {
    vi.useFakeTimers();
    const esgotou = vi.fn();
    const r = new RelogioInatividade(10, esgotou);
    r.atividade();
    vi.advanceTimersByTime(9_000);
    r.atividade();
    vi.advanceTimersByTime(9_000);
    expect(esgotou).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(esgotou).toHaveBeenCalledTimes(1);
    r.configurar(0);
    vi.advanceTimersByTime(60_000);
    expect(esgotou).toHaveBeenCalledTimes(1);
    r.parar();
  });

  it('ouvinte solto não recebe mais', () => {
    const ev = new EventosSessao();
    const o = vi.fn();
    const soltar = ev.ouvir(o);
    ev.emitir('bloquear');
    soltar();
    ev.emitir('bloquear');
    expect(o).toHaveBeenCalledTimes(1);
  });
});

describe('isolarForaDaCasca: overlays desenhados no body também ficam ocultos e inertes', () => {
  it('isola os irmãos da casca, os que surgem durante o bloqueio, e restaura ao desbloquear', async () => {
    document.body.innerHTML =
      '<div id="app"><div id="casca"></div></div><div id="dialogo" aria-hidden="false"></div>';
    const raiz = document.getElementById('casca')!;
    const dialogo = document.getElementById('dialogo')!;
    const desfazer = isolarForaDaCasca(raiz);
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false);
    expect(dialogo.hasAttribute('inert')).toBe(true);
    expect(dialogo.getAttribute('aria-hidden')).toBe('true');
    expect(dialogo.style.visibility).toBe('hidden');
    const popover = document.createElement('div');
    document.body.appendChild(popover);
    await Promise.resolve();
    expect(popover.hasAttribute('inert')).toBe(true);
    desfazer();
    expect(dialogo.hasAttribute('inert')).toBe(false);
    expect(dialogo.getAttribute('aria-hidden')).toBe('false');
    expect(dialogo.style.visibility).toBe('');
    expect(popover.hasAttribute('inert')).toBe(false);
    expect(popover.hasAttribute('aria-hidden')).toBe(false);
  });
});
