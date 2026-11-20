import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { montar } from '../testes/montar.js';
import SanteChave from './SanteChave.vue';

async function violacoes(el: Element): Promise<string[]> {
  const r = await axe.run(el, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return r.violations.map((v) => `${v.id}(${v.impact ?? '?'})`);
}

describe('SanteChave: chave liga/desliga única (X-01)', () => {
  it('role=switch com aria-checked e rótulo associado; emite o valor pedido sem mudar sozinha', async () => {
    const w = montar(SanteChave, { props: { ligada: true, rotulo: 'Acesso liberado' } });
    const b = w.get('[role="switch"]');
    expect(b.attributes('aria-checked')).toBe('true');
    expect(document.getElementById(b.attributes('aria-labelledby')!)?.textContent).toBe('Acesso liberado');
    await b.trigger('click');
    expect(w.emitted('alternar')).toEqual([[false]]);
    expect(b.attributes('aria-checked')).toBe('true');
    w.unmount();
  });

  it('o texto de estado diz Sim/Não (a cor nunca é a única informação) e aceita texto próprio', async () => {
    const w = montar(SanteChave, { props: { ligada: false, rotulo: 'Ativo' } });
    expect(w.get('.chave__estado').text()).toBe('Não');
    await w.setProps({ ligada: true });
    expect(w.get('.chave__estado').text()).toBe('Sim');
    await w.setProps({ textoLigada: 'Liberado' });
    expect(w.get('.chave__estado').text()).toBe('Liberado');
    w.unmount();
  });

  it('desabilitada não emite e mostra o motivo em texto, ligado por aria-describedby', async () => {
    const w = montar(SanteChave, {
      props: {
        ligada: false,
        rotulo: 'Administrador',
        descricao: 'Acesso total.',
        desabilitada: true,
        motivo: 'Indisponível.',
      },
    });
    const b = w.get('[role="switch"]');
    expect(b.attributes('disabled')).toBeDefined();
    await b.trigger('click');
    expect(w.emitted('alternar')).toBeUndefined();
    const ids = b.attributes('aria-describedby')!.split(' ');
    expect(ids.map((i) => document.getElementById(i)?.textContent)).toEqual([
      'Acesso total.',
      'Indisponível.',
    ]);
    w.unmount();
  });

  it('ocultarRotulo deixa o nome só para o leitor de tela; atributos extras vão ao botão', () => {
    const w = montar(SanteChave, {
      props: { ligada: true, rotulo: 'Permissão X', ocultarRotulo: true },
      attrs: { 'data-testid': 'chave-x' },
    });
    const b = w.get('[data-testid="chave-x"]');
    expect(b.attributes('role')).toBe('switch');
    expect(document.getElementById(b.attributes('aria-labelledby')!)?.classList).toContain(
      'sgh-visualmente-oculto',
    );
    w.unmount();
  });

  it('axe: 0 violação ligada, desligada e desabilitada', async () => {
    const w = montar(SanteChave, {
      props: { ligada: true, rotulo: 'Acesso liberado', descricao: 'Entra no sistema.' },
    });
    await nextTick();
    expect(await violacoes(w.element)).toEqual([]);
    await w.setProps({ ligada: false, desabilitada: true, motivo: 'Indisponível.' });
    expect(await violacoes(w.element)).toEqual([]);
    w.unmount();
  });
});
