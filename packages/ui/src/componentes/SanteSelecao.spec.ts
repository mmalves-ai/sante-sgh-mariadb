import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { esperar, montar } from '../testes/montar.js';
import SanteSelecao from './SanteSelecao.vue';
import { LIMIAR_BUSCA, filtrarOpcoes } from './selecao.js';

const NOMES = [
  'Ana Júlia Prado',
  'André Souza',
  'Bruno Lima',
  'Carla Ávila',
  'Débora Nunes',
  'Eduardo Silva',
  'Fábio Costa',
  'Gisele Rocha',
  'Hélio Martins',
  'Íris Fonseca',
  'João da Silva',
  'Lúcia Barros',
];
const grandes = NOMES.map((rotulo, i) => ({ valor: `p${i}`, rotulo }));

async function violacoes(el: Element) {
  const r = await axe.run(el, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return r.violations.map((v) => `${v.id}(${v.impact ?? '?'})`);
}

/** Abre a lista (o OpenVue a anexa ao body). */
async function abrir(w: ReturnType<typeof montar>) {
  await w.find('[role="combobox"]').trigger('click');
  await esperar(0);
  await nextTick();
}
const opcoesAbertas = () =>
  [...document.body.querySelectorAll('[role="option"] [data-valor]')].map((o) => o.textContent?.trim());
const busca = () => document.body.querySelector<HTMLInputElement>('input[role="searchbox"]');
async function digitar(texto: string) {
  const caixa = busca()!;
  caixa.value = texto;
  caixa.dispatchEvent(new Event('input'));
  await nextTick();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('filtrarOpcoes', () => {
  it('sem acento, sem caixa e por palavras em qualquer ordem, na ordem original', () => {
    expect(filtrarOpcoes(grandes, 'SILVA').map((o) => o.rotulo)).toEqual(['Eduardo Silva', 'João da Silva']);
    expect(filtrarOpcoes(grandes, 'avila').map((o) => o.rotulo)).toEqual(['Carla Ávila']);
    expect(filtrarOpcoes(grandes, 'silva joao').map((o) => o.rotulo)).toEqual(['João da Silva']);
    expect(filtrarOpcoes(grandes, '   ')).toBe(grandes);
  });

  it('o valor escolhido pode ser mantido no filtro', () => {
    expect(filtrarOpcoes(grandes, 'silva', 'p0').map((o) => o.valor)).toEqual(['p0', 'p5', 'p10']);
  });
});

describe('SanteSelecao: busca embutida na lista (ADR 0027)', () => {
  it(`até ${LIMIAR_BUSCA} opções: lista sem busca`, async () => {
    const w = montar(SanteSelecao, {
      props: { rotulo: 'Tipo', opcoes: grandes.slice(0, LIMIAR_BUSCA), modelValue: 'p0' },
    });
    await abrir(w);
    expect(opcoesAbertas()).toHaveLength(LIMIAR_BUSCA);
    expect(busca()).toBeNull();
    w.unmount();
  });

  it('lista grande: a busca fica dentro da lista, filtra por palavras e a escolha emite o valor', async () => {
    const emitidos: (string | number | null)[] = [];
    const w = montar(SanteSelecao, {
      props: {
        rotulo: 'Profissional',
        opcoes: grandes,
        modelValue: 'p0',
        'onUpdate:modelValue': (v: string | number | null) => emitidos.push(v),
      },
    });
    await abrir(w);
    const caixa = busca();
    expect(caixa).not.toBeNull();
    // A caixa mora no painel da lista (o mesmo que contém as opções), não ao lado do campo.
    const painel = document.body.querySelector('[role="listbox"]')!.closest('[data-pc-section="overlay"]');
    expect(painel?.contains(caixa)).toBe(true);
    expect(w.element.contains(caixa)).toBe(false);
    expect(caixa!.getAttribute('aria-label')).toBe('Buscar na lista');
    await digitar('silva joao');
    expect(opcoesAbertas()).toEqual(['João da Silva']);
    await digitar('xyz');
    expect(opcoesAbertas()).toEqual([]);
    expect(document.body.textContent).toContain('Nenhuma opção encontrada');
    await digitar('silva');
    expect(opcoesAbertas()).toEqual(['Eduardo Silva', 'João da Silva']);
    // O OpenVue escolhe no mousedown (o clique do navegador e do Playwright passa por ele).
    document.body
      .querySelector<HTMLElement>('[role="option"]:has([data-valor="p10"])')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();
    expect(emitidos).toEqual(['p10']);
    w.unmount();
  });

  it('busca remota: lista curta com busca, cada termo vai a buscar e as opções vêm sem filtro local', async () => {
    const termos: string[] = [];
    const w = montar(SanteSelecao, {
      props: {
        rotulo: 'Item cobrado',
        opcoes: [
          { valor: '', rotulo: 'Sem ligação' },
          { valor: '7', rotulo: '30310 — Apendicectomia' },
        ],
        modelValue: '',
        buscar: (q: string) => termos.push(q),
      },
    });
    await abrir(w);
    expect(busca()).not.toBeNull();
    await digitar('apendice');
    expect(termos).toEqual(['apendice']);
    // O servidor já filtrou: a tela decide o que mostra (nada some pelo filtro local).
    expect(opcoesAbertas()).toEqual(['Sem ligação', '30310 — Apendicectomia']);
    w.unmount();
  });

  it('nome do campo pelo rótulo; data-valor para os testes; obrigatório anunciado', () => {
    const w = montar(SanteSelecao, {
      props: { rotulo: 'Profissional', opcoes: grandes, modelValue: 'p5', obrigatorio: true },
    });
    const combo = w.find('[role="combobox"]');
    const rotulo = w.find('.sgh-selecao__rotulo');
    expect(combo.attributes('aria-labelledby')).toBe(rotulo.attributes('id'));
    expect(rotulo.text()).toBe('Profissional');
    expect(combo.attributes('aria-required')).toBe('true');
    expect(w.attributes('data-valor')).toBe('p5');
    expect(combo.text()).toBe('Eduardo Silva');
    w.unmount();
  });

  it('valor nulo mostra o rótulo da opção vazia; aceita número; busca forçada', async () => {
    const w = montar(SanteSelecao, {
      props: {
        rotulo: 'Situação',
        opcoes: [
          { valor: null, rotulo: 'Todas' },
          { valor: 1, rotulo: 'Aberta' },
        ],
        modelValue: null,
        busca: true,
      },
    });
    expect(w.find('[role="combobox"]').text()).toBe('Todas');
    expect(w.attributes('data-valor')).toBe('');
    await abrir(w);
    expect(busca()).not.toBeNull();
    w.unmount();
    const longa = montar(SanteSelecao, {
      props: { rotulo: 'P', opcoes: grandes, modelValue: 'p0', busca: false },
    });
    await abrir(longa);
    expect(busca()).toBeNull();
    longa.unmount();
  });

  it('desabilitado não abre', async () => {
    const w = montar(SanteSelecao, {
      props: { rotulo: 'P', opcoes: grandes, modelValue: 'p0', desabilitado: true },
    });
    await abrir(w);
    expect(opcoesAbertas()).toEqual([]);
    w.unmount();
  });

  it('axe: 0 violação fechado e aberto com a busca', async () => {
    const w = montar(SanteSelecao, { props: { rotulo: 'Profissional', opcoes: grandes, modelValue: 'p0' } });
    await nextTick();
    expect(await violacoes(w.element)).toEqual([]);
    await abrir(w);
    expect(await violacoes(document.body)).toEqual([]);
    w.unmount();
  });
});
