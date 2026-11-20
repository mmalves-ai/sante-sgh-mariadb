// @vitest-environment jsdom
// Telas da notificação de incidentes (M48, etapa 1): o formulário do botão global (com o paciente da tela vai só o ID do
// atendimento; o número e o código aparecem uma vez; sem "sem me identificar" no acesso de suporte; desligado em
// consulta), o acompanhamento, a lista do NSP com "Triar próxima", o detalhe (anônima sem quem notificou; corrigir a
// classificação exige justificativa; a triagem vai com a versão lida) e a fila de prazos com o aviso de feriado móvel e
// os campos do Notivisa. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { definirContextoClinico, limparContextoClinico } from '../../casca/notificar/contexto-clinico.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import AcompanharNotificacao from './componentes/AcompanharNotificacao.vue';
import FormularioNotificacao from './componentes/FormularioNotificacao.vue';
import NotificacaoDetalheTela from './telas/NotificacaoDetalheTela.vue';
import NotificacoesTela from './telas/NotificacoesTela.vue';
import PrazosNotivisaTela from './telas/PrazosNotivisaTela.vue';

const push = vi.fn();
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ replace: vi.fn(), push }),
  useRoute: () => ({ path: '/pep/48001/prontuario', params: {}, query: {} }),
}));
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
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

type Resposta = { status?: number; corpo: unknown };
type Rota = (url: string, init?: RequestInit) => Resposta | unknown;
function simular(rota: Rota) {
  const chamadas: { url: string; metodo: string; corpo: unknown; chave: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      chamadas.push({
        url: String(url),
        metodo: init?.method ?? 'GET',
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
        chave: h.get('idempotency-key'),
      });
      const r = rota(String(url), init);
      const comStatus = r && typeof r === 'object' && 'corpo' in r ? (r as Resposta) : { corpo: r };
      return new Response(JSON.stringify(comStatus.corpo), {
        status: comStatus.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return chamadas;
}
afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
  limparContextoClinico();
  push.mockReset();
  document.body.innerHTML = '';
});

/** Abre o combo e escolhe a opção pelo valor (o OpenVue anexa a lista ao body e escolhe no mousedown). */
const escolher = async (w: ReturnType<typeof mount>, testid: string, valor: string) => {
  await w.find(`[data-testid="${testid}"] [role="combobox"]`).trigger('click');
  await flushPromises();
  await nextTick();
  const opcao = document.body.querySelector<HTMLElement>(`[role="option"]:has([data-valor="${valor}"])`);
  expect(opcao, `opção ${valor} em ${testid}`).not.toBeNull();
  opcao!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await flushPromises();
};
const marcar = async (w: ReturnType<typeof mount>, testid: string, rotulo: string) => {
  const l = w.findAll(`[data-testid="${testid}"] label`).find((x) => x.text().includes(rotulo));
  expect(l, `${rotulo} em ${testid}`).toBeTruthy();
  await l!.find('input').setValue(true);
};
const digitar = async (w: ReturnType<typeof mount>, testid: string, texto: string) => {
  await w.find(`[data-testid="${testid}"] textarea, [data-testid="${testid}"] input`).setValue(texto);
};

const FORMULARIO = {
  ligada: true,
  motivo: null,
  unidades: [
    { codigo: 3, nome: 'UNIDADE SINTETICA A' },
    { codigo: 4, nome: 'UNIDADE SINTETICA B' },
  ],
  anonimaPermitida: true,
  agora: '2026-10-22T09:00:00',
};
const GRAVACAO = { ligada: true, motivo: null, acoes: { triar: true, notivisa: true } };
const prazo = (situacao = 'venceEmBreve', minutos = 300) => ({
  tipo: 'notivisaObito',
  venceEm: '2026-10-25T08:30:00',
  situacao,
  minutosRestantes: minutos,
});
const resumo = (x: Record<string, unknown> = {}) => ({
  id: 7,
  protocolo: 'NSP-2026-000007',
  notificadaEm: '2026-10-22T08:40:00',
  ocorridoEm: '2026-10-22T08:30:00',
  tipo: 'queda',
  classificacao: 'eventoAdverso',
  dano: 'leve',
  situacao: 'recebida',
  notivisa: 'naoObrigatoria',
  unidade: 'UNIDADE SINTETICA A',
  comPaciente: true,
  anonima: true,
  proximoPrazo: null,
  ...x,
});
const detalhe = (x: Record<string, unknown> = {}) => ({
  ...resumo(x),
  versao: 1,
  descricao: 'Paciente sintético escorregou ao sair do leito.',
  local: 'Leito 12',
  chegouAoPaciente: true,
  danoPercebido: 'leve',
  tipoOutro: null,
  neverEvent: false,
  notificador: null,
  paciente: { id: 99, nome: 'PACIENTE SINTETICO', prontuario: 501, leito: '12' },
  gestor: null,
  prazoAnalise: null,
  prazos: [],
  eventos: [{ tipo: 'recebida', em: '2026-10-22T08:40:00', por: null, texto: null }],
  ...x,
});

describe('o formulário "Notificar incidente"', () => {
  it('com o paciente da tela: manda só o ID do atendimento, a mesma chave no reenvio e mostra o número e o código', async () => {
    definirContextoClinico({ atendimento: 48001, rotulo: 'PACIENTE SINTETICO · Internação 1' });
    let falhou = false;
    const chamadas = simular((url, init) => {
      if (url.endsWith('/formulario')) return FORMULARIO;
      if (url.endsWith('/qualidade/notificacoes') && init?.method === 'POST') {
        if (!falhou) {
          falhou = true;
          return { status: 503, corpo: { type: 'about:blank', title: 'Indisponível', status: 503 } };
        }
        return { protocolo: 'NSP-2026-000001', codigoAcompanhamento: 'ABCDEFGH23', repetida: false };
      }
      return {};
    });
    const w = montar(FormularioNotificacao);
    await flushPromises();
    expect(w.text()).toContain('não é punitiva');
    expect(w.find('[data-testid="notificar-paciente"]').text()).toContain('PACIENTE SINTETICO');
    expect(w.find('[data-testid="notificar-unidade"]').exists()).toBe(false);
    await w.find('[data-testid="notificar-enviar"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="notificar-falta"]').exists()).toBe(true);

    await escolher(w, 'notificar-tipo', 'queda');
    await marcar(w, 'notificar-chegou', 'Sim');
    await marcar(w, 'notificar-dano', 'Leve');
    await digitar(w, 'notificar-descricao', 'Paciente sintético escorregou ao sair do leito.');
    await w.find('[data-testid="notificar-anonima"]').setValue(true);
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="mensagem-erro"]').exists()).toBe(true);
    await w.find('form').trigger('submit');
    await flushPromises();
    const posts = chamadas.filter((c) => c.metodo === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.chave).toBe(posts[1]?.chave);
    expect(posts[1]?.corpo).toMatchObject({
      atendimento: 48001,
      unidade: null,
      tipo: 'queda',
      chegouAoPaciente: true,
      danoPercebido: 'leve',
      anonima: true,
      ocorridoEm: '2026-10-22T09:00',
      origem: { tela: '/pep/48001/prontuario' },
    });
    expect(JSON.stringify(posts[1]?.corpo)).not.toContain('PACIENTE SINTETICO');
    expect(w.find('[data-testid="notificacao-codigo"]').text()).toBe('ABCDEFGH23');
    expect(w.find('[data-testid="notificacao-protocolo"]').text()).toBe('NSP-2026-000001');
    w.unmount();
  });

  it('sem paciente na tela pede a unidade; no acesso de suporte não oferece a anônima', async () => {
    const chamadas = simular((url) =>
      url.endsWith('/formulario')
        ? { ...FORMULARIO, anonimaPermitida: false }
        : { protocolo: 'NSP-2026-000002', codigoAcompanhamento: '23456789AB', repetida: false },
    );
    const w = montar(FormularioNotificacao);
    await flushPromises();
    expect(w.find('[data-testid="notificar-anonima"]').exists()).toBe(false);
    expect(w.find('[data-testid="notificar-anonima-suporte"]').exists()).toBe(true);
    await escolher(w, 'notificar-unidade', '4');
    await escolher(w, 'notificar-tipo', 'dispositivo');
    await marcar(w, 'notificar-chegou', 'Não');
    await digitar(w, 'notificar-descricao', 'Bomba de infusão sintética desligou sozinha.');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.metodo === 'POST')?.corpo).toMatchObject({
      atendimento: null,
      unidade: 4,
      chegouAoPaciente: false,
      danoPercebido: 'nenhum',
      anonima: false,
    });
    w.unmount();
  });

  it('com a funcionalidade desligada, só o aviso', async () => {
    simular(() => ({ ...FORMULARIO, ligada: false }));
    const w = montar(FormularioNotificacao);
    await flushPromises();
    expect(w.find('[data-testid="notificar-desligado"]').exists()).toBe(true);
    expect(w.find('form').exists()).toBe(false);
    w.unmount();
  });
});

describe('o acompanhamento pelo número e o código', () => {
  it('mostra a situação e o retorno; número ou código errados têm o mesmo texto', async () => {
    let certo = false;
    simular(() =>
      certo
        ? {
            protocolo: 'NSP-2026-000001',
            notificadaEm: '2026-10-22T08:40:00',
            situacao: 'distribuida',
            devolutivas: [{ em: '2026-10-23T10:00:00', texto: 'Revisamos o piso do setor.' }],
          }
        : { status: 404, corpo: { type: 'about:blank', title: 'x', status: 404, codigo: 'nao-encontrado' } },
    );
    const w = montar(AcompanharNotificacao);
    await digitar(w, 'acompanhar-protocolo', 'nsp-2026-000001');
    await digitar(w, 'acompanhar-codigo', 'ABCDEFGH23');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="recusa-qualidade"]').text()).toContain('não conferem');
    certo = true;
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="acompanhamento"]').text()).toContain('Distribuída');
    expect(w.find('[data-testid="acompanhar-devolutiva"]').text()).toContain('Revisamos o piso');
    w.unmount();
  });
});

describe('a lista do NSP', () => {
  it('lista com o próximo prazo e a marca de triar agora; "Triar próxima" abre a mais urgente', async () => {
    definirSessaoDaTela({
      permissoes: ['qualidade.notificacao.ler', 'qualidade.notificacao.triar'],
    } as never);
    const chamadas = simular((url) => {
      if (url.includes('/proxima')) return { id: 9, protocolo: 'NSP-2026-000009' };
      if (url.includes('/formulario')) return FORMULARIO;
      return {
        itens: [
          resumo({ dano: 'grave', proximoPrazo: prazo('vencido', -120) }),
          resumo({ id: 8, protocolo: 'NSP-2026-000008', situacao: 'triada', anonima: false }),
        ],
        temMais: false,
        pagina: 1,
        agora: '2026-10-22T09:00:00',
        gravacao: GRAVACAO,
      };
    });
    const w = montar(NotificacoesTela);
    await flushPromises();
    const linha = w.find('[data-testid="nsp-linha-NSP-2026-000007"]');
    expect(linha.text()).toContain('Vencido há 2 h');
    expect(linha.text()).toContain('Triar agora');
    expect(linha.text()).toContain('Anônima');
    expect(w.find('[data-testid="nsp-linha-NSP-2026-000008"]').text()).not.toContain('Triar agora');
    await escolher(w, 'filtro-situacao', 'triada');
    await flushPromises();
    expect(chamadas.some((c) => c.url.includes('situacao=triada'))).toBe(true);
    await w.find('[data-testid="triar-proxima"]').trigger('click');
    await flushPromises();
    expect(push).toHaveBeenCalledWith('/qualidade/nsp/notificacoes/9');
    w.unmount();
  });

  it('sem a permissão de triar, sem o botão', async () => {
    definirSessaoDaTela({ permissoes: ['qualidade.notificacao.ler'] } as never);
    simular((url) =>
      url.includes('/formulario')
        ? FORMULARIO
        : { itens: [], temMais: false, pagina: 1, agora: '2026-10-22T09:00:00', gravacao: GRAVACAO },
    );
    const w = montar(NotificacoesTela);
    await flushPromises();
    expect(w.find('[data-testid="triar-proxima"]').exists()).toBe(false);
    expect(w.find('[data-testid="nsp-nenhuma"]').exists()).toBe(true);
    w.unmount();
  });
});

describe('o detalhe e a triagem', () => {
  it('a anônima não mostra quem notificou; corrigir exige justificativa e vai com a versão lida', async () => {
    const chamadas = simular((url, init) => {
      if (url.includes('/formulario')) return FORMULARIO;
      if (init?.method === 'POST') return { ok: true, id: 7, versao: 2, mensagem: 'x' };
      return { notificacao: detalhe(), agora: '2026-10-22T09:00:00', gravacao: GRAVACAO };
    });
    const w = montar(NotificacaoDetalheTela, { id: '7' });
    await flushPromises();
    expect(w.find('[data-testid="nsp-notificador"]').text()).toContain('Notificação anônima');
    expect(w.find('[data-testid="nsp-paciente"]').text()).toContain('PACIENTE SINTETICO');
    expect(w.find('[data-testid="painel-distribuir"]').exists()).toBe(false);
    expect(w.find('[data-testid="painel-descartar"]').exists()).toBe(true);
    expect(w.find('[data-testid="painel-triagem"]').text()).toContain(
      'Proposta pelo que o notificador respondeu',
    );

    await marcar(w, 'triagem-dano', 'Moderado');
    await w.find('[data-testid="painel-triagem"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="nsp-falta"]').exists()).toBe(true);
    expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false);

    await digitar(w, 'triagem-justificativa', 'O paciente precisou de curativo e observação.');
    await w.find('[data-testid="painel-triagem"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.url).toBe('/api/qualidade/nsp/notificacoes/7/triar');
    expect(post?.corpo).toMatchObject({ versao: 1, dano: 'moderado', classificacao: 'eventoAdverso' });
    expect(w.find('[data-testid="nsp-feito"]').exists()).toBe(true);
    w.unmount();
  });

  it('a classificação incoerente com o dano é avisada antes de gravar', async () => {
    simular((url) =>
      url.includes('/formulario')
        ? FORMULARIO
        : { notificacao: detalhe({ situacao: 'triada' }), agora: '2026-10-22T09:00:00', gravacao: GRAVACAO },
    );
    const w = montar(NotificacaoDetalheTela, { id: '7' });
    await flushPromises();
    await marcar(w, 'triagem-classificacao', 'Quase erro');
    await flushPromises();
    expect(w.find('[data-testid="painel-triagem"]').text()).not.toContain(
      'Proposta pelo que o notificador respondeu: Quase',
    );
    expect(
      w
        .find('[data-testid="painel-triagem"] [role="alert"], [data-testid="painel-triagem"] .sgh-alerta')
        .exists(),
    ).toBe(true);
    expect(w.find('[data-testid="painel-distribuir"]').exists()).toBe(true);
    w.unmount();
  });

  it('a distribuição busca o gestor e grava com a unidade e o prazo', async () => {
    const chamadas = simular((url, init) => {
      if (url.includes('/formulario')) return FORMULARIO;
      if (url.includes('/gestores')) return { itens: [{ login: 'SINT.GESTOR', nome: 'GESTOR SINTETICO' }] };
      if (init?.method === 'POST') return { ok: true, id: 7, versao: 3, mensagem: 'x' };
      return {
        notificacao: detalhe({ situacao: 'triada', versao: 2 }),
        agora: '2026-10-22T09:00:00',
        gravacao: GRAVACAO,
      };
    });
    const w = montar(NotificacaoDetalheTela, { id: '7' });
    await flushPromises();
    await digitar(w, 'distribuir-busca', 'gestor');
    await w.find('[data-testid="distribuir-buscar"]').trigger('click');
    await flushPromises();
    expect(chamadas.some((c) => c.url.includes('/nsp/gestores?busca=gestor'))).toBe(true);
    await escolher(w, 'distribuir-gestor', 'SINT.GESTOR');
    await w.find('[data-testid="painel-distribuir"]').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.metodo === 'POST')?.corpo).toMatchObject({
      versao: 2,
      gestor: 'SINT.GESTOR',
      unidade: 3,
      prazoAnalise: '2026-11-21',
    });
    w.unmount();
  });
});

describe('a fila de prazos e o Notivisa', () => {
  it('o aviso do feriado móvel fora do cadastro, as contagens e os campos com o paciente só por iniciais', async () => {
    const chamadas = simular((url, init) => {
      if (url.endsWith('/notivisa/campos'))
        return {
          campos: {
            protocoloInterno: 'NSP-2026-000007',
            tipoIncidente: 'Queda',
            classificacao: 'Evento adverso',
            ocorridoEm: '2026-10-22T08:30',
            periodo: 'manha',
            unidade: 'UNIDADE SINTETICA A',
            local: null,
            descricao: 'Queda sintética.',
            dano: 'Óbito',
            obito: true,
            neverEvent: false,
            paciente: { iniciais: 'P.S.', sexo: 'M', idade: 70 },
            prazo: prazo(),
          },
        };
      if (init?.method === 'POST') return { ok: true, id: 7, versao: 4, mensagem: 'x' };
      if (url.includes('/nsp/notificacoes/7'))
        return {
          notificacao: detalhe({ situacao: 'triada', versao: 3 }),
          agora: '2026-10-22T09:00:00',
          gravacao: GRAVACAO,
        };
      return {
        itens: [resumo({ situacao: 'triada', dano: 'obito', proximoPrazo: prazo() })],
        cortada: false,
        resumo: {
          porSituacao: { noPrazo: 0, venceEmBreve: 1, vencido: 0 },
          feriadosAusentes: [{ data: '2027-03-26', nome: 'Sexta-feira Santa' }],
        },
        agora: '2026-10-22T09:00:00',
        gravacao: GRAVACAO,
      };
    });
    const w = montar(PrazosNotivisaTela);
    await flushPromises();
    expect(w.find('[data-testid="feriado-ausente"]').text()).toContain('Sexta-feira Santa');
    expect(w.find('[data-testid="prazos-contagens"]').text()).toContain('Vence em breve: 1');
    expect(w.find('[data-testid="prazo-linha-NSP-2026-000007"]').text()).toContain('Vence em 5 h');
    await w.find('[data-testid="prazo-notivisa-NSP-2026-000007"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="gerar-campos"]').trigger('click');
    await flushPromises();
    const campos = w.find('[data-testid="campos-notivisa"]').text();
    expect(campos).toContain('P.S.');
    expect(campos).not.toContain('PACIENTE SINTETICO');
    await digitar(w, 'numero-notivisa', '2026.123456');
    await w.find('[data-testid="form-transcricao"]').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.url.endsWith('/notivisa/transcricao'))?.corpo).toMatchObject({
      versao: 3,
      numeroNotivisa: '2026.123456',
      transcritaEm: '2026-10-22T09:00',
    });
    w.unmount();
  });
});
