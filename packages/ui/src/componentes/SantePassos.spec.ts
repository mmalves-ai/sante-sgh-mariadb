import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { montar } from '../testes/montar.js';
import SantePassos from './SantePassos.vue';

const passos = [
  { valor: '1', rotulo: 'Dados' },
  { valor: '2', rotulo: 'Conferência' },
  { valor: '3', rotulo: 'Conclusão' },
];

async function violacoes(el: Element) {
  const r = await axe.run(el, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return r.violations.map((v) => `${v.id}(${v.impact ?? '?'})`);
}

describe('SantePassos: Stepper do OpenVue com papéis ARIA corrigidos (DP-51, condição 4)', () => {
  it('sem role=tablist nem role=tab; lista ordenada com aria-current="step"', async () => {
    const w = montar(SantePassos, { props: { passos, modelValue: '2' } });
    await nextTick();
    expect(w.find('[role="tablist"]').exists()).toBe(false);
    expect(w.find('[role="tab"]').exists()).toBe(false);
    expect(w.findAll('[role="listitem"]')).toHaveLength(3);
    expect(w.find('[aria-current="step"]').text()).toContain('Conferência');
    w.unmount();
  });

  it('axe: 0 violação no embrulho', async () => {
    const w = montar(SantePassos, { props: { passos, modelValue: '1' } });
    await nextTick();
    expect(await violacoes(w.element)).toEqual([]);
    w.unmount();
  });

  it('o Stepper cru do OpenVue tem a violação (prova de que o embrulho é necessário)', async () => {
    const { default: Stepper } = await import('openvue/stepper');
    const { default: StepList } = await import('openvue/steplist');
    const { default: Step } = await import('openvue/step');
    const { h } = await import('vue');
    const Cru = {
      render: () =>
        h(Stepper, { value: '1' }, () =>
          h(StepList, () => passos.map((p) => h(Step, { value: p.valor }, () => p.rotulo))),
        ),
    };
    const w = montar(Cru);
    await nextTick();
    expect((await violacoes(w.element)).join(' ')).toMatch(/aria-required-children|aria-valid-attr-value/);
    w.unmount();
  });

  it('clicar num passo troca o atual', async () => {
    const emitidos: string[] = [];
    const w = montar(SantePassos, {
      props: { passos, modelValue: '1', 'onUpdate:modelValue': (v: string) => emitidos.push(v) },
    });
    await w.findAll('button')[2]!.trigger('click');
    expect(emitidos).toEqual(['3']);
    w.unmount();
  });
});
