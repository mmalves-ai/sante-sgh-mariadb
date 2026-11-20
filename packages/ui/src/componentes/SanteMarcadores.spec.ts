import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { montar } from '../testes/montar.js';
import SanteMarcadores from './SanteMarcadores.vue';
import { LIMIAR_BUSCA } from './selecao.js';

const OPCOES = Array.from({ length: 300 }, (_, i) => ({
  valor: i + 1,
  rotulo: i === 41 ? 'Ecocardiograma sintético' : `Exame sintético ${i + 1}`,
}));
const visiveis = (w: ReturnType<typeof montar>) =>
  w.findAll('input[type="checkbox"]').map((x) => Number(x.attributes('data-valor')));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SanteMarcadores: seleção múltipla com busca (ADR 0027)', () => {
  it(`até ${LIMIAR_BUSCA} opções: sem busca`, () => {
    const w = montar(SanteMarcadores, {
      props: { legenda: 'Convênios', opcoes: OPCOES.slice(0, LIMIAR_BUSCA), modelValue: [] },
    });
    expect(w.find('input[type="search"]').exists()).toBe(false);
    expect(visiveis(w)).toHaveLength(LIMIAR_BUSCA);
    w.unmount();
  });

  it('lista grande: a busca filtra por palavras sem acento e os marcados ficam sempre visíveis', async () => {
    const emitidos: number[][] = [];
    const w = montar(SanteMarcadores, {
      props: {
        legenda: 'Exames oferecidos',
        opcoes: OPCOES,
        modelValue: [3],
        'onUpdate:modelValue': (v: (string | number)[]) => emitidos.push(v as number[]),
      },
    });
    const caixa = w.find('input[type="search"]');
    expect(caixa.exists()).toBe(true);
    expect(w.text()).toContain('1 marcado');
    await caixa.setValue('ECOCARDIOGRAMA');
    expect(visiveis(w)).toEqual([3, 42]);
    await w.find('input[data-valor="42"]').setValue(true);
    expect(emitidos.at(-1)).toEqual([3, 42]);
    await w.setProps({ modelValue: [3, 42] } as never);
    await w.find('input[data-valor="3"]').setValue(false);
    expect(emitidos.at(-1)).toEqual([42]);
    await w.setProps({ modelValue: [] } as never);
    await caixa.setValue('nada assim');
    await nextTick();
    expect(visiveis(w)).toEqual([]);
    expect(w.text()).toContain('Nenhuma opção encontrada');
    w.unmount();
  });

  it('acessível: fieldset com legenda, busca com rótulo; sem violações do axe', async () => {
    const w = montar(SanteMarcadores, {
      props: { legenda: 'Exames oferecidos', opcoes: OPCOES.slice(0, 20), modelValue: [1] },
    });
    expect(w.find('legend').text()).toBe('Exames oferecidos');
    const r = await axe.run(w.element, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(r.violations.map((v) => v.id)).toEqual([]);
    w.unmount();
  });
});
