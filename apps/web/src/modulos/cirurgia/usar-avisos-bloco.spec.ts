// Avisos do quadro do bloco (M46, etapa 2; ficha, seção 7: "tempo real"): o aviso do canal relê na hora; com o canal
// aberto, a releitura de segurança segue a cada 60 s; sem o canal, a reserva relê a cada 15 s; ao reconectar, relê.
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import {
  RELEITURA_COM_CANAL_BLOCO_MS,
  RELEITURA_SEM_CANAL_BLOCO_MS,
  usarAvisosDoBloco,
} from './usar-avisos-bloco.js';

class FonteFalsa {
  static ultima: FonteFalsa | null = null;
  private readonly ouvintes = new Map<string, (() => void)[]>();
  constructor(readonly url: string) {
    FonteFalsa.ultima = this;
  }
  addEventListener(tipo: string, f: () => void) {
    this.ouvintes.set(tipo, [...(this.ouvintes.get(tipo) ?? []), f]);
  }
  emitir(tipo: string) {
    for (const f of this.ouvintes.get(tipo) ?? []) f();
  }
  close() {}
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const montar = (aoMudar: () => void) =>
  mount(
    defineComponent({
      setup() {
        usarAvisosDoBloco(aoMudar);
        return () => h('div');
      },
    }),
  );

describe('avisos do quadro do bloco', () => {
  it('com o canal: o aviso relê; a releitura de segurança a cada 60 s; sem o canal, a cada 15 s; ao reconectar, relê', () => {
    vi.stubGlobal('EventSource', FonteFalsa);
    const aoMudar = vi.fn();
    const w = montar(aoMudar);
    const f = FonteFalsa.ultima!;
    f.emitir('open');
    expect(aoMudar).not.toHaveBeenCalled();
    f.emitir('mudanca');
    expect(aoMudar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RELEITURA_COM_CANAL_BLOCO_MS - 1);
    expect(aoMudar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(aoMudar).toHaveBeenCalledTimes(2);
    f.emitir('error');
    vi.advanceTimersByTime(RELEITURA_SEM_CANAL_BLOCO_MS);
    expect(aoMudar).toHaveBeenCalledTimes(3);
    f.emitir('open');
    expect(aoMudar).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(RELEITURA_SEM_CANAL_BLOCO_MS);
    expect(aoMudar).toHaveBeenCalledTimes(4);
    w.unmount();
    vi.advanceTimersByTime(RELEITURA_COM_CANAL_BLOCO_MS);
    expect(aoMudar).toHaveBeenCalledTimes(4);
  });

  it('sem EventSource no navegador, a reserva de 15 s', () => {
    vi.stubGlobal('EventSource', undefined);
    const aoMudar = vi.fn();
    const w = montar(aoMudar);
    vi.advanceTimersByTime(RELEITURA_SEM_CANAL_BLOCO_MS * 2);
    expect(aoMudar).toHaveBeenCalledTimes(2);
    w.unmount();
  });
});
