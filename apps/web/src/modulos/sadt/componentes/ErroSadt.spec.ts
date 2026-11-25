// 05-SADT linha 7 (F3.5): o erro do diagnóstico. A recusa de negócio conhecida e o 503 com o código "sem-banco-cliente"
// (a função precisa do banco do cliente) viram o aviso próprio (recusa-sadt); o resto, inclusive o 503 "indisponivel"
// sem esse código (gerador de PDF fora do ar), a mensagem geral com a correlação.
import { urnProblema } from '@sgh/contratos';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import { mensagensSadt } from '../i18n.js';
import ErroSadt from './ErroSadt.vue';

const montar = (erro: unknown) =>
  mount(ErroSadt, {
    props: { erro },
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'pt-BR',
          missingWarn: false,
          fallbackWarn: false,
          messages: { 'pt-BR': { erros: mensagensWeb.erros, sadt: mensagensSadt } },
        }),
      ],
    },
  });

const problema = (tipo: Parameters<typeof urnProblema>[0], status: number, codigo?: string) =>
  new ErroApi(
    {
      type: urnProblema(tipo),
      title: 'x',
      status,
      correlacao: 'c-1',
      ...(codigo ? { codigo } : {}),
    } as never,
    status,
  );

describe('ErroSadt', () => {
  it('o 503 com o código "sem-banco-cliente" vira o aviso de que a função precisa do banco do cliente', () => {
    const w = montar(problema('indisponivel', 503, 'sem-banco-cliente'));
    expect(w.find('[data-testid="recusa-sadt"]').exists()).toBe(true);
    expect(w.text()).toContain('precisa do banco do cliente');
  });

  it('o 503 "indisponivel" da emissão do PDF (sem código) continua na mensagem geral com a correlação', () => {
    const w = montar(problema('indisponivel', 503));
    expect(w.find('[data-testid="recusa-sadt"]').exists()).toBe(false);
    expect(w.find('[data-testid="mensagem-erro"]').exists()).toBe(true);
    expect(w.text()).not.toContain('precisa do banco do cliente');
    expect(w.text()).toContain('Código para o suporte: c-1');
  });

  it('a recusa de negócio conhecida mostra o texto da aplicação', () => {
    const w = montar(problema('recusa-de-negocio', 422, 'pedido-suspenso'));
    expect(w.find('[data-testid="recusa-sadt"]').text()).toContain('suspenso');
  });

  it('outro erro de servidor não vira aviso de banco: mensagem geral', () => {
    const w = montar(problema('erro-interno', 500));
    expect(w.find('[data-testid="recusa-sadt"]').exists()).toBe(false);
    expect(w.find('[data-testid="mensagem-erro"]').exists()).toBe(true);
  });
});
