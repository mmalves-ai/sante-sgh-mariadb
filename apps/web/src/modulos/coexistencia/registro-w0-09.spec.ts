// @vitest-environment jsdom
// W0-09 (D-RETRO-REGISTRO-F6): o registro do fim e da retrocompatibilidade gravado pela tela. No modo 'tela', gravar
// a versão nova exige um objeto JSON, o motivo e a senha; voltar ao registro versionado manda conteúdo null; o histórico
// mostra as versões. No modo 'excecao', não há botão de gravação. Dados SINTÉTICOS.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import RegistroCoexEditor from './componentes/RegistroCoexEditor.vue';

vi.mock('../../casca/sessao/pode.js', () => ({ pode: () => true }));

if (!window.matchMedia) {
  window.matchMedia = (consulta: string) =>
    ({
      matches: false,
      media: consulta,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

interface Pedido {
  url: string;
  corpo: Record<string, unknown> | null;
}
function simular(responder: (p: Pedido) => { status?: number; corpo: unknown }): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const p: Pedido = {
        url: String(url),
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      pedidos.push(p);
      const r = responder(p);
      return Response.json(r.corpo, {
        status: r.status ?? 200,
        headers: r.status && r.status >= 400 ? { 'content-type': 'application/problem+json' } : {},
      });
    }),
  );
  return pedidos;
}

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
function montar(c: Component, props: Record<string, unknown>) {
  return mount(c as never, {
    attachTo: document.body,
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
    },
  });
}
const preencher = (testid: string, valor: string) => {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-testid="${testid}"]`)!;
  el.value = valor;
  el.dispatchEvent(new Event('input'));
};
const enviar = async () => {
  document
    .querySelector<HTMLFormElement>('[data-testid="ciclo-dialogo"]')!
    .dispatchEvent(new Event('submit'));
  await flushPromises();
};
const texto = (testid: string) => document.querySelector(`[data-testid="${testid}"]`)?.textContent ?? '';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const registro = (modo: 'tela' | 'excecao', fonte: 'tela' | 'arquivo') => ({
  tipo: 'fim',
  modo,
  fonte,
  versaoVigente: fonte === 'tela' ? 2 : null,
  conteudo: fonte === 'tela' ? { estabelecimento: 'pc', fim: null } : null,
  historico: [
    {
      versao: 2,
      motivo: 'ata assinada',
      gravadoPor: 'ANA',
      gravadoEm: '2026-11-10T12:00:00Z',
      retornoAoArquivo: false,
    },
    {
      versao: 1,
      motivo: 'volta ao versionado',
      gravadoPor: 'ANA',
      gravadoEm: '2026-11-09T12:00:00Z',
      retornoAoArquivo: true,
    },
  ],
});
const clicar = async (testid: string) => {
  document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!.click();
  await flushPromises();
};

describe('registro do fim e da retrocompatibilidade pela tela (W0-09)', () => {
  it('grava a versão nova com JSON, motivo e senha, e recusa JSON inválido sem chamar o servidor', async () => {
    const pedidos = simular((p) => ({
      corpo: p.corpo ? registro('tela', 'tela') : registro('tela', 'arquivo'),
    }));
    montar(RegistroCoexEditor, { tipo: 'fim' });
    await flushPromises();
    expect(texto('registro-coex-fonte')).toContain('registro versionado');
    expect(texto('registro-coex-historico')).toContain('ata assinada');
    expect(document.querySelector('[data-testid="registro-coex-voltar"]')).toBeNull();
    await clicar('registro-coex-gravar');
    preencher('registro-coex-conteudo', '[1, 2]');
    preencher('ciclo-motivo', 'fim aprovado em ata');
    preencher('ciclo-senha', 'segredo');
    await enviar();
    expect(texto('ciclo-falta')).toContain('JSON');
    expect(pedidos).toHaveLength(1);
    preencher('registro-coex-conteudo', '{"estabelecimento":"pc"}');
    preencher('ciclo-senha', 'segredo');
    await enviar();
    expect(pedidos[1]?.url).toBe('/api/administracao/coexistencia/registros/fim');
    expect(pedidos[1]?.corpo).toEqual({
      conteudo: { estabelecimento: 'pc' },
      motivo: 'fim aprovado em ata',
      senha: 'segredo',
    });
    await flushPromises();
    expect(texto('registro-coex-aviso')).toContain('gravada');
  });

  it('voltar a valer o registro versionado manda conteúdo null com motivo e senha', async () => {
    const pedidos = simular(() => ({ corpo: registro('tela', 'tela') }));
    montar(RegistroCoexEditor, { tipo: 'fim' });
    await flushPromises();
    expect(texto('registro-coex-fonte')).toContain('versão 2');
    await clicar('registro-coex-voltar');
    preencher('ciclo-motivo', 'ata anulada');
    preencher('ciclo-senha', 'segredo');
    await enviar();
    expect(pedidos.find((p) => p.corpo)?.corpo).toEqual({
      conteudo: null,
      motivo: 'ata anulada',
      senha: 'segredo',
    });
  });

  it('no modo exceção não há botão de gravação e a tela explica o caminho', async () => {
    simular(() => ({ corpo: registro('excecao', 'arquivo') }));
    montar(RegistroCoexEditor, { tipo: 'fim' });
    await flushPromises();
    expect(texto('registro-coex-modo')).toContain('exceção');
    expect(document.querySelector('[data-testid="registro-coex-gravar"]')).toBeNull();
  });
});
