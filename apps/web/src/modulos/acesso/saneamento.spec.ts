// @vitest-environment jsdom
// Tela do M59-F4 (saneamento dos grupos): as regras de tela (ações por situação, ordem, destino sugerido), a rota com
// a permissão de leitura dos grupos, o painel (só leitura sem acesso.grupo.sanear), a decisão com o simulador do
// antes e depois, a aprovação pela área e a aplicação com a senha, o descarte e a retirada das opções do grupo vazio.
// Dados SINTÉTICOS; o fetch é simulado.
import {
  type ItemSaneamento,
  type PainelSaneamento,
  RECUSAS_SANEAMENTO,
  type Sessao,
  type UsuarioSaneamento,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { criarRoteador } from '../../roteador.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { acoesDoUsuario, chaveRecusaSaneamento, destinoInicial, ordenarUsuarios } from './saneamento-tela.js';
import SaneamentoGruposTela from './telas/SaneamentoGruposTela.vue';

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
  chave: string | null;
}
type Responder = (p: Pedido) => { status: number; corpo: unknown } | undefined;

function simular(responder: Responder): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      const p: Pedido = {
        metodo: init?.method ?? 'GET',
        url: String(url),
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        chave: h['idempotency-key'] ?? null,
      };
      pedidos.push(p);
      const r = responder(p) ?? { status: 404, corpo: { type: 'nao-encontrado', title: 'x', status: 404 } };
      return new Response(JSON.stringify(r.corpo), {
        status: r.status,
        headers: { 'content-type': r.status >= 400 ? 'application/problem+json' : 'application/json' },
      });
    }),
  );
  return pedidos;
}

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
async function montar() {
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:caminho(.*)*', component: { template: '<div />' } }],
  });
  await roteador.push('/administracao/acesso/grupos/saneamento');
  const w = mount(SaneamentoGruposTela as never, {
    attachTo: document.body,
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
  montadas.push(w);
  return w;
}
const montadas: { unmount: () => void }[] = [];

const comPermissoes = (permissoes: string[]) => definirSessaoDaTela({ permissoes } as unknown as Sessao);

afterEach(async () => {
  await flushPromises();
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  definirSessaoDaTela(null);
});

const item = (sobre: Partial<ItemSaneamento> = {}): ItemSaneamento => ({
  id: '11',
  grupoOrigem: 'MASTER',
  login: 'SINT.A',
  idUsuario: 1,
  decisao: 'trocar-grupo',
  grupoDestino: 'RECEPCAO',
  perdasTotal: 4,
  perdasUsadas: 0,
  exigeAprovacao: false,
  situacao: 'proposto',
  motivo: 'função na recepção',
  criadoPor: 'SINT.SANEAR.GESTOR',
  criadoEm: '2026-10-29T10:00:00.000Z',
  aprovacao: null,
  aplicadoEm: null,
  aplicadoPor: null,
  erro: null,
  ...sobre,
});

const usuario = (login: string, sobre: Partial<UsuarioSaneamento> = {}): UsuarioSaneamento => ({
  login,
  idUsuario: 1,
  nome: `USUARIO ${login}`,
  ativo: true,
  bloqueado: false,
  ultimoAcesso: '2026-10-20',
  diasSemAcesso: 9,
  sugestao: { grupo: 'RECEPCAO', cobertas: 3, usadas: 4 },
  item: null,
  ...sobre,
});

const painel = (): PainelSaneamento => ({
  grupos: [
    {
      grupo: 'MASTER',
      existe: true,
      ativo: true,
      usuarios: 3,
      ativos: 2,
      opcoes: 900,
      propostos: 1,
      aprovados: 0,
      aplicados: 0,
      semDecisao: 1,
      inativosNoGrupo: 1,
      dissolvivel: false,
    },
    {
      grupo: 'MASTER_SEM_FINANCEIRO',
      existe: true,
      ativo: true,
      usuarios: 1,
      ativos: 0,
      opcoes: 450,
      propostos: 0,
      aprovados: 0,
      aplicados: 1,
      semDecisao: 0,
      inativosNoGrupo: 1,
      dissolvivel: true,
    },
    {
      grupo: 'MASTER_CONSULTA_FINANCEIRO',
      existe: false,
      ativo: false,
      usuarios: 0,
      ativos: 0,
      opcoes: 0,
      propostos: 0,
      aprovados: 0,
      aplicados: 0,
      semDecisao: 0,
      inativosNoGrupo: 0,
      dissolvivel: false,
    },
  ],
  administradores: { maximo: 3, mantidos: 1, ativosNoMaster: 4, excedido: true },
  destinos: [
    { grupo: 'RECEPCAO', opcoes: 40 },
    { grupo: 'ENFERMAGEM', opcoes: 60 },
  ],
  janelaDias: 180,
});

const BASE = '/api/administracao/acesso/grupos/saneamento';

describe('regras de tela', () => {
  it('ações por situação: decidir, aprovar ou aplicar, descartar; nada sem permissão', () => {
    expect(acoesDoUsuario(usuario('a'), false)).toEqual([]);
    expect(acoesDoUsuario(usuario('a'), true)).toEqual(['decidir']);
    expect(acoesDoUsuario(usuario('a', { item: item() }), true)).toEqual(['aplicar', 'descartar', 'decidir']);
    expect(acoesDoUsuario(usuario('a', { item: item({ exigeAprovacao: true }) }), true)).toEqual([
      'aprovar',
      'descartar',
      'decidir',
    ]);
    expect(acoesDoUsuario(usuario('a', { item: item({ situacao: 'aprovado' }) }), true)).toEqual([
      'aplicar',
      'descartar',
    ]);
    expect(acoesDoUsuario(usuario('a', { item: item({ situacao: 'falhou' }) }), true)).toEqual(['decidir']);
    expect(acoesDoUsuario(usuario('a', { item: item({ situacao: 'aplicado' }) }), true)).toEqual([]);
    // Achado 2 da revisão do M59.4: o inativo ou bloqueado também sai do grupo amplo pela troca de grupo; com o
    // bloqueio aplicado ele continua no grupo e pode ser decidido de novo; com a troca aplicada, não.
    expect(acoesDoUsuario(usuario('a', { ativo: false }), true)).toEqual(['decidir']);
    expect(
      acoesDoUsuario(usuario('a', { item: item({ situacao: 'aplicado', decisao: 'bloquear' }) }), true),
    ).toEqual(['decidir']);
  });

  it('ordem: sem decisão, propostos, aprovados, o resto; destino sugerido só se for destino válido', () => {
    const us = [
      usuario('d', { item: item({ situacao: 'aplicado' }) }),
      usuario('c', { item: item({ situacao: 'aprovado' }) }),
      usuario('b', { item: item() }),
      usuario('a2'),
      usuario('a1'),
    ];
    expect(ordenarUsuarios(us).map((u) => u.login)).toEqual(['a1', 'a2', 'b', 'c', 'd']);
    expect(destinoInicial(usuario('a'), painel().destinos)).toBe('RECEPCAO');
    expect(destinoInicial(usuario('a', { sugestao: { grupo: 'X', cobertas: 1, usadas: 1 } }), [])).toBe('');
    expect(destinoInicial(usuario('a', { sugestao: null }), painel().destinos)).toBe('');
  });
});

describe('recusas', () => {
  it('toda recusa conhecida tem texto; o resto vai à mensagem genérica', () => {
    const textos = (mensagensWeb as unknown as { saneamento: { recusas: Record<string, string> } }).saneamento
      .recusas;
    for (const c of RECUSAS_SANEAMENTO) expect(textos[c], c).toBeTruthy();
    expect(chaveRecusaSaneamento('grupo-com-ativos')).toBe('saneamento.recusas.grupo-com-ativos');
    expect(chaveRecusaSaneamento('operacao-desligada')).toBe('saneamento.recusas.operacao-desligada');
    expect(textos['operacao-desligada']).toBeTruthy();
    expect(chaveRecusaSaneamento('outra')).toBeNull();
    expect(chaveRecusaSaneamento(null)).toBeNull();
  });
});

describe('rota', () => {
  const sessao = (permissoes: string[]) => async () => ({
    usuario: { id: 's', nome: 'S' },
    rede: null,
    estabelecimentos: [],
    estabelecimentoAtivo: null,
    permissoes,
    sintetica: true,
    bloqueioInatividadeSegundos: 0,
  });
  it('abre com acesso.grupo.ler; sem ela, sem permissão', async () => {
    const sem = criarRoteador(sessao(['acesso.inicio.ler']), {
      historico: createMemoryHistory(),
      desenvolvimento: true,
    });
    await sem.push('/administracao/acesso/grupos/saneamento');
    expect(sem.currentRoute.value.name).toBe('sem-permissao');
    const com = criarRoteador(sessao(['acesso.inicio.ler', 'acesso.grupo.ler']), {
      historico: createMemoryHistory(),
      desenvolvimento: true,
    });
    await com.push('/administracao/acesso/grupos/saneamento');
    expect(com.currentRoute.value.name).toBe('acesso.saneamento');
  });
});

describe('saneamento dos grupos', () => {
  it('quem só lê vê o painel e os usuários, sem ações', async () => {
    comPermissoes(['acesso.grupo.ler']);
    simular((p) => {
      if (p.url === BASE) return { status: 200, corpo: painel() };
      if (p.url === `${BASE}/grupos/MASTER/usuarios`)
        return {
          status: 200,
          corpo: { grupo: 'MASTER', usoLido: false, usuarios: [usuario('SINT.A', { item: item() })] },
        };
      return undefined;
    });
    const w = await montar();
    await flushPromises();
    expect(w.find('[data-testid="saneamento-sem-edicao"]').exists()).toBe(true);
    expect(w.find('[data-testid="saneamento-administradores"]').text()).toContain('1 de 3');
    // Achado 1 da revisão do M59.4: os ativos reais do grupo de acesso total contra o máximo, com o aviso.
    expect(w.find('[data-testid="saneamento-administradores"]').text()).toContain(
      'hoje no grupo de acesso total: 4',
    );
    expect(w.find('[data-testid="saneamento-administradores-excedido"]').text()).toContain('acima dos 3');
    expect(w.find('[data-testid="saneamento-inativos-MASTER"]').text()).toBe('1');
    expect(w.find('[data-testid="saneamento-grupo-MASTER_CONSULTA_FINANCEIRO"]').text()).toContain(
      'Não existe neste estabelecimento',
    );
    expect(w.find('[data-testid="saneamento-dissolver-MASTER_SEM_FINANCEIRO"]').exists()).toBe(false);
    await w.find('[data-testid="saneamento-ver-MASTER"]').trigger('click');
    await flushPromises();
    const linha = w.find('[data-testid="saneamento-usuario-SINT.A"]');
    expect(linha.text()).toContain('Passar ao grupo RECEPCAO');
    expect(linha.text()).toContain('20/10/2026 (9 dia(s) sem entrar)');
    expect(w.find('[data-testid="saneamento-sem-uso"]').exists()).toBe(true);
    expect(w.find('[data-testid="saneamento-aplicar-SINT.A"]').exists()).toBe(false);
    expect(w.find('[data-testid="saneamento-ir-para"]').exists()).toBe(false);
  });

  it('o gestor decide com o simulador, aprova pela área e aplica com a senha', async () => {
    comPermissoes(['acesso.grupo.ler', 'acesso.grupo.sanear']);
    let atual: ItemSaneamento | null = null;
    const pedidos = simular((p) => {
      if (p.url === BASE) return { status: 200, corpo: painel() };
      if (p.url === `${BASE}/grupos/MASTER/usuarios`)
        return {
          status: 200,
          corpo: { grupo: 'MASTER', usoLido: true, usuarios: [usuario('SINT.A', { item: atual })] },
        };
      if (p.url.startsWith(`${BASE}/simulacao?`))
        return {
          status: 200,
          corpo: {
            login: 'SINT.A',
            grupoOrigem: 'MASTER',
            grupoDestino: 'RECEPCAO',
            antes: 900,
            depois: 40,
            mantidas: 38,
            ganhas: [{ id: 7, titulo: 'Painel da recepção', usos: 0 }],
            ganhasTotal: 2,
            perdidas: [
              { id: 1, titulo: 'Faturamento', usos: 5 },
              { id: 2, titulo: 'Estoque', usos: 0 },
            ],
            perdidasTotal: 862,
            perdidasUsadas: 1,
            exigeAprovacao: true,
            usoLido: true,
            janelaDias: 180,
          },
        };
      if (p.metodo === 'POST' && p.url === `${BASE}/plano`) {
        atual = item({ perdasUsadas: 1, exigeAprovacao: true });
        return { status: 201, corpo: atual };
      }
      if (p.url === `${BASE}/plano/11/aprovar`) {
        atual = item({
          perdasUsadas: 1,
          exigeAprovacao: true,
          situacao: 'aprovado',
          aprovacao: {
            area: 'Faturamento',
            por: 'SINT.SANEAR.AREA',
            em: '2026-10-29T11:00:00.000Z',
            motivo: 'ok área',
          },
        });
        return { status: 200, corpo: atual };
      }
      if (p.url === `${BASE}/plano/11/aplicar`) {
        atual = { ...atual!, situacao: 'aplicado', aplicadoEm: '2026-10-29T12:00:00.000Z' };
        return { status: 200, corpo: { item: atual, operacao: 'acesso.trocarGrupoUsuario', lotes: 1 } };
      }
      return undefined;
    });
    const w = await montar();
    await flushPromises();
    await w.find('[data-testid="saneamento-ver-MASTER"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="saneamento-decidir-SINT.A"]').trigger('click');
    await flushPromises();
    // A sugestão pelo uso vem pré-selecionada e o simulador mostra o antes e o depois.
    const sim = document.querySelector('[data-testid="saneamento-simulador"]');
    expect(sim?.textContent).toContain('Hoje 900 opção(ões); depois 40');
    expect(document.querySelector('[data-testid="simulador-exige"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="simulador-perdidas"]')?.textContent).toContain(
      'Faturamento',
    );
    expect(sim?.textContent).toContain('e mais 860 opção(ões).');
    const motivo = document.querySelector<HTMLInputElement>('[data-testid="decidir-motivo"]')!;
    motivo.value = 'função na recepção';
    motivo.dispatchEvent(new Event('input'));
    document.querySelector<HTMLFormElement>('[data-testid="form-saneamento-decidir"]')!.requestSubmit();
    await flushPromises();
    const decidir = pedidos.find((p) => p.metodo === 'POST' && p.url === `${BASE}/plano`)!;
    expect(decidir.corpo).toEqual({
      login: 'SINT.A',
      decisao: 'trocar-grupo',
      grupoDestino: 'RECEPCAO',
      motivo: 'função na recepção',
    });
    expect(w.find('[data-testid="saneamento-aviso"]').text()).toContain('Decisão registrada para SINT.A');
    expect(w.find('[data-testid="saneamento-exige"]').exists()).toBe(true);
    expect(w.find('[data-testid="saneamento-aplicar-SINT.A"]').exists()).toBe(false);

    await w.find('[data-testid="saneamento-aprovar-SINT.A"]').trigger('click');
    await flushPromises();
    const preencher = (id: string, v: string) => {
      const el = document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
      el.value = v;
      el.dispatchEvent(new Event('input'));
    };
    preencher('aprovar-area', 'Faturamento');
    preencher('aprovar-motivo', 'ok da área');
    preencher('alvo-senha', 'senha-sintetica');
    document.querySelector<HTMLFormElement>('[data-testid="form-saneamento-alvo"]')!.requestSubmit();
    await flushPromises();
    const aprovar = pedidos.find((p) => p.url === `${BASE}/plano/11/aprovar`)!;
    expect(aprovar.corpo).toEqual({
      dados: { area: 'Faturamento', motivo: 'ok da área' },
      senha: 'senha-sintetica',
    });
    expect(w.find('[data-testid="saneamento-usuario-SINT.A"]').text()).toContain(
      'Aprovado pela área Faturamento',
    );

    await w.find('[data-testid="saneamento-aplicar-SINT.A"]').trigger('click');
    await flushPromises();
    expect(document.querySelector('[data-testid="aprovar-area"]')).toBeNull();
    preencher('alvo-senha', 'senha-sintetica');
    document.querySelector<HTMLFormElement>('[data-testid="form-saneamento-alvo"]')!.requestSubmit();
    await flushPromises();
    const aplicar = pedidos.find((p) => p.url === `${BASE}/plano/11/aplicar`)!;
    expect(aplicar.corpo).toEqual({ senha: 'senha-sintetica' });
    expect(aplicar.chave).toMatch(/^web-/);
    expect(w.find('[data-testid="saneamento-aviso"]').text()).toContain('Decisão de SINT.A aplicada.');
    expect(w.find('[data-testid="saneamento-usuario-SINT.A"]').text()).toContain('Aplicado');
  });

  it('descarta a decisão; recusa do servidor aparece; retira as opções do grupo vazio com a senha', async () => {
    comPermissoes(['acesso.grupo.ler', 'acesso.grupo.sanear']);
    let atual: ItemSaneamento | null = item();
    const pedidos = simular((p) => {
      if (p.url === BASE) return { status: 200, corpo: painel() };
      if (p.url === `${BASE}/grupos/MASTER/usuarios`)
        return {
          status: 200,
          corpo: { grupo: 'MASTER', usoLido: true, usuarios: [usuario('SINT.A', { item: atual })] },
        };
      if (p.url === `${BASE}/plano/11/descartar`) {
        atual = null;
        return { status: 200, corpo: item({ situacao: 'descartado' }) };
      }
      if (p.url === `${BASE}/grupos/MASTER_SEM_FINANCEIRO/dissolver`) {
        if ((p.corpo?.['senha'] as string) === 'errada')
          return {
            status: 409,
            corpo: {
              type: 'recusa-de-negocio',
              title: 'Não foi possível concluir',
              status: 409,
              codigo: 'grupo-com-ativos',
            },
          };
        return {
          status: 200,
          corpo: {
            item: item({
              decisao: 'dissolver-grupo',
              login: null,
              idUsuario: null,
              grupoOrigem: 'MASTER_SEM_FINANCEIRO',
              grupoDestino: null,
              situacao: 'aplicado',
            }),
            operacao: 'acesso.revogarOpcoesGrupo',
            lotes: 3,
          },
        };
      }
      return undefined;
    });
    const w = await montar();
    await flushPromises();
    await w.find('[data-testid="saneamento-ver-MASTER"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="saneamento-descartar-SINT.A"]').trigger('click');
    await flushPromises();
    expect(pedidos.some((p) => p.url === `${BASE}/plano/11/descartar` && p.metodo === 'POST')).toBe(true);
    expect(w.find('[data-testid="saneamento-aviso"]').text()).toContain('Decisão de SINT.A descartada.');
    expect(w.find('[data-testid="saneamento-decidir-SINT.A"]').exists()).toBe(true);

    await w.find('[data-testid="saneamento-dissolver-MASTER_SEM_FINANCEIRO"]').trigger('click');
    await flushPromises();
    expect(document.querySelector('[data-testid="form-saneamento-dissolver"]')?.textContent).toContain('450');
    const preencher = (id: string, v: string) => {
      const el = document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
      el.value = v;
      el.dispatchEvent(new Event('input'));
    };
    preencher('dissolver-motivo', 'grupo vazio após o saneamento');
    preencher('dissolver-senha', 'errada');
    document.querySelector<HTMLFormElement>('[data-testid="form-saneamento-dissolver"]')!.requestSubmit();
    await flushPromises();
    expect(document.querySelector('[data-testid="saneamento-recusa"]')?.textContent).toContain(
      'Ainda há usuários ativos no grupo',
    );
    preencher('dissolver-senha', 'senha-sintetica');
    document.querySelector<HTMLFormElement>('[data-testid="form-saneamento-dissolver"]')!.requestSubmit();
    await flushPromises();
    const d = pedidos.filter((p) => p.url === `${BASE}/grupos/MASTER_SEM_FINANCEIRO/dissolver`);
    expect(d).toHaveLength(2);
    expect(d[1]!.corpo).toEqual({
      dados: { motivo: 'grupo vazio após o saneamento' },
      senha: 'senha-sintetica',
    });
    expect(d[0]!.chave).not.toBe(d[1]!.chave);
    expect(w.find('[data-testid="saneamento-aviso"]').text()).toContain(
      'Opções do grupo MASTER_SEM_FINANCEIRO retiradas (3 lote(s)).',
    );
  });
});
