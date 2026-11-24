// Família acesso-ligacao: a entrada por e-mail na web (chamadas da API, recusas do segundo fator por e-mail e a tela do
// "Esqueci a senha" da plataforma).
import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
  escolherMetodoSegundoFator,
  pedirRecuperacaoPlataforma,
  usarRecuperacaoPlataforma,
} from './api-acesso-email.js';
import { mensagensAcessoEmail } from './i18n-acesso-email.js';
import { textoRecusaSegundoFator } from './identidade-tela.js';
import RecuperarSenhaPlataformaTela from './telas/RecuperarSenhaPlataformaTela.vue';

const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

describe('API da entrada por e-mail', () => {
  it('pede o link pelo e-mail e usa o token', async () => {
    const buscar = vi.fn().mockResolvedValueOnce(resposta(202, { mensagem: 'Se a conta existir...' }));
    expect(await pedirRecuperacaoPlataforma('a@b.invalid', buscar)).toBe('Se a conta existir...');
    expect(buscar.mock.calls[0]?.[0]).toBe('/api/sessao/plataforma/recuperacao');
    const usar = vi
      .fn()
      .mockResolvedValueOnce(resposta(200, { senhaProvisoria: 'X', trocaObrigatoria: true, login: 'adm' }));
    expect((await usarRecuperacaoPlataforma('t'.repeat(43), usar)).login).toBe('adm');
  });

  it('a escolha do método manda o CSRF; a recusa vira erro', async () => {
    const buscar = vi.fn().mockResolvedValueOnce(resposta(200, { metodo: 'email', emailDisponivel: true }));
    expect((await escolherMetodoSegundoFator('email', buscar)).metodo).toBe('email');
    const init = buscar.mock.calls[0]?.[1] as RequestInit;
    expect(Object.keys(init.headers as Record<string, string>)).toContain('x-csrf');
    const recusa = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ title: 'x', status: 409, codigo: 'metodo-nao-escolhido' }), {
        status: 409,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
    await expect(escolherMetodoSegundoFator('email', recusa)).rejects.toMatchObject({ status: 409 });
  });

  it('as recusas do código no e-mail têm texto próprio', () => {
    expect(textoRecusaSegundoFator('segundo-fator-email')).toBe('acessoEmail.codigoEnviado');
    expect(textoRecusaSegundoFator('segundo-fator-email-esgotado')).toBe('acessoEmail.codigoEsgotado');
    expect(textoRecusaSegundoFator('segundo-fator-sem-email')).toBe('acessoEmail.semEmail');
  });
});

describe('tela do "Esqueci a senha" da plataforma', () => {
  it('pede pelo e-mail e mostra a resposta genérica', async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(resposta(202, { mensagem: 'Resposta genérica' })) as typeof fetch;
    const roteador = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/plataforma/recuperar-senha',
          name: 'plataforma.recuperar-senha',
          component: RecuperarSenhaPlataformaTela,
        },
        { path: '/entrar', component: { template: '<p/>' } },
      ],
    });
    await roteador.push('/plataforma/recuperar-senha');
    const i18n = createI18n({
      legacy: false,
      locale: 'pt-BR',
      messages: { 'pt-BR': { acessoEmail: mensagensAcessoEmail, entrar: { indisponivelServico: 'x' } } },
    });
    const w = mount(RecuperarSenhaPlataformaTela, { global: { plugins: [roteador, i18n] } });
    await w.get('[data-testid="plataforma-recuperar-email"]').setValue('adm@exemplo.invalid');
    await w.get('[data-testid="form-plataforma-recuperar"]').trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="plataforma-recuperar-mensagem"]').text()).toContain('Resposta genérica');
    globalThis.fetch = fetchOriginal;
  });
});
