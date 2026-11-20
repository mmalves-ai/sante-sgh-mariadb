import { urnProblema, type Problema } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { esperar, montar } from '../testes/montar.js';
import SanteAvisoColisao from './SanteAvisoColisao.vue';

const conflito: Problema = {
  type: urnProblema('conflito-de-versao'),
  title: 'Registro alterado',
  status: 409,
  correlacao: 'corr-sintetica-1',
  alteradoPor: 'legado',
  alteracoes: [
    { campo: 'observacao', rotulo: 'Observação', lido: 'Retorno em 7 dias', atual: 'Retorno em 10 dias' },
    { campo: 'telefone', rotulo: 'Telefone', lido: null, atual: '(00) 0000-0000' },
  ],
};

describe('SanteAvisoColisao (regra 9)', () => {
  it('mostra o que mudou desde a leitura e em que sistema', () => {
    const w = montar(SanteAvisoColisao, { props: { problema: conflito } });
    expect(w.attributes('role')).toBe('alert');
    expect(w.text()).toContain('Registro alterado no outro sistema desde a leitura');
    expect(w.text()).toContain('O que você digitou foi mantido');
    const linhas = w.findAll('tbody tr').map((l) => l.text());
    expect(linhas[0]).toContain('Retorno em 7 dias');
    expect(linhas[0]).toContain('Retorno em 10 dias');
    expect(linhas[1]).toContain('(vazio)');
    w.unmount();
  });

  it('colisão com outra pessoa no novo muda o título', () => {
    const w = montar(SanteAvisoColisao, { props: { problema: { ...conflito, alteradoPor: 'novo' } } });
    expect(w.text()).toContain('alterado por outra pessoa');
    w.unmount();
  });

  it('"rever e salvar de novo" só emite; nunca sobrescreve sozinho', async () => {
    const w = montar(SanteAvisoColisao, { props: { problema: conflito } });
    await w.find('[data-testid="rever"]').trigger('click');
    expect(w.emitted('rever')).toHaveLength(1);
    expect(w.emitted('descartar')).toBeUndefined();
    w.unmount();
  });

  it('descartar o digitado exige confirmação', async () => {
    const w = montar(SanteAvisoColisao, { props: { problema: conflito } });
    await w.find('[data-testid="descartar"]').trigger('click');
    expect(w.emitted('descartar')).toBeUndefined();
    await esperar(10);
    const confirmar = [...document.body.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Confirmar'),
    );
    confirmar!.click();
    await esperar(10);
    expect(w.emitted('descartar')).toHaveLength(1);
    w.unmount();
  });

  it('recusa Problem Details de outro tipo', () => {
    expect(() =>
      montar(SanteAvisoColisao, { props: { problema: { type: urnProblema('sem-permissao') } } }),
    ).toThrow(/conflito-de-versao/);
  });
});

describe('SanteAvisoColisao: ids únicos', () => {
  it('dois avisos na mesma tela não repetem o id do título', () => {
    const Dois = defineComponent(
      () => () =>
        h('div', [
          h(SanteAvisoColisao, { problema: conflito }),
          h(SanteAvisoColisao, { problema: conflito }),
        ]),
    );
    const w = montar(Dois);
    const avisos = w.findAll('[data-testid="aviso-colisao"]');
    const ids = avisos.map((x) => x.attributes('aria-labelledby'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    avisos.forEach((x, i) => expect(x.find('h2').attributes('id')).toBe(ids[i]));
    w.unmount();
  });
});
