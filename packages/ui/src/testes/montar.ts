// Montagem de componente nos testes: OpenVue (sem tema) + vue-i18n pt-BR, como na aplicação.
import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import OpenVue from 'openvue/config';
import type { Component } from 'vue';
import { criarI18n } from '../i18n/criar.js';

export function montar<C extends Component>(componente: C, opcoes: ComponentMountingOptions<C> = {}) {
  return mount(componente, {
    ...opcoes,
    attachTo: document.body,
    global: {
      ...(opcoes.global ?? {}),
      plugins: [[OpenVue, { theme: 'none' }], criarI18n(), ...(opcoes.global?.plugins ?? [])],
    },
  } as ComponentMountingOptions<C>);
}

export async function esperar(ms = 0): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
