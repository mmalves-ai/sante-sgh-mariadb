import { describe, expect, it } from 'vitest';
import { esperar, montar } from '../testes/montar.js';
import SanteBotao from './SanteBotao.vue';

describe('SanteBotao (regra 3: destrutivo com contorno e confirmação)', () => {
  it('primário aciona direto', async () => {
    const w = montar(SanteBotao, { props: { rotulo: 'Salvar' } });
    await w.find('button').trigger('click');
    expect(w.emitted('acionar')).toHaveLength(1);
    w.unmount();
  });

  it('destrutivo sem pergunta de confirmação é recusado', () => {
    expect(() => montar(SanteBotao, { props: { rotulo: 'Excluir', variante: 'destrutivo' } })).toThrow(
      /confirmação/,
    );
  });

  it('destrutivo usa contorno e só aciona depois de confirmar', async () => {
    const w = montar(SanteBotao, {
      props: { rotulo: 'Excluir', variante: 'destrutivo', confirmacao: 'Excluir este item?' },
    });
    const botao = w.find('button');
    expect(botao.classes().join(' ')).toMatch(/outlined/);
    await botao.trigger('click');
    expect(w.emitted('acionar')).toBeUndefined();
    await esperar(10);
    const dialogo = document.body.querySelector('[data-testid="confirmacao"]');
    expect(dialogo?.textContent).toContain('Excluir este item?');
    const confirmar = [...document.body.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Confirmar'),
    );
    confirmar!.click();
    await esperar(10);
    expect(w.emitted('acionar')).toHaveLength(1);
    w.unmount();
  });
});
