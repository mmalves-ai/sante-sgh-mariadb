// @vitest-environment jsdom
// Decisão 53: a central de integrações externas. O cliente valida pelo contrato e manda CSRF e Idempotency-Key; os
// textos cobrem toda situação e área do contrato, sem chave técnica nem o sistema anterior; a tela mostra o selo
// Simulador/Real, o aviso para passar a definição do fornecedor à equipe de desenvolvimento com o que pedir, as
// credenciais só como "definida" (nunca o valor), guarda a credencial com a senha de novo (e limpa o valor), liga o
// real com justificativa e senha e avisa "neutralizado neste ambiente"; sem a permissão de gerir, nada de formulário.
import {
  AREAS_INTEGRACAO_EXTERNA,
  CATALOGO_INTEGRACOES_EXTERNAS,
  type IntegracaoExternaLida,
  type PainelIntegracoesExternas,
  type Sessao,
  SITUACOES_INTEGRACAO_EXTERNA,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import type { App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { definirModoIntegracao, lerIntegracoesExternas } from './api-integracoes-externas.js';
import { mensagensIntegracoesExternas as m } from './i18n-integracoes-externas.js';
import Tela from './telas/IntegracoesExternasTela.vue';

afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
});

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
if (!('ResizeObserver' in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

const SEGREDO = 'valor-secreto-sintetico-123';

function lida(id: string, extra: Partial<IntegracaoExternaLida> = {}): IntegracaoExternaLida {
  const e = CATALOGO_INTEGRACOES_EXTERNAS.find((x) => x.id === id)!;
  return {
    id,
    modo: 'simulador',
    situacao: 'simulador',
    parametros: {},
    credenciais: e.camposCredencial.map((c, i) => ({ campo: c.id, definida: i === 0 })),
    faltam: [],
    versao: null,
    alteradoEm: null,
    alteradoPor: null,
    ultimaFalhaEm: null,
    ultimaFalha: null,
    ...extra,
  };
}

function painel(extra: Partial<IntegracaoExternaLida> = {}): PainelIntegracoesExternas {
  return {
    producao: false,
    cofreDisponivel: true,
    integracoes: CATALOGO_INTEGRACOES_EXTERNAS.map((e) =>
      lida(e.id, e.id === 'operadora-tiss-webservice' ? extra : {}),
    ),
  };
}

function responder(...corpos: unknown[]) {
  let i = 0;
  const f = vi.fn(
    async () => new Response(JSON.stringify(corpos[Math.min(i++, corpos.length - 1)]), { status: 200 }),
  );
  vi.stubGlobal('fetch', f);
  return f;
}

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

async function montar(permissoes = ['config.integracaoExterna.ler', 'config.integracaoExterna.gerir']) {
  definirSessaoDaTela({ permissoes } as unknown as Sessao);
  const w = mount(Tela, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) },
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
    },
  });
  await flushPromises();
  return w;
}

const corpoDe = (f: ReturnType<typeof responder>, n: number) => {
  const [url, init] = f.mock.calls[n] as unknown as [string, RequestInit];
  return {
    url,
    corpo: JSON.parse(String(init.body)) as Record<string, unknown>,
    h: init.headers as Record<string, string>,
  };
};

describe('integrações externas (cliente)', () => {
  it('o painel é validado pelo contrato; fora dele, recusa', async () => {
    responder(painel());
    expect((await lerIntegracoesExternas()).integracoes).toHaveLength(CATALOGO_INTEGRACOES_EXTERNAS.length);
    responder({ ...painel(), integracoes: [{ ...lida('pix'), situacao: 'outra' }] });
    await expect(lerIntegracoesExternas()).rejects.toThrow();
  });

  it('o modo vai com CSRF, Idempotency-Key e o corpo do contrato', async () => {
    const f = responder({ integracao: lida('pix', { modo: 'real' }), neutralizado: true });
    const r = await definirModoIntegracao({
      integracao: 'pix',
      modo: 'real',
      justificativa: 'ensaio sintético do real',
      senha: 'x',
    });
    expect(r.neutralizado).toBe(true);
    const c = corpoDe(f, 0);
    expect(c.url).toBe('/api/administracao/integracoes-externas/modo');
    expect(c.h['idempotency-key']).toMatch(/^web-integracao-externa-/);
    expect('x-csrf' in c.h).toBe(true);
  });
});

describe('textos das integrações externas', () => {
  it('toda situação e área do contrato tem texto', () => {
    for (const s of SITUACOES_INTEGRACAO_EXTERNA) expect(m.selos[s]).toBeTruthy();
    for (const a of AREAS_INTEGRACAO_EXTERNA) expect(m.areas[a]).toBeTruthy();
  });

  it('nenhum texto cita o sistema anterior nem a chave técnica da permissão', () => {
    expect(
      textos(m).filter(([, t]) => /spdata|legado|sistema (atual|antigo|anterior)|config\./i.test(t)),
    ).toEqual([]);
  });

  it('as chaves estão registradas nas mensagens da aplicação', () => {
    expect((mensagensWeb as unknown as { integracoesExternas: unknown }).integracoesExternas).toBe(m);
  });
});

describe('tela das integrações externas', () => {
  it('lista todas com o selo, o aviso do fornecedor com o que pedir e a credencial só como definida', async () => {
    responder(painel());
    const w = await montar();
    expect(w.findAll('[data-testid^="selo-"]')).toHaveLength(CATALOGO_INTEGRACOES_EXTERNAS.length);
    expect(w.get('[data-testid="selo-pix"]').text()).toBe('Simulador');
    expect(w.get('[data-testid="externas-ambiente"]').text()).toContain('não é produção');
    const tiss = CATALOGO_INTEGRACOES_EXTERNAS.find((e) => e.id === 'operadora-tiss-webservice')!;
    const aviso = w.get('[data-testid="fornecedor-operadora-tiss-webservice"]');
    expect(aviso.text()).toContain('Passe a definição à equipe de desenvolvimento');
    for (const item of tiss.oQuePedirAoFornecedor) expect(aviso.text()).toContain(item);
    for (const e of CATALOGO_INTEGRACOES_EXTERNAS)
      expect(w.find(`[data-testid="fornecedor-${e.id}"]`).exists()).toBe(e.dependeDefinicaoFornecedor);
    const [primeira, segunda] = tiss.camposCredencial;
    expect(w.get(`[data-testid="credencial-operadora-tiss-webservice-${primeira!.id}"]`).text()).toBe(
      'Definida',
    );
    expect(w.get(`[data-testid="credencial-operadora-tiss-webservice-${segunda!.id}"]`).text()).toBe(
      'Não definida',
    );
    expect(w.text()).not.toMatch(/spdata|legado/i);
    w.unmount();
  });

  it('guarda a credencial com a senha de novo, sem deixar o valor na tela', async () => {
    const f = responder(
      painel(),
      { integracao: lida('operadora-tiss-webservice'), neutralizado: false },
      painel(),
    );
    const w = await montar();
    await w.get('[data-testid="configurar-operadora-tiss-webservice"]').trigger('click');
    await w.get('[data-testid="externas-credencial-valor"]').setValue(SEGREDO);
    await w.get('[data-testid="externas-credencial-senha"]').setValue('Sintetico#2026');
    await w
      .get('[data-testid="externas-guardar-credencial"]')
      .element.closest('form')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    const c = corpoDe(f, 1);
    expect(c.url).toBe('/api/administracao/integracoes-externas/credencial');
    expect(c.corpo).toMatchObject({
      integracao: 'operadora-tiss-webservice',
      valor: SEGREDO,
      senha: 'Sintetico#2026',
    });
    expect(w.get('[data-testid="externas-gravado"]').text()).toContain('guardada no cofre');
    expect((w.get('[data-testid="externas-credencial-valor"]').element as HTMLInputElement).value).toBe('');
    expect(w.html()).not.toContain(SEGREDO);
    w.unmount();
  });

  it('ligar o real com justificativa e senha avisa "neutralizado neste ambiente"', async () => {
    const real = { modo: 'real' as const, situacao: 'real-neutralizado' as const };
    const f = responder(
      painel(),
      { integracao: lida('operadora-tiss-webservice', real), neutralizado: true },
      painel(real),
    );
    const w = await montar();
    await w.get('[data-testid="configurar-operadora-tiss-webservice"]').trigger('click');
    await w.get('[data-testid="externas-modo-real"]').setValue(true);
    await w
      .get(
        '[data-testid="externas-modo-justificativa"] textarea, [data-testid="externas-modo-justificativa"] input',
      )
      .setValue('ensaio sintético do real');
    await w.get('[data-testid="externas-modo-senha"]').setValue('Sintetico#2026');
    await w
      .get('[data-testid="externas-gravar-modo"]')
      .element.closest('form')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(corpoDe(f, 1).corpo).toMatchObject({ integracao: 'operadora-tiss-webservice', modo: 'real' });
    expect(w.get('[data-testid="externas-neutralizado"]').text()).toContain('neutralizado neste ambiente');
    expect(w.get('[data-testid="selo-operadora-tiss-webservice"]').text()).toContain('neutralizado');
    w.unmount();
  });

  it('sem a permissão de gerir, só a leitura', async () => {
    responder(painel());
    const w = await montar(['config.integracaoExterna.ler']);
    expect(w.find('[data-testid="externas-sem-permissao"]').exists()).toBe(true);
    expect(w.find('[data-testid^="configurar-"]').exists()).toBe(false);
    w.unmount();
  });
});
