import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';
import { PACOTES_DE_MARCA, PACOTE_NEUTRO, pacoteDeMarca, resolverMarca } from '../marca/index.js';
import { esperar, montar } from '../testes/montar.js';
import SanteDialogo from './SanteDialogo.vue';
import SanteMarca from './SanteMarca.vue';
import SanteOpcoes from './SanteOpcoes.vue';
import SanteSelecao from './SanteSelecao.vue';

describe('marca por parâmetro (DP-49, DP-9)', () => {
  it('nome do produto vem da configuração; logo provisório tem selo', () => {
    const w = montar(SanteMarca, {
      props: { pacote: pacoteDeMarca('rede-sante'), produto: 'Produto configurado' },
    });
    expect(w.text()).toContain('Produto configurado');
    expect(w.text()).toContain('provisório');
    expect(w.find('img').attributes('alt')).toBe('');
    w.unmount();
  });

  it('versão invertida usa o símbolo branco; pacote desconhecido é recusado', () => {
    const p = PACOTES_DE_MARCA['rede-sante']!;
    const w = montar(SanteMarca, { props: { pacote: p, produto: 'X', invertida: true } });
    expect(w.find('img').attributes('src')).toBe(p.simboloBranco);
    w.unmount();
    expect(() => pacoteDeMarca('rede-inexistente')).toThrow(/não registrado/);
  });

  it('MARCA desconhecida nunca cai na marca de outra rede: pacote neutro com aviso visível', () => {
    expect(resolverMarca('rede-sante')).toEqual({ pacote: PACOTES_DE_MARCA['rede-sante'], conhecida: true });
    const r = resolverMarca('rede-inexistente');
    expect(r.conhecida).toBe(false);
    expect(r.pacote).toBe(PACOTE_NEUTRO);
    expect(resolverMarca(null).pacote).toBe(PACOTE_NEUTRO);
    const w = montar(SanteMarca, { props: { pacote: r.pacote, produto: 'Produto configurado' } });
    expect(w.find('[data-testid="marca-nao-configurada"]').text()).toBe('marca não configurada');
    expect(w.find('img').attributes('src')).toBe(PACOTE_NEUTRO.simbolo);
    expect(w.find('img').attributes('src')).not.toBe(PACOTES_DE_MARCA['rede-sante']!.simbolo);
    w.unmount();
  });
});

describe('SanteOpcoes e SanteSelecao', () => {
  it('rádios num fieldset com legenda; troca o valor', async () => {
    const valor = ref<'a' | 'b'>('a');
    const w = montar(SanteOpcoes, {
      props: {
        legenda: 'Tema',
        opcoes: [
          { valor: 'a', rotulo: 'Claro' },
          { valor: 'b', rotulo: 'Escuro' },
        ],
        modelValue: valor.value,
        'onUpdate:modelValue': (v: string) => (valor.value = v as 'a' | 'b'),
      },
    });
    expect(w.find('legend').text()).toBe('Tema');
    await w.findAll('input')[1]!.setValue(true);
    expect(valor.value).toBe('b');
    w.unmount();
  });

  it('seleção com rótulo ligado (aria-labelledby) e rótulo oculto', async () => {
    const emitidos: (string | number | null)[] = [];
    const w = montar(SanteSelecao, {
      props: {
        rotulo: 'Estabelecimento',
        opcoes: [
          { valor: 'aa', rotulo: 'A' },
          { valor: 'bb', rotulo: 'B' },
        ],
        modelValue: 'aa',
        ocultarRotulo: true,
        'onUpdate:modelValue': (v: string | number | null) => emitidos.push(v),
      },
    });
    const rotulo = w.find('.sgh-selecao__rotulo');
    expect(w.find('[role="combobox"]').attributes('aria-labelledby')).toBe(rotulo.attributes('id'));
    expect(rotulo.classes()).toContain('sgh-visualmente-oculto');
    await w.find('[role="combobox"]').trigger('click');
    await esperar(0);
    document.body
      .querySelector<HTMLElement>('[role="option"]:has([data-valor="bb"])')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(emitidos).toEqual(['bb']);
    w.unmount();
  });
});

describe('SanteDialogo', () => {
  it('abre modal com título e conteúdo', async () => {
    const w = montar(SanteDialogo, {
      props: { titulo: 'Atalhos', visivel: true },
      slots: { default: 'Conteúdo do diálogo' },
    });
    await nextTick();
    await esperar(10);
    const d = document.body.querySelector('[role="dialog"]');
    expect(d?.getAttribute('aria-modal')).toBe('true');
    expect(d?.textContent).toContain('Atalhos');
    expect(d?.textContent).toContain('Conteúdo do diálogo');
    w.unmount();
  });
});
