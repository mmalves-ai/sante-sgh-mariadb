import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { montar } from '../testes/montar.js';
import SanteData from './SanteData.vue';
import SanteHora from './SanteHora.vue';

describe('SanteData (regra 7)', () => {
  it('vazio (null) aparece como "Sem data"', () => {
    const w = montar(SanteData, { props: { modelValue: null } });
    expect(w.text()).toBe('Sem data');
    w.unmount();
  });

  it('data válida aparece dd/mm/aaaa num <time>', () => {
    const w = montar(SanteData, { props: { modelValue: '2026-10-19' } });
    expect(w.find('time').text()).toBe('19/10/2026');
    expect(w.find('time').attributes('datetime')).toBe('2026-10-19');
    w.unmount();
  });

  it('ano fora da faixa de sanidade (ex.: 5202) aparece com alerta de dado inválido, sem correção', () => {
    const w = montar(SanteData, { props: { modelValue: '5202-03-01' } });
    const alerta = w.find('[data-testid="data-invalida"]');
    expect(alerta.text()).toContain('Dado inválido no sistema de origem: 01/03/5202');
    expect(alerta.text()).toContain('Não foi corrigido');
    w.unmount();
  });

  it('valor malformado também é sinalizado, com o valor bruto', () => {
    const w = montar(SanteData, { props: { modelValue: '2026-02-30' } });
    expect(w.text()).toContain('2026-02-30');
    w.unmount();
  });

  it('editável: dd/mm/aaaa vira AAAA-MM-DD; vazio vira null; inválido mostra erro e não emite', async () => {
    const emitidos: (string | null)[] = [];
    const w = montar(SanteData, {
      props: {
        modelValue: null,
        editavel: true,
        rotulo: 'Nascimento',
        'onUpdate:modelValue': (v: string | null) => emitidos.push(v),
      },
    });
    const input = w.find('input');
    await input.setValue('5/1/2026');
    await input.trigger('blur');
    expect(emitidos.at(-1)).toBe('2026-01-05');
    await input.setValue('31/02/2026');
    await input.trigger('blur');
    await nextTick();
    expect(w.text()).toContain('Data inexistente');
    expect(emitidos).toHaveLength(1);
    await input.setValue('');
    await input.trigger('keydown', { key: 'Enter' });
    expect(emitidos.at(-1)).toBeNull();
    w.unmount();
  });

  it('com máximo, a data depois dele mostra o erro e não emite; a do máximo passa', async () => {
    const emitidos: (string | null)[] = [];
    const w = montar(SanteData, {
      props: {
        modelValue: null,
        editavel: true,
        rotulo: 'Data',
        maximo: '2026-10-29',
        'onUpdate:modelValue': (v: string | null) => emitidos.push(v),
      },
    });
    const input = w.find('input');
    await input.setValue('01/10/2062');
    await input.trigger('blur');
    await nextTick();
    expect(w.text()).toContain('não pode passar de 29/10/2026');
    expect(emitidos).toHaveLength(0);
    await input.setValue('29/10/2026');
    await input.trigger('blur');
    expect(emitidos.at(-1)).toBe('2026-10-29');
    w.unmount();
  });
});

describe('SanteHora (regra 8)', () => {
  it('mostra HH:MM e vazio como "Sem hora"', () => {
    const w = montar(SanteHora, { props: { modelValue: '08:01' } });
    expect(w.text()).toBe('08:01');
    w.unmount();
    const v = montar(SanteHora, { props: { modelValue: null } });
    expect(v.text()).toBe('Sem hora');
    v.unmount();
  });

  it('editável: aceita H:MM e quatro dígitos, devolve sempre HH:MM; recusa 25:00', async () => {
    const emitidos: (string | null)[] = [];
    const w = montar(SanteHora, {
      props: {
        modelValue: null,
        editavel: true,
        rotulo: 'Hora',
        'onUpdate:modelValue': (v: string | null) => emitidos.push(v),
      },
    });
    const input = w.find('input');
    await input.setValue('8:05');
    await input.trigger('blur');
    expect(emitidos.at(-1)).toBe('08:05');
    await input.setValue('1630');
    await input.trigger('keydown', { key: 'Enter' });
    expect(emitidos.at(-1)).toBe('16:30');
    await input.setValue('25:00');
    await input.trigger('blur');
    await nextTick();
    expect(w.text()).toContain('fora do intervalo');
    expect(emitidos).toHaveLength(2);
    await input.setValue(' ');
    await input.trigger('blur');
    expect(emitidos.at(-1)).toBeNull();
    w.unmount();
  });
});

describe('valor inválido vindo do legado nunca é apagado nem corrigido em silêncio (regra 7)', () => {
  it('SanteData editável com valor malformado: alerta visível e sair do campo sem digitar não grava', async () => {
    const emitidos: (string | null)[] = [];
    const w = montar(SanteData, {
      props: {
        modelValue: '2026-02-30',
        editavel: true,
        rotulo: 'Retorno',
        'onUpdate:modelValue': (v: string | null) => emitidos.push(v),
      },
    });
    expect(w.find('[data-testid="data-invalida"]').text()).toContain('2026-02-30');
    await w.find('input').trigger('blur');
    await w.find('input').trigger('keydown', { key: 'Enter' });
    expect(emitidos).toEqual([]);
    w.unmount();
  });

  it('SanteData: ano 0005 aparece como fora da faixa (não como 1905 nem malformado)', () => {
    const w = montar(SanteData, { props: { modelValue: '0005-01-01' } });
    expect(w.find('[data-testid="data-invalida"]').text()).toContain('01/01/0005');
    w.unmount();
  });

  it('SanteHora: "2575" e "08300" aparecem como vieram, com alerta, sem virar 25:75 ou 08:300', async () => {
    for (const bruto of ['2575', '08300']) {
      const w = montar(SanteHora, { props: { modelValue: bruto } });
      const alerta = w.find('[data-testid="hora-invalida"]');
      expect(alerta.text()).toContain(bruto);
      expect(w.text()).not.toMatch(/25:75|08:300/);
      w.unmount();
    }
    const emitidos: (string | null)[] = [];
    const e = montar(SanteHora, {
      props: {
        modelValue: '2575',
        editavel: true,
        rotulo: 'Hora',
        'onUpdate:modelValue': (v: string | null) => emitidos.push(v),
      },
    });
    expect(e.find('[data-testid="hora-invalida"]').exists()).toBe(true);
    expect((e.find('input').element as HTMLInputElement).value).toBe('2575');
    await e.find('input').trigger('blur');
    expect(emitidos).toEqual([]);
    e.unmount();
  });
});
