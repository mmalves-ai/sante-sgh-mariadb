import { describe, expect, it } from 'vitest';
import { CORPUS_CP1252, CORPUS_CP1252_RECUSADOS, esquemaTextoCp1252 } from '@sgh/contratos';
import { nextTick, ref } from 'vue';
import { montar } from '../testes/montar.js';
import SanteCampoTexto from './SanteCampoTexto.vue';

function campo(inicial: string, maxBytes = 40, multilinha = false) {
  const valor = ref(inicial);
  const w = montar(SanteCampoTexto, {
    props: {
      rotulo: 'Observação',
      maxBytes,
      multilinha,
      modelValue: valor.value,
      'onUpdate:modelValue': (v: string) => {
        valor.value = v;
        void w.setProps({ modelValue: v });
      },
    },
  });
  return { w, valor };
}

describe('SanteCampoTexto (regra 6: CP1252 na tela, mesmo validador do servidor)', () => {
  it('rótulo ligado ao campo e contador de bytes', () => {
    const { w } = campo('Conceição');
    const input = w.find('input');
    expect(w.find('label').attributes('for')).toBe(input.attributes('id'));
    expect(w.text()).toContain('9 de 40 caracteres');
    w.unmount();
  });

  it('emoji colado mostra mensagem clara e marca o campo inválido', async () => {
    const { w } = campo('');
    await w.find('input').setValue('dor 😀');
    await nextTick();
    expect(w.find('[data-testid="erro-cp1252"]').text()).toMatch(/^Emoji não pode ser gravado/);
    expect(w.find('input').attributes('aria-invalid')).toBe('true');
    w.unmount();
  });

  it('propõe a troca de "≥" por ">=" e aplica só quando o usuário pede', async () => {
    const { w, valor } = campo('PA ≥ 140');
    expect(w.text()).toContain('Troca proposta: PA >= 140');
    expect(valor.value).toBe('PA ≥ 140');
    await w.find('[data-testid="aplicar-troca"]').trigger('click');
    await nextTick();
    expect(valor.value).toBe('PA >= 140');
    expect(w.find('[data-testid="erro-cp1252"]').exists()).toBe(false);
    w.unmount();
  });

  it('espaço especial colado vira espaço comum; aspas curvas ficam', async () => {
    const { w, valor } = campo('');
    await w.find('input').setValue('“dor” torácica');
    expect(valor.value).toBe('“dor” torácica');
    w.unmount();
  });

  it('limite = tamanho da coluna legada em bytes', async () => {
    const { w } = campo('', 5, true);
    await w.find('textarea').setValue('abcdef');
    await nextTick();
    expect(w.find('[data-testid="erro-cp1252"]').text()).toBe(
      'O texto tem 6 caracteres; o limite deste campo é 5.',
    );
    w.unmount();
  });
});

describe('SanteCampoTexto: corpus compartilhado, mesmo resultado do schema do servidor', () => {
  it.each(CORPUS_CP1252)('"%s": a tela aceita/recusa igual ao esquemaTextoCp1252', (texto) => {
    const { w } = campo(texto, 200);
    const servidor = esquemaTextoCp1252({ maxBytes: 200 }).safeParse(texto);
    const erroNaTela = w.find('[data-testid="erro-cp1252"]');
    expect(erroNaTela.exists()).toBe(!servidor.success);
    if (!servidor.success) expect(erroNaTela.text()).toBe(servidor.error.issues[0]?.message);
    expect(servidor.success).toBe(!CORPUS_CP1252_RECUSADOS.includes(texto));
    w.unmount();
  });

  it('as mensagens da tela vêm do vue-i18n (códigos), iguais às do servidor', () => {
    for (const texto of ['dor 😀', 'PA ≥ 140', 'a\u0007b', 'SpO₂ ≥ 2']) {
      const { w } = campo(texto, 60);
      const servidor = esquemaTextoCp1252({ maxBytes: 60 }).safeParse(texto);
      expect(w.find('[data-testid="erro-cp1252"]').text()).toBe(servidor.error?.issues[0]?.message);
      w.unmount();
    }
  });
});
