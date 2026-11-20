// @vitest-environment jsdom
// Telas da notificação compulsória (M48, etapa 4): o resumo, as sugestões e a abertura confirmada (a entrada vem do
// gatilho, com a chave de idempotência), a recusa com o texto da aplicação, o caso com a notificação (o canal do Sinan
// exige o número; o atraso fica avisado) e o descarte com a versão lida, o caso sem sugestão (paciente, agravo e a
// suspeita), a ficha para impressão, os exames que disparam a sugestão e a funcionalidade desligada (só consulta).
// Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { definirSessaoDaTela } from '../../../casca/sessao/pode.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import CasoAgravo from './componentes/CasoAgravo.vue';
import GatilhosExame from './componentes/GatilhosExame.vue';
import NovoCasoManual from './componentes/NovoCasoManual.vue';
import AgravosTela from './telas/AgravosTela.vue';
import FichaAgravoTela from './telas/FichaAgravoTela.vue';

const rotaAtual = { path: '/qualidade/vigilancia/agravos', params: {}, query: {} as Record<string, string> };
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => rotaAtual,
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
const montados: { unmount: () => void }[] = [];
const montar = (c: unknown, props: Record<string, unknown> = {}) => {
  const w = mount(c as never, {
    props: props as never,
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
  montados.push(w);
  return w;
};

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
  for (const w of montados.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
  rotaAtual.query = {};
  document.body.innerHTML = '';
});

const escolher = async (w: ReturnType<typeof mount>, testid: string, valor: string) => {
  await w.find(`[data-testid="${testid}"] [role="combobox"]`).trigger('click');
  await flushPromises();
  await nextTick();
  const opcao = document.body.querySelector<HTMLElement>(`[role="option"]:has([data-valor="${valor}"])`);
  expect(opcao, `opção ${valor} em ${testid}`).not.toBeNull();
  opcao!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await flushPromises();
};
const digitar = async (w: ReturnType<typeof mount>, testid: string, texto: string) => {
  const i = w.find(`[data-testid="${testid}"] textarea, [data-testid="${testid}"] input`);
  await i.setValue(texto);
  await i.trigger('blur');
};
const clicar = async (w: ReturnType<typeof mount>, testid: string) => {
  await w.find(`[data-testid="${testid}"]`).trigger('click');
  await flushPromises();
};
const enviarForm = async (w: ReturnType<typeof mount>, testid: string) => {
  await w.find(`[data-testid="${testid}"]`).trigger('submit');
  await flushPromises();
};
const posts = (c: ReturnType<typeof simular>) => c.filter((x) => x.metodo === 'POST');

const R = '/api/qualidade/vigilancia/agravos';
const AGORA = '2026-10-27T09:00:00';
const RESUMO = (ligada = true) => ({
  abertos: 1,
  imediatosAbertos: 1,
  vencidos: 0,
  gatilhosSemCaso: 1,
  notificadosNoMes: 2,
  ligada,
  motivo: null,
  podeNotificar: ligada,
  agora: AGORA,
});
const PACIENTE = {
  id: 1001,
  nome: 'PACIENTE SINTETICO UM',
  prontuario: 501,
  nascimento: '1990-05-10',
  sexo: 'F',
};
const GATILHO = {
  chave: 'cid:948001:A90',
  origem: 'cid',
  atendimento: 948001,
  exame: null,
  paciente: PACIENTE,
  cid: 'A90',
  nomeCid: 'DENGUE CLASSICO',
  periodicidade: 'semanal',
  gatilhoEm: '2026-10-26T10:00:00',
  prazoEm: '2026-11-02T10:00:00',
  estadoPrazo: 'noPrazo',
  exameNome: null,
  resultado: null,
  unidade: 'UNIDADE SINTETICA',
};
const CASO = (x: Record<string, unknown> = {}) => ({
  id: 41,
  versao: 1,
  situacao: 'aberto',
  origem: 'cid',
  atendimento: 948001,
  exame: null,
  paciente: PACIENTE,
  cid: 'A90',
  nomeCid: 'DENGUE CLASSICO',
  periodicidade: 'semanal',
  gatilhoEm: '2026-10-26T10:00:00',
  prazoEm: '2026-11-02T10:00:00',
  estadoPrazo: 'noPrazo',
  horasRestantes: 145,
  fichaModelo: 7,
  autoridade: null,
  canal: null,
  numero: null,
  notificadoEm: null,
  recebidoPor: null,
  motivoDescarte: null,
  justificativaDescarte: null,
  observacao: null,
  abertoPor: 'SINT.VIGILANCIA',
  abertoEm: '2026-10-27T08:55:00',
  encerradoPor: null,
  encerradoEm: null,
  ...x,
});
const PAGINA = (itens: unknown[]) => ({ itens, total: itens.length, pagina: 1, porPagina: 50 });

function rotasPadrao(extra: Rota = () => undefined, ligada = true): Rota {
  return (url, init) => {
    const e = extra(url, init);
    if (e !== undefined) return e;
    if (url.startsWith(`${R}/resumo`)) return RESUMO(ligada);
    if (url.startsWith(`${R}/gatilhos-exame`)) return { itens: [] };
    if (url.startsWith(`${R}/gatilhos`))
      return { itens: [GATILHO], cortada: false, desde: '2026-10-20T09:00:00' };
    if (url.startsWith(`${R}/casos/41`)) return CASO();
    if (url.startsWith(`${R}/casos`)) return PAGINA([CASO()]);
    if (url.startsWith(`${R}/cids`))
      return { itens: [{ cid: 'A90', nome: 'DENGUE CLASSICO', periodicidade: 'semanal' }], total: 1 };
    return { status: 404, corpo: { title: 'não simulado' } };
  };
}

describe('a fila de sugestões', () => {
  it('mostra o resumo e a sugestão; abrir pede confirmação e manda a entrada do gatilho com a chave', async () => {
    const c = simular(
      rotasPadrao((url, init) =>
        url === `${R}/casos` && init?.method === 'POST'
          ? { id: 41, periodicidade: 'semanal', prazoEm: '2026-11-02T10:00:00' }
          : undefined,
      ),
    );
    const w = montar(AgravosTela);
    await flushPromises();
    expect(w.find('[data-testid="resumo-abertos"]').text()).toBe('1');
    expect(w.find('[data-testid="resumo-notificados"]').text()).toBe('2');
    const linha = w.find('[data-testid="gatilho-cid:948001:A90"]');
    expect(linha.text()).toContain('PACIENTE SINTETICO UM');
    expect(linha.text()).toContain('Semanal (até 7 dias)');
    expect(linha.text()).toContain('Vence em 6 d 1 h');
    await clicar(w, 'abrir-cid:948001:A90');
    expect(posts(c)).toHaveLength(0);
    expect(w.find('[data-testid="confirmar-abertura"]').text()).toContain('A90');
    await clicar(w, 'confirmar-abrir');
    const p = posts(c)[0]!;
    expect(p.url).toBe(`${R}/casos`);
    expect(p.chave).toMatch(/^m48a\.abrir\./);
    expect(p.corpo).toEqual({
      origem: 'cid',
      exame: null,
      atendimento: 948001,
      paciente: 1001,
      cid: 'A90',
      gatilhoEm: '2026-10-26T10:00',
      observacao: null,
    });
    await flushPromises();
    expect(w.find('[data-testid="agravos-aviso"]').text()).toContain('02/11/2026 10:00');
    expect(w.find('[data-testid="caso-agravo"]').exists()).toBe(true);
    expect(w.find('[data-testid="aba-casos"]').attributes('aria-selected')).toBe('true');
  });

  it('a recusa do servidor aparece com o texto da aplicação', async () => {
    simular(
      rotasPadrao((url, init) =>
        url === `${R}/casos` && init?.method === 'POST'
          ? {
              status: 409,
              corpo: { type: 'recusa-de-negocio', title: 'x', status: 409, codigo: 'caso-ja-aberto' },
            }
          : undefined,
      ),
    );
    const w = montar(AgravosTela);
    await flushPromises();
    await clicar(w, 'abrir-cid:948001:A90');
    await clicar(w, 'confirmar-abrir');
    expect(w.find('[data-testid="recusa-agravo"]').text()).toContain('nos últimos 30 dias');
  });

  it('desligada: o aviso aparece e nada se grava (sem abrir, sem caso manual)', async () => {
    simular(rotasPadrao(() => undefined, false));
    const w = montar(AgravosTela);
    await flushPromises();
    expect(w.find('[data-testid="agravos-desligado"]').text()).toContain('em consulta');
    expect(w.find('[data-testid="gatilho-cid:948001:A90"]').exists()).toBe(true);
    expect(w.find('[data-testid="abrir-cid:948001:A90"]').exists()).toBe(false);
    expect(w.find('[data-testid="manual-abrir"]').exists()).toBe(false);
  });

  it('a lista dos casos abre pelo endereço com o caso e filtra pela situação', async () => {
    rotaAtual.query = { caso: '41' };
    const c = simular(rotasPadrao());
    const w = montar(AgravosTela);
    await flushPromises();
    expect(w.find('[data-testid="caso-agravo"]').exists()).toBe(true);
    expect(c.some((x) => x.url.includes('/casos?situacao=aberto'))).toBe(true);
    await escolher(w, 'casos-situacao', 'notificado');
    expect(c.some((x) => x.url.includes('/casos?situacao=notificado'))).toBe(true);
  });
});

describe('o caso', () => {
  it('notificar pelo Sinan exige o número; gravado vai com a versão e avisa o atraso', async () => {
    const c = simular(
      rotasPadrao((url, init) =>
        url === `${R}/casos/41/notificacao` && init?.method === 'POST'
          ? { versao: 2, comAtraso: true }
          : undefined,
      ),
    );
    const w = montar(CasoAgravo, { id: 41, podeNotificar: true, agora: AGORA });
    await flushPromises();
    expect(w.find('[data-testid="caso-paciente"]').text()).toContain('36 anos');
    expect(w.find('[data-testid="caso-ficha"]').attributes('href')).toBe(
      '/qualidade/vigilancia/agravos/casos/41/ficha',
    );
    await clicar(w, 'caso-notificar');
    await escolher(w, 'notificar-canal', 'sinanOnline');
    await enviarForm(w, 'form-notificar');
    expect(w.find('[data-testid="erros-agravo"]').text()).toContain('número da notificação');
    expect(posts(c)).toHaveLength(0);
    await digitar(w, 'notificar-numero', '1234567');
    await enviarForm(w, 'form-notificar');
    const p = posts(c)[0]!;
    expect(p.chave).toMatch(/^m48a\.notificar\./);
    expect(p.corpo).toEqual({
      versao: 1,
      autoridade: 'SMS',
      canal: 'sinanOnline',
      numero: '1234567',
      notificadoEm: '2026-10-27T09:00',
      recebidoPor: null,
      observacao: null,
    });
    expect(w.emitted('gravado')?.[0]?.[0]).toMatch(/depois do prazo/);
  });

  it('descartar exige motivo e justificativa', async () => {
    const c = simular(
      rotasPadrao((url, init) =>
        url === `${R}/casos/41/descarte` && init?.method === 'POST' ? { versao: 2 } : undefined,
      ),
    );
    const w = montar(CasoAgravo, { id: 41, podeNotificar: true, agora: AGORA });
    await flushPromises();
    await clicar(w, 'caso-descartar');
    await enviarForm(w, 'form-descartar');
    expect(w.find('[data-testid="erros-agravo"]').findAll('li')).toHaveLength(2);
    await escolher(w, 'descartar-motivo', 'naoConfirmado');
    await digitar(w, 'descartar-justificativa', 'CID de exclusão registrado por engano');
    await enviarForm(w, 'form-descartar');
    expect(posts(c)[0]!.corpo).toEqual({
      versao: 1,
      motivo: 'naoConfirmado',
      justificativa: 'CID de exclusão registrado por engano',
    });
    expect(w.emitted('gravado')?.[0]?.[0]).toMatch(/descartado/);
  });

  it('o caso notificado mostra a notificação e não tem ações', async () => {
    simular(
      rotasPadrao((url) =>
        url.startsWith(`${R}/casos/41`)
          ? CASO({
              situacao: 'notificado',
              estadoPrazo: 'cumprido',
              horasRestantes: null,
              autoridade: 'SMS',
              canal: 'telefone',
              notificadoEm: '2026-10-27T08:30:00',
              recebidoPor: 'PLANTAO VIGILANCIA',
            })
          : undefined,
      ),
    );
    const w = montar(CasoAgravo, { id: 41, podeNotificar: true, agora: AGORA });
    await flushPromises();
    expect(w.find('[data-testid="caso-notificacao"]').text()).toContain('Recebida por PLANTAO VIGILANCIA');
    expect(w.find('[data-testid="caso-prazo"]').text()).toContain('Notificado');
    expect(w.find('[data-testid="caso-notificar"]').exists()).toBe(false);
    expect(w.find('[data-testid="caso-descartar"]').exists()).toBe(false);
  });
});

describe('o caso sem sugestão', () => {
  it('busca o paciente, escolhe o agravo e exige a suspeita', async () => {
    const c = simular(
      rotasPadrao((url, init) => {
        if (url.startsWith('/api/cadastro/pacientes') || url.includes('pacientes?termo'))
          return {
            tipo: 'nome',
            itens: [
              {
                ...PACIENTE,
                nomeSocial: null,
                maeMascarada: null,
                cpfMascarado: null,
                telefoneMascarado: null,
                situacao: 'ativo',
                obito: false,
                homonimo: false,
                registro: 501,
              },
            ],
            sugestoes: [],
            truncado: false,
            duracaoMs: 3,
          };
        if (url === `${R}/casos` && init?.method === 'POST')
          return { id: 42, periodicidade: 'semanal', prazoEm: '2026-11-03T08:00:00' };
        return undefined;
      }),
    );
    const w = montar(NovoCasoManual, { agora: AGORA });
    await flushPromises();
    await digitar(w, 'manual-termo', 'PACIENTE SINT');
    await w.find('form[role="search"]').trigger('submit');
    await flushPromises();
    const escolhaPaciente = w.find('[data-testid="manual-paciente-1001"]');
    expect(escolhaPaciente.exists(), JSON.stringify(c.map((x) => x.url))).toBe(true);
    await escolhaPaciente.trigger('click');
    await flushPromises();
    await enviarForm(w, 'form-manual');
    expect(w.find('[data-testid="erros-agravo"]').text()).toContain('agravo');
    await escolher(w, 'manual-cid', 'A90');
    await digitar(w, 'manual-suspeita', 'Comunicado pela unidade básica');
    await enviarForm(w, 'form-manual');
    const p = posts(c)[0]!;
    expect(p.corpo).toEqual({
      origem: 'manual',
      exame: null,
      atendimento: null,
      paciente: 1001,
      cid: 'A90',
      gatilhoEm: '2026-10-27T09:00',
      observacao: 'Comunicado pela unidade básica',
    });
    expect(w.emitted('gravado')?.[0]?.[0]).toMatchObject({ id: 42 });
  });
});

describe('a ficha para impressão', () => {
  it('o modelo com os campos pré-preenchidos e em branco; o aviso da genérica; imprimir', async () => {
    simular(
      rotasPadrao((url) =>
        url === `${R}/casos/41/ficha`
          ? {
              caso: 41,
              modelo: { id: 7, nome: 'FICHA INDIVIDUAL' },
              perguntas: [
                { codigo: 1, subcodigo: 0, texto: 'Nome do paciente', valor: 'PACIENTE SINTETICO UM' },
                { codigo: 2, subcodigo: 0, texto: 'Data dos primeiros sintomas', valor: null },
              ],
              preenchidas: 1,
              generica: true,
            }
          : undefined,
      ),
    );
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const w = montar(FichaAgravoTela, { id: 41 });
    await flushPromises();
    expect(w.find('[data-testid="ficha-modelo"]').text()).toContain('FICHA INDIVIDUAL');
    expect(w.find('[data-testid="ficha-generica"]').exists()).toBe(true);
    expect(w.find('[data-testid="ficha-preenchidas"]').text()).toContain('1 de 2');
    expect(w.find('[data-testid="pergunta-2-0"] td').classes()).toContain('em-branco');
    expect(w.find('[data-testid="ficha-voltar"]').attributes('href')).toBe(
      '/qualidade/vigilancia/agravos?caso=41',
    );
    await clicar(w, 'ficha-imprimir');
    expect(imprimir).toHaveBeenCalledTimes(1);
    imprimir.mockRestore();
  });
});

describe('os exames que disparam a sugestão', () => {
  it('a lista padrão; incluir avisa que a configuração substitui a padrão e grava sem versão', async () => {
    const c = simular(
      rotasPadrao((url, init) => {
        if (url === `${R}/gatilhos-exame` && init?.method === 'POST')
          return { id: 3, versao: 1, criado: true };
        if (url === `${R}/gatilhos-exame`)
          return {
            itens: [
              {
                id: null,
                versao: null,
                padrao: 'VDRL',
                exceto: null,
                cid: 'A53',
                ativo: true,
                fonte: 'padrao',
              },
            ],
          };
        return undefined;
      }),
    );
    const w = montar(GatilhosExame, { podeNotificar: true });
    await flushPromises();
    expect(w.find('[data-testid="exame-0"]').text()).toContain('Lista padrão');
    await clicar(w, 'exame-novo');
    expect(w.find('[data-testid="exames-aviso-padrao"]').exists()).toBe(true);
    await digitar(w, 'exame-padrao', 'Dengue');
    await digitar(w, 'exame-exceto', 'IgG');
    await digitar(w, 'exame-cid', 'a90');
    await enviarForm(w, 'form-exame');
    expect(posts(c)[0]!.corpo).toEqual({
      gatilho: null,
      versao: null,
      padrao: 'Dengue',
      exceto: 'IgG',
      cid: 'A90',
      ativo: true,
    });
    await flushPromises();
    expect(w.find('[data-testid="exames-aviso"]').exists()).toBe(true);
  });

  it('sem a permissão de notificar, só a consulta', async () => {
    simular(rotasPadrao());
    const w = montar(GatilhosExame, { podeNotificar: false });
    await flushPromises();
    expect(w.find('[data-testid="exame-novo"]').exists()).toBe(false);
  });
});
