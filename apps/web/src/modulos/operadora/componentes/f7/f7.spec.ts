// @vitest-environment jsdom
// Telas do atendimento com protocolo e das contas do portal do prestador (M56, etapa 8, F7): com a fatia desligada, o
// motivo e nada da lista; ligada, as contagens e a lista; a ficha mostra só as ações que o servidor manda e grava a
// resposta com a versão; o registro recusa antes de gravar o que as regras recusam (a notificação da ANS sem número) e
// manda a NIP com o canal da ANS; nas contas do portal, a função não liberável vem travada e o código de ativação
// aparece uma vez. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../../i18n/pt-BR.js';
import AcessosPortal from './AcessosPortal.vue';
import FichaProtocolo from './FichaProtocolo.vue';
import ProtocolosAtendimento from './ProtocolosAtendimento.vue';
import RegistroProtocolo from './RegistroProtocolo.vue';

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
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montar = (c: unknown, props: Record<string, unknown> = {}) =>
  mount(c as never, {
    props: props as never,
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="String(to)"><slot /></a>' } },
    },
  });

const apoio = (ligada = true) => ({
  dominios: { origem: [{ codigo: 1, rotulo: 'Central de atendimento' }] },
  operadoras: ligada ? [{ id: 1, nome: 'Operadora Sintética', registroAns: '900001' }] : [],
  ligada,
  motivo: ligada ? null : 'Ligue a chave do atendimento com protocolo nas liberações.',
  podeRegistrar: true,
  hoje: '2026-10-26',
  parametros: {
    diasUteisAssistencial: 5,
    diasUteisComplexo: 10,
    diasUteisNaoAssistencial: 7,
    diasUteisOuvidoria: 7,
    diasUteisOuvidoriaMaximo: 30,
    diasUteisNipAssistencial: 5,
    diasUteisNipNaoAssistencial: 10,
    horasEscrita: 24,
  },
});
const resumo = {
  id: 7,
  protocolo: '90000120261026500001',
  instancia: 'atendimento',
  natureza: 'cobertura',
  classe: 'assistencial',
  canal: 'telefone',
  beneficiarioNome: 'Beneficiária Sintética',
  carteirinha: '0000000000000001',
  assunto: 'Cobertura de exame sintético',
  situacao: 'em-analise',
  abertoEm: '2026-10-26T10:00:00',
  prazoEm: '2026-11-02T23:59:59',
  vencido: false,
  escritaPendente: false,
  escritaVencida: false,
  versao: 3,
};
const detalhe = {
  ...resumo,
  operadora: 1,
  origem: 1,
  origemRotulo: 'Central de atendimento',
  solicitante: 'beneficiario',
  solicitanteNome: null,
  beneficiario: 11,
  prestador: null,
  autorizacao: null,
  origemProtocolo: null,
  reanalises: [],
  numeroNip: null,
  urgente: false,
  altaComplexidade: false,
  relato: 'Relato sintético do contato do beneficiário.',
  prazoTipo: 'assistencial',
  prazoOriginalEm: '2026-11-02T23:59:59',
  prorrogadoAte: null,
  prorrogacaoMotivo: null,
  prorrogavelAte: null,
  conclusao: null,
  resposta: null,
  fundamento: null,
  meio: null,
  respondidoEm: null,
  respondidoPor: null,
  escritaPedida: false,
  escritaPedidaEm: null,
  escritaPrazoEm: null,
  escritaEnviadaEm: null,
  escritaMeio: null,
  encerradoEm: null,
  motivoCancelamento: null,
  eventos: [
    {
      id: 1,
      evento: 'registro',
      situacao: 'aberto',
      texto: null,
      em: '2026-10-26T10:00:00',
      por: 'ATENDENTE.SINTETICO',
    },
  ],
  acoes: ['interagir', 'responder', 'cancelar'],
  textoEscrito: null,
};
const lista = {
  itens: [resumo],
  proxima: null,
  totais: { abertos: 0, emAnalise: 1, vencidos: 0, escritaPendente: 0, respondidosHoje: 0 },
};

type Estado = { d: Record<string, unknown>; completo: boolean; confirmar: () => Promise<void> };
type Pedido = { url: string; init?: RequestInit };
function simular(rotas: (u: string, init?: RequestInit) => unknown): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      pedidos.push({ url: u, ...(init ? { init } : {}) });
      const corpo = rotas(u, init);
      return new Response(JSON.stringify(corpo ?? {}), {
        status: corpo === undefined ? 404 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return pedidos;
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
const corpoDe = (p: Pedido | undefined) =>
  JSON.parse(String(p?.init?.body ?? '{}')) as Record<string, unknown>;

describe('atendimento com protocolo', () => {
  it('desligado: o motivo aparece e a lista não é lida', async () => {
    const pedidos = simular((u) => (u.includes('/apoio') ? apoio(false) : lista));
    const w = montar(ProtocolosAtendimento);
    await flushPromises();
    expect(w.find('[data-testid="prot-desligada"]').text()).toContain('Ligue a chave');
    expect(pedidos.some((p) => /\/api\/operadora\/protocolos(\?|$)/.test(p.url))).toBe(false);
    w.unmount();
  });

  it('ligado: contagens e lista; a ficha só com as ações do servidor; a resposta vai com a versão', async () => {
    const pedidos = simular((u, init) => {
      if (u.includes('/apoio')) return apoio();
      if (init?.method === 'POST' && u.endsWith('/7/resposta'))
        return {
          ok: true,
          id: 7,
          versao: 4,
          situacao: 'respondido',
          protocolo: resumo.protocolo,
          mensagem: 'Resposta registrada.',
        };
      if (/\/protocolos\/7$/.test(u)) return detalhe;
      return lista;
    });
    const w = montar(ProtocolosAtendimento);
    await flushPromises();
    expect(w.find('[data-testid="prot-total-emAnalise"]').text()).toContain('1');
    expect(w.find('[data-testid="prot-linha-7"]').text()).toContain('Cobertura de exame sintético');
    await w.find('[data-testid="prot-abrir-7"]').trigger('click');
    await flushPromises();
    const acoes = w.findAll('[data-testid^="prot-acao-"]').map((b) => b.attributes('data-testid'));
    expect(acoes).toEqual(['prot-acao-interagir', 'prot-acao-responder', 'prot-acao-cancelar']);

    await w.find('[data-testid="prot-acao-responder"]').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('[data-testid="prot-dialogo"]')).not.toBeNull();
    const st = (w.findComponent(FichaProtocolo).vm as unknown as { $: { setupState: Estado } }).$.setupState;
    st.d.conclusao = 'favoravel';
    st.d.texto = 'Cobertura confirmada pelo contrato, procedimento previsto no rol vigente.';
    await flushPromises();
    expect(st.completo).toBe(true);
    await st.confirmar();
    await flushPromises();
    const post = pedidos.find((p) => p.init?.method === 'POST');
    expect(post?.url).toContain('/api/operadora/protocolos/7/resposta');
    expect(corpoDe(post)).toEqual({
      versao: 3,
      conclusao: 'favoravel',
      resposta: 'Cobertura confirmada pelo contrato, procedimento previsto no rol vigente.',
      meio: 'telefone',
    });
    expect(w.find('[data-testid="prot-mensagem"]').text()).toContain('Resposta registrada.');
    w.unmount();
  });

  it('W0-10: a ficha mostra as respostas do prestador pelo portal, com o download do anexo', async () => {
    simular((u) => {
      if (u.includes('/apoio')) return apoio();
      if (/\/protocolos\/7$/.test(u))
        return {
          ...detalhe,
          respostasPrestador: [
            {
              id: 12,
              interacao: 2,
              evento: 3,
              texto: 'Resposta sintética do prestador.',
              anexo: { nome: 'laudo.pdf', tipo: 'application/pdf', tamanho: 8, sha256: 'ab'.repeat(32) },
              em: '2026-10-27T09:00:00',
            },
          ],
        };
      return lista;
    });
    const w = montar(ProtocolosAtendimento);
    await flushPromises();
    await w.find('[data-testid="prot-abrir-7"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="prot-resposta-prestador-12"]').text()).toContain(
      'Resposta sintética do prestador.',
    );
    expect(w.find('[data-testid="prot-resposta-anexo-12"]').attributes('href')).toBe(
      '/api/operadora/protocolos/7/respostas/12/anexo',
    );
    w.unmount();
  });
});

describe('registro do protocolo', () => {
  it('a notificação da ANS sem número é recusada antes de gravar, com o texto do servidor', async () => {
    const pedidos = simular(() => undefined);
    const w = montar(RegistroProtocolo, { apoio: apoio() });
    await flushPromises();
    const vm = w.vm as unknown as { $: { setupState: { f: Record<string, unknown> } } };
    const f = vm.$.setupState.f;
    f['instancia'] = 'nip';
    f['canal'] = 'ans';
    f['solicitante'] = 'ans';
    f['natureza'] = 'reembolso';
    f['carteirinha'] = '0000000000000001';
    f['assunto'] = 'Demanda sintética da ANS';
    f['relato'] = 'Relato sintético da notificação recebida.';
    await flushPromises();
    expect(w.find('[data-testid="prot-recusas-locais"]').text()).toContain('número da demanda da ANS');
    expect(w.find('[data-testid="prot-prazo-previsto"]').text()).toContain('5 dias úteis');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(pedidos.length).toBe(0);

    f['numeroNip'] = '123456789';
    await flushPromises();
    expect(w.find('[data-testid="prot-recusas-locais"]').exists()).toBe(false);
    w.unmount();
  });
});

describe('contas do portal do prestador', () => {
  const acessos = {
    itens: [
      {
        id: 3,
        operadora: 1,
        prestador: 21,
        prestadorNome: 'Clínica Sintética',
        login: 'responsavel@clinica.invalid',
        nome: 'Responsável Sintético',
        funcoes: [1, 3],
        tipoAtendimento: 1,
        situacao: 'ativo',
        ativacaoValidaAte: null,
        bloqueadoAte: null,
        ultimoAcessoEm: null,
        motivoEncerramento: null,
        versao: 2,
      },
    ],
    ligada: true,
    motivo: null,
    podeEditar: true,
    funcoes: [
      { codigo: 1, rotulo: 'Solicitar autorização', liberavel: true },
      { codigo: 3, rotulo: 'Consultar autorização', liberavel: true },
      { codigo: 8, rotulo: 'Configurar acessos', liberavel: false },
    ],
    tiposAtendimento: [{ codigo: 1, rotulo: 'Ambulatorial' }],
    prestadores: [{ id: 21, nome: 'Clínica Sintética' }],
    operadoras: [{ id: 1, nome: 'Operadora Sintética', registroAns: '900001' }],
  };

  it('a função não liberável vem travada; a reemissão mostra o código uma vez', async () => {
    const pedidos = simular((_u, init) =>
      init?.method === 'POST'
        ? {
            ok: true,
            id: 3,
            versao: 3,
            situacao: 'pendente',
            codigoAtivacao: 'ABCD2345EFGH',
            ativacaoValidaAte: '2026-10-29T10:00:00',
            mensagem: 'Código reemitido.',
          }
        : acessos,
    );
    const w = montar(AcessosPortal);
    await flushPromises();
    expect(w.find('[data-testid="portal-linha-3"]').text()).toContain(
      'Solicitar autorização, Consultar autorização',
    );

    await w.find('[data-testid="portal-nova"]').trigger('click');
    await flushPromises();
    const f8 = document.body.querySelector('[data-testid="portal-funcao-8"]') as HTMLInputElement;
    const f1 = document.body.querySelector('[data-testid="portal-funcao-1"]') as HTMLInputElement;
    expect(f8.disabled).toBe(true);
    expect(f1.disabled).toBe(false);
    (w.vm as unknown as { $: { setupState: { modo: unknown } } }).$.setupState.modo = null;
    await flushPromises();

    await w.find('[data-testid="portal-reemitir-3"]').trigger('click');
    await flushPromises();
    (document.body.querySelector('[data-testid="portal-dialogo"]') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await flushPromises();
    const post = pedidos.find((p) => p.init?.method === 'POST');
    expect(post?.url).toContain('/api/operadora/portal/acessos/3/reemissao');
    expect(corpoDe(post)).toEqual({ versao: 2 });
    expect(w.find('[data-testid="portal-codigo"]').text()).toContain('ABCD2345EFGH');
    w.unmount();
  });
});
