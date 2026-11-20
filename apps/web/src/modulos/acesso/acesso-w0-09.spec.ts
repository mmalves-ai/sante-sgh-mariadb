// @vitest-environment jsdom
// W0-09: telas de acesso com o ciclo de vida. Mapa: toda decisão (inclusive voltar a 'proposta') abre o diálogo com a
// prévia de quantos usuários perdem o acesso antes de confirmar, o motivo obrigatório e a senha; as decisões
// anteriores aparecem. Perfil concedido: Alterar a vigência e o motivo com justificativa e senha, com o histórico.
// Política do segundo fator: Alterar o alvo e o prazo da linha vigente com motivo e senha. Dados SINTÉTICOS.
import type {
  AlteracaoPerfilTela,
  DecisaoMapaTela,
  MapaGestaoTela,
  PerfilConcedidoTela,
  Politica2fa,
  PreviaMapaTela,
  Sessao,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import PerfilAlteracaoDialogo from './componentes/PerfilAlteracaoDialogo.vue';
import PerfilRevogacaoDialogo from './componentes/PerfilRevogacaoDialogo.vue';
import PerfisPermissoesTela from './telas/PerfisPermissoesTela.vue';
import PoliticaSegundoFatorTela from './telas/PoliticaSegundoFatorTela.vue';

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
  metodo: string;
  url: string;
  corpo: Record<string, unknown> | null;
}
function simular(responder: (p: Pedido) => unknown): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const p: Pedido = {
        metodo: init?.method ?? 'GET',
        url: String(url),
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      pedidos.push(p);
      return Response.json(responder(p) ?? []);
    }),
  );
  return pedidos;
}

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
async function montar(tela: Component, props: Record<string, unknown> = {}) {
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:caminho(.*)*', component: { template: '<div />' } }],
  });
  await roteador.push('/');
  return mount(tela as never, {
    attachTo: document.body,
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        roteador,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
}
const preencher = (testid: string, valor: string) => {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-testid="${testid}"]`)!;
  el.value = valor;
  el.dispatchEvent(new Event('input'));
};
const enviar = async (testid: string) => {
  document.querySelector<HTMLFormElement>(`[data-testid="${testid}"]`)!.dispatchEvent(new Event('submit'));
  await flushPromises();
};
const texto = (testid: string) => document.querySelector(`[data-testid="${testid}"]`)?.textContent ?? '';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  definirSessaoDaTela(null);
});

describe('mapa de permissões (W0-09)', () => {
  const mapa: MapaGestaoTela = {
    grupoPerfil: [
      {
        id: 'M1',
        tipo: 'grupo-perfil',
        grupo: 'FATURA',
        perfil: 'faturista',
        permissao: null,
        origem: 'proposta-automatica',
        situacao: 'aprovada',
        aprovadoPor: 'SINT.GESTOR',
        aprovadoEm: '2026-11-10T10:00:00.000Z',
      },
    ],
    perfilPermissao: [],
    perfis: ['faturista'],
  };
  const previa: PreviaMapaTela = {
    situacaoAtual: 'aprovada',
    situacao: 'proposta',
    exigeMotivo: true,
    perdem: 3,
    amostra: ['SINT.ANA', 'SINT.BIA', 'SINT.CAU'],
    limitado: false,
    doCatalogo: false,
  };
  const decisao: DecisaoMapaTela = {
    id: 'D1',
    situacaoAntes: 'proposta',
    aprovadoPorAntes: null,
    situacao: 'aprovada',
    motivo: 'revisão da área',
    usuariosAfetados: 0,
    decididoPor: 'SINT.GESTOR',
    decididoEm: '2026-11-10T10:00:00.000Z',
  };

  it('voltar a proposta mostra quantos perdem antes de confirmar e exige motivo e senha', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/mapa/M1/decisoes')) return [decisao];
      if (p.url.endsWith('/mapa')) return mapa;
      if (p.url.endsWith('/mapa/previa')) return previa;
      if (p.url.endsWith('/mapa/decidir'))
        return { operacao: 'mapa', invalidado: 'estabelecimento', destino: 'memoria', id: 'M1' };
      return undefined;
    });
    const w = await montar(PerfisPermissoesTela);
    await flushPromises();
    await w.get('[data-testid="aba-mapa"]').trigger('click');
    await w.get('[data-testid="voltar-FATURA-faturista"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.url.endsWith('/mapa/previa'))?.corpo).toEqual({
      chave: { tipo: 'grupo-perfil', grupo: 'FATURA', perfil: 'faturista' },
      situacao: 'proposta',
    });
    expect(texto('mapa-previa-perdem')).toContain('3 usuário(s)');
    expect(texto('mapa-previa-amostra')).toContain('SINT.BIA');
    expect(texto('mapa-decisoes')).toContain('revisão da área');

    await enviar('mapa-decisao');
    expect(texto('mapa-decisao-falta')).toContain('motivo');
    expect(pedidos.some((p) => p.url.endsWith('/mapa/decidir'))).toBe(false);

    preencher('mapa-decisao-motivo', 'perfil errado para o grupo');
    preencher('mapa-decisao-senha', 'senha-sintetica');
    await enviar('mapa-decisao');
    expect(pedidos.find((p) => p.url.endsWith('/mapa/decidir'))?.corpo).toEqual({
      chave: { tipo: 'grupo-perfil', grupo: 'FATURA', perfil: 'faturista' },
      situacao: 'proposta',
      motivo: 'perfil errado para o grupo',
      senha: 'senha-sintetica',
    });
    expect(w.get('[data-testid="perfis-aviso"]').text()).toContain('Decisão gravada');
    // recarregou o mapa depois da decisão
    expect(pedidos.filter((p) => p.url.endsWith('/mapa') && p.metodo === 'GET').length).toBe(2);
  });
});

describe('perfil concedido (W0-09)', () => {
  const concessao: PerfilConcedidoTela = {
    id: '77',
    perfil: 'faturista',
    inicio: '2026-11-01T10:00:00.000Z',
    fim: '2026-12-31T10:00:00.000Z',
    motivo: 'cobertura de férias',
    concedidoPor: 'SINT.GESTOR',
    revogadoEm: null,
    revogadoPor: null,
    vigente: true,
    alteracoes: 1,
  };
  const alteracao: AlteracaoPerfilTela = {
    id: 'A1',
    inicioAntes: '2026-11-01T10:00:00.000Z',
    fimAntes: '2026-11-30T10:00:00.000Z',
    motivoAntes: 'férias',
    inicio: '2026-11-01T10:00:00.000Z',
    fim: '2026-12-31T10:00:00.000Z',
    motivo: 'cobertura de férias',
    justificativa: 'férias prorrogadas',
    alteradoPor: 'SINT.GESTOR',
    alteradoEm: '2026-11-15T10:00:00.000Z',
  };

  it('Alterar leva vigência, motivo, justificativa e senha; o histórico mostra o anterior', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/perfis/77/alteracoes')) return [alteracao];
      if (p.url.endsWith('/perfis/77/alteracao'))
        return { operacao: 'acesso.alterarPerfil', invalidado: 'usuario', destino: 'memoria' };
      return undefined;
    });
    const w = await montar(PerfilAlteracaoDialogo, { concessao, visivel: true });
    await flushPromises();
    expect(texto('perfil-alteracoes')).toContain('férias prorrogadas');
    expect(texto('perfil-alteracoes')).toContain('(férias)');

    preencher('perfil-alteracao-justificativa', 'ok');
    await enviar('perfil-alteracao');
    expect(texto('perfil-alteracao-falta')).toContain('motivo');
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    preencher('perfil-alteracao-fim', '2027-01-15T18:00');
    preencher('perfil-alteracao-justificativa', 'nova escala do faturamento');
    preencher('perfil-alteracao-senha', 'senha-sintetica');
    await enviar('perfil-alteracao');
    const alt = pedidos.find((p) => p.url.endsWith('/perfis/77/alteracao'));
    expect(alt?.corpo).toMatchObject({
      inicio: '2026-11-01T10:00:00.000Z',
      fim: new Date('2027-01-15T18:00').toISOString(),
      motivo: 'cobertura de férias',
      justificativa: 'nova escala do faturamento',
      senha: 'senha-sintetica',
    });
    expect(w.emitted('alterado')).toHaveLength(1);
  });

  it('Revogar exige motivo e senha no diálogo e leva os dois à rota', async () => {
    const pedidos = simular((p) =>
      p.url.endsWith('/perfis/77/revogar')
        ? { operacao: 'acesso.revogarPerfil', invalidado: 'usuario', destino: 'memoria' }
        : undefined,
    );
    const w = await montar(PerfilRevogacaoDialogo, { concessao, visivel: true });
    await flushPromises();
    preencher('perfil-revogacao-senha', 'senha-sintetica');
    await enviar('perfil-revogacao');
    expect(texto('perfil-revogacao-falta')).toContain('motivo');
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    preencher('perfil-revogacao-motivo', ' fim da cobertura de férias ');
    preencher('perfil-revogacao-senha', 'senha-sintetica');
    await enviar('perfil-revogacao');
    expect(pedidos.find((p) => p.url.endsWith('/perfis/77/revogar'))?.corpo).toEqual({
      motivo: 'fim da cobertura de férias',
      senha: 'senha-sintetica',
    });
    expect(w.emitted('revogado')).toHaveLength(1);
  });
});

describe('política do segundo fator (W0-09)', () => {
  const linha = (sobre: Partial<Politica2fa> = {}): Politica2fa => ({
    id: '1',
    estabelecimento: 'pc',
    alvo: 'perfil',
    valor: 'auditor',
    onda: 1,
    inicio: '2026-12-01',
    prazoAdesaoDias: 14,
    ativa: true,
    criadaPor: 'SINT.GESTOR',
    criadaEm: '2026-11-20T10:00:00.000Z',
    encerradaEm: null,
    ...sobre,
  });

  it('Alterar o prazo da linha vigente exige motivo e senha e mostra a anterior encerrada', async () => {
    definirSessaoDaTela({
      permissoes: ['acesso.politica2fa.ler', 'acesso.politica2fa.editar'],
    } as unknown as Sessao);
    let lista = [linha()];
    const pedidos = simular((p) => {
      if (p.url.endsWith('/politica-2fa') && p.metodo === 'GET') return lista;
      if (p.url.endsWith('/usuarios-opcoes')) return { grupos: [], destino: 'memoria' };
      if (p.url.endsWith('/politica-2fa/1/alteracao')) {
        const nova = linha({ id: '2', prazoAdesaoDias: 30 });
        lista = [linha({ ativa: false, encerradaEm: '2026-11-21T10:00:00.000Z' }), nova];
        return nova;
      }
      return undefined;
    });
    const w = await montar(PoliticaSegundoFatorTela);
    await flushPromises();
    await w.get('[data-testid="politica-alterar-1"]').trigger('click');
    await flushPromises();
    preencher('alterar-prazo', '30');
    await enviar('form-politica-alterar');
    expect(texto('alterar-falta')).not.toBe('');
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    preencher('alterar-motivo', 'adesão mais lenta na farmácia');
    preencher('alterar-senha', 'senha-sintetica');
    await enviar('form-politica-alterar');
    expect(pedidos.find((p) => p.url.endsWith('/politica-2fa/1/alteracao'))?.corpo).toEqual({
      dados: {
        alvo: 'perfil',
        valor: 'auditor',
        prazoAdesaoDias: 30,
        motivo: 'adesão mais lenta na farmácia',
      },
      senha: 'senha-sintetica',
    });
    expect(w.get('[data-testid="politica-aviso"]').text()).toContain('Linha alterada');
    expect(w.get('[data-testid="politica-linha-1"]').text()).toContain('Encerrada em 21/11/2026');
    expect(w.find('[data-testid="politica-alterar-2"]').exists()).toBe(true);
  });
});
