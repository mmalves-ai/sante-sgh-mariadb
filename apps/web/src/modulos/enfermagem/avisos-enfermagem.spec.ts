// Canal de avisos da enfermagem: o servidor não reenvia o que saiu durante a queda, então a tela relê ao reconectar
// (e não na primeira abertura); sem canal, a releitura de reserva fica ligada.
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { usarAvisosEnfermagem } from './usar-enfermagem.js';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('avisos da enfermagem', () => {
  it('relê ao reconectar, depois de uma queda do canal', () => {
    vi.stubGlobal('EventSource', FonteFalsa);
    const aoMudar = vi.fn();
    const w = mount(
      defineComponent({
        setup() {
          usarAvisosEnfermagem(aoMudar);
          return () => h('div');
        },
      }),
    );
    const f = FonteFalsa.ultima!;
    f.emitir('open');
    expect(aoMudar).not.toHaveBeenCalled();
    f.emitir('error');
    f.emitir('open');
    expect(aoMudar).toHaveBeenCalledTimes(1);
    f.emitir('mudanca');
    expect(aoMudar).toHaveBeenCalledTimes(2);
    w.unmount();
  });
});
