// @vitest-environment jsdom
// Telas da etapa 2 do M48: a análise (grava com a versão lida; concluída, só leitura), o plano 5W2H (incluir com o
// responsável buscado; concluir exige a evidência), "minhas ações", o painel com as parcelas impressas, a vigilância de
// produto (abre ligada à notificação; expostos só sob demanda; andamento com a versão), as sugestões no formulário do
// "Notificar incidente" (usar manda a origem e o atendimento do registro; dispensar) e o contexto clínico das telas.
// Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, defineComponent, h, nextTick, ref } from 'vue';
import {
  contextoClinico,
  limparContextoClinico,
  usarContextoClinico,
} from '../../casca/notificar/contexto-clinico.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import FormularioNotificacao from './componentes/FormularioNotificacao.vue';
import AnaliseTela from './telas/AnaliseTela.vue';
import AnalisesTela from './telas/AnalisesTela.vue';
import MinhasAcoesTela from './telas/MinhasAcoesTela.vue';
import PainelSegurancaTela from './telas/PainelSegurancaTela.vue';
import TecnovigilanciaDetalheTela from './telas/TecnovigilanciaDetalheTela.vue';
import TecnovigilanciaTela from './telas/TecnovigilanciaTela.vue';

const push = vi.fn();
const rotaAtual = { path: '/qualidade/nsp/analises/7', params: {}, query: {} as Record<string, string> };
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ replace: vi.fn(), push }),
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
      stubs: { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } },
    },
  });

type Resposta = { status?: number; corpo: unknown };
type Rota = (url: string, init?: RequestInit) => Resposta | unknown;
function simular(rota: Rota) {
  const chamadas: { url: string; metodo: string; corpo: unknown; chave: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const hs = new Headers(init?.headers);
      chamadas.push({
        url: String(url),
        metodo: init?.method ?? 'GET',
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
        chave: hs.get('idempotency-key'),
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
const marcar = async (w: ReturnType<typeof mount>, testid: string, rotulo: string) => {
  const l = w.findAll(`[data-testid="${testid}"] label`).find((x) => x.text().includes(rotulo));
  expect(l, `${rotulo} em ${testid}`).toBeTruthy();
  await l!.find('input').setValue(true);
};
const digitar = async (w: ReturnType<typeof mount>, testid: string, texto: string) => {
  await w.find(`[data-testid="${testid}"] textarea, [data-testid="${testid}"] input`).setValue(texto);
};
const clicar = async (w: ReturnType<typeof mount>, testid: string) => {
  await w.find(`[data-testid="${testid}"]`).trigger('click');
  await flushPromises();
};

const notificacao = (x: Record<string, unknown> = {}) => ({
  id: 7,
  protocolo: 'NSP-2026-000007',
  notificadaEm: '2026-10-22T08:40:00',
  ocorridoEm: '2026-10-22T08:30:00',
  tipo: 'queda',
  classificacao: 'eventoAdverso',
  dano: 'moderado',
  situacao: 'distribuida',
  notivisa: 'pendente',
  unidade: 'UNIDADE SINTETICA A',
  comPaciente: true,
  anonima: true,
  proximoPrazo: null,
  versao: 3,
  descricao: 'Paciente sintético escorregou ao sair do leito.',
  local: 'Leito 12',
  chegouAoPaciente: true,
  danoPercebido: 'moderado',
  tipoOutro: null,
  neverEvent: false,
  notificador: null,
  paciente: null,
  gestor: 'SINT.GESTOR',
  prazoAnalise: '2026-12-21',
  prazos: [],
  eventos: [],
  ...x,
});
const acao = (x: Record<string, unknown> = {}) => ({
  id: 31,
  notificacao: 7,
  sequencia: 1,
  oQue: 'Checar a grade a cada ronda',
  porQue: 'Grade abaixada',
  onde: 'Unidade A',
  quando: '2026-11-15',
  quem: 'SINT.NSP',
  como: 'Item no checklist da ronda',
  quanto: null,
  situacao: 'planejada',
  versao: 1,
  texto: null,
  concluidaEm: null,
  eficacia: null,
  eficaciaTexto: null,
  eficaciaEm: null,
  eficaciaPor: null,
  criadaPor: 'SINT.GESTOR',
  criadaEm: '2026-10-22T10:00:00',
  atrasada: false,
  ...x,
});
const PLANO_VAZIO = {
  total: 0,
  abertas: 0,
  atrasadas: 0,
  concluidas: 0,
  canceladas: 0,
  verificadas: 0,
  eficazes: 0,
};
const telaAnalise = (x: Record<string, unknown> = {}) => ({
  notificacao: notificacao(),
  prazoAnalise: '2026-12-21',
  analise: null,
  acoes: [],
  plano: PLANO_VAZIO,
  agora: '2026-10-22T10:00:00',
  gravacao: { ligada: true, motivo: null, acoes: { analisar: true, planejar: true } },
  ...x,
});
const OK = { ok: true, id: 7, versao: 1, mensagem: 'Análise gravada.' };

describe('a lista e a análise de causa', () => {
  it('a lista mostra o prazo vencido e abre a análise', async () => {
    simular(() => ({
      itens: [
        {
          ...notificacao(),
          versao: undefined,
          prazoAnalise: '2026-10-01',
          analiseConcluidaEm: null,
        },
      ],
      temMais: false,
      pagina: 1,
      agora: '2026-10-22T10:00:00',
    }));
    const w = montar(AnalisesTela);
    await flushPromises();
    expect(w.find('[data-testid="analise-vencida-NSP-2026-000007"]').exists()).toBe(true);
    expect(w.find('[data-testid="analise-linha-NSP-2026-000007"]').text()).toContain('01/10/2026');
    w.unmount();
  });

  it('5 porquês: grava com a versão 0 e só as linhas preenchidas; o gestor não vê quem notificou', async () => {
    const chamadas = simular((_url, init) => (init?.method === 'POST' ? OK : telaAnalise()));
    const w = montar(AnaliseTela, { id: '7' });
    await flushPromises();
    expect(w.find('[data-testid="analise-notificacao"]').text()).toContain('Paciente sintético escorregou');
    expect(w.find('[data-testid="analise-paciente"]').text()).toContain('Sem paciente envolvido');
    expect(w.find('[data-testid="analise-ir-notificacao"]').exists()).toBe(false);
    await w.find('[data-testid="form-analise"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="analise-falta"]').exists()).toBe(true);
    await digitar(w, 'analise-porque-0', 'Paciente caiu ao levantar');
    await digitar(w, 'analise-porque-1', 'Grade abaixada no plantão');
    await clicar(w, 'analise-mais-porque');
    expect(w.find('[data-testid="analise-proposta"]').text()).toContain('Grade abaixada no plantão');
    await marcar(w, 'analise-fatores', 'Equipe');
    await w.find('[data-testid="form-analise"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.url).toBe('/api/qualidade/analises/7');
    expect(post?.corpo).toMatchObject({
      notificacao: 7,
      versao: 0,
      conteudo: {
        metodo: 'cincoPorques',
        porques: ['Paciente caiu ao levantar', 'Grade abaixada no plantão'],
      },
      fatores: ['equipe'],
      concluir: false,
    });
    expect(post?.chave).toMatch(/^m48\.analise\./);
    expect(w.find('[data-testid="analise-feito"]').text()).toBe('Análise gravada.');
    w.unmount();
  });

  it('concluir sem ação pede a justificativa; a recusa do domínio tem o texto da análise', async () => {
    const chamadas = simular((_url, init) =>
      init?.method === 'POST'
        ? {
            status: 409,
            corpo: { type: 'recusa-de-negocio', title: 'x', status: 409, codigo: 'versao-desatualizada' },
          }
        : telaAnalise(),
    );
    const w = montar(AnaliseTela, { id: '7' });
    await flushPromises();
    await digitar(w, 'analise-porque-0', 'Paciente caiu ao levantar');
    await w.find('[data-testid="analise-concluir"]').setValue(true);
    expect(w.find('[data-testid="analise-sem-acao"]').exists()).toBe(true);
    await digitar(w, 'analise-sem-acao', 'Circunstância já corrigida.');
    await w.find('[data-testid="form-analise"]').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.metodo === 'POST')?.corpo).toMatchObject({
      concluir: true,
      semAcaoJustificativa: 'Circunstância já corrigida.',
    });
    expect(w.find('[data-testid="recusa-qualidade"]').text()).toContain('alterou a análise ou o plano');
    w.unmount();
  });

  it('concluída: só leitura, e o plano continua (concluir a ação exige a evidência e vai com a versão)', async () => {
    const chamadas = simular((_url, init) =>
      init?.method === 'POST'
        ? { ...OK, mensagem: 'Plano de ação atualizado.' }
        : telaAnalise({
            notificacao: notificacao({ situacao: 'concluida' }),
            analise: {
              id: 1,
              notificacao: 7,
              metodo: 'ishikawa',
              conteudo: { metodo: 'ishikawa', causas: [{ categoria: 'maquina', texto: 'Cama sem trava' }] },
              causaRaiz: 'Manutenção preventiva ausente',
              fatores: ['organizacao'],
              licoes: null,
              semAcaoJustificativa: null,
              situacao: 'concluida',
              versao: 2,
              registradaPor: 'SINT.GESTOR',
              registradaEm: '2026-10-22T09:00:00',
              atualizadaEm: null,
              concluidaEm: '2026-10-23T09:00:00',
              concluidaPor: 'SINT.GESTOR',
            },
            acoes: [acao({ situacao: 'emAndamento', versao: 2, atrasada: true })],
            plano: { ...PLANO_VAZIO, total: 1, abertas: 1, atrasadas: 1 },
            gravacao: { ligada: true, motivo: null, acoes: { analisar: false, planejar: true } },
          }),
    );
    const w = montar(AnaliseTela, { id: '7' });
    await flushPromises();
    expect(w.find('[data-testid="form-analise"]').exists()).toBe(false);
    expect(w.find('[data-testid="analise-leitura"]').text()).toContain('Cama sem trava');
    expect(w.find('[data-testid="analise-concluida"]').exists()).toBe(true);
    expect(w.find('[data-testid="plano-resumo"]').text()).toContain('atrasadas: 1');
    expect(w.find('[data-testid="acao-atrasada-1"]').exists()).toBe(true);
    await clicar(w, 'acao-concluir-1');
    await w.find('[data-testid="form-plano"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="plano-falta"]').exists()).toBe(true);
    await digitar(w, 'plano-texto', 'Checklist da ronda publicado.');
    await w.find('[data-testid="form-plano"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.url).toBe('/api/qualidade/analises/7/acoes');
    expect(post?.corpo).toEqual({
      tipo: 'situacao',
      notificacao: 7,
      id: 31,
      versao: 2,
      situacao: 'concluida',
      texto: 'Checklist da ronda publicado.',
    });
    w.unmount();
  });

  it('incluir a ação: o responsável vem da busca de contas ativas', async () => {
    const chamadas = simular((url, init) => {
      if (url.includes('/acoes/responsaveis'))
        return { itens: [{ login: 'SINT.NSP', nome: 'NSP SINTETICO' }] };
      if (init?.method === 'POST') return { ...OK, mensagem: 'Plano de ação atualizado.' };
      return telaAnalise();
    });
    const w = montar(AnaliseTela, { id: '7' });
    await flushPromises();
    await clicar(w, 'plano-incluir');
    await digitar(w, 'plano-oque', 'Checar a grade a cada ronda');
    await digitar(w, 'plano-porque', 'Grade abaixada no plantão');
    await digitar(w, 'plano-onde', 'Unidade A');
    await digitar(w, 'plano-como', 'Item novo no checklist da ronda');
    await w.find('[data-testid="plano-quando"] input').setValue('15/11/2026');
    await w.find('[data-testid="plano-quando"] input').trigger('blur');
    await digitar(w, 'plano-busca', 'nsp');
    await clicar(w, 'plano-buscar');
    expect(chamadas.some((c) => c.url === '/api/qualidade/acoes/responsaveis?busca=nsp')).toBe(true);
    await escolher(w, 'plano-quem', 'SINT.NSP');
    await w.find('[data-testid="form-plano"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.corpo).toMatchObject({
      tipo: 'incluir',
      notificacao: 7,
      acao: { oQue: 'Checar a grade a cada ronda', quem: 'SINT.NSP', quanto: null },
    });
    expect(w.find('[data-testid="plano-feito"]').exists()).toBe(true);
    w.unmount();
  });
});

describe('minhas ações e o painel', () => {
  it('minhas ações pelo prazo, com a marca de atrasada', async () => {
    simular(() => ({
      itens: [
        acao({ id: 2, quando: '2026-12-01', oQue: 'Segunda ação sintética' }),
        acao({ id: 1, quando: '2026-10-01', atrasada: true }),
      ],
      agora: '2026-10-22T10:00:00',
    }));
    const w = montar(MinhasAcoesTela);
    await flushPromises();
    const linhas = w.findAll('[data-testid="tabela-minhas"] tbody tr');
    expect(linhas.map((l) => l.attributes('data-testid'))).toEqual(['minha-1', 'minha-2']);
    expect(linhas[0]?.text()).toContain('Atrasada');
    w.unmount();
  });

  it('o painel imprime as parcelas e compara com a meta em texto; o período vai na consulta', async () => {
    const ind = (
      codigo: string,
      numerador: number,
      denominador: number,
      percentual: number | null,
      meta: number | null,
    ) => ({
      codigo,
      titulo: `Indicador ${codigo}`,
      numerador,
      denominador,
      percentual,
      meta,
      fonte: 'Fonte sintética',
    });
    const chamadas = simular(() => ({
      painel: {
        periodo: { de: '2026-09-23', ate: '2026-10-22' },
        notificacoes: {
          total: 9,
          anonimas: 4,
          obitos: 0,
          neverEvents: 0,
          descartadas: 1,
          porTipo: [{ codigo: 'queda', rotulo: 'Queda', quantidade: 9 }],
          porClassificacao: [{ codigo: 'eventoAdverso', rotulo: 'Evento adverso', quantidade: 9 }],
        },
        analises: {
          comPrazo: 2,
          concluidas: 1,
          vencidas: 0,
          noPrazo: ind('analise-no-prazo', 1, 2, 50, null),
        },
        acoes: {
          abertas: 3,
          atrasadas: 1,
          concluidas: 2,
          canceladas: 0,
          eficacia: ind('acao-eficaz', 0, 0, null, null),
        },
        adesao: [ind('meta1-pulseira', 12, 40, 30, 95)],
        protocolosGerenciados: [],
        protocolosCortados: false,
        historicoRiscos: [{ ano: 2019, registros: 120 }],
      },
      agora: '2026-10-22T10:00:00',
    }));
    const w = montar(PainelSegurancaTela);
    await flushPromises();
    expect(w.find('[data-testid="indicador-meta1-pulseira"]').text()).toContain('12 de 40 (30,0%)');
    expect(w.find('[data-testid="indicador-meta1-pulseira"]').text()).toContain('abaixo da meta');
    expect(w.find('[data-testid="indicador-acao-eficaz"]').text()).toContain('0 de 0 (sem dado no período)');
    expect(w.find('[data-testid="painel-sem-protocolos"]').exists()).toBe(true);
    expect(w.find('[data-testid="painel-periodo"]').text()).toContain('23/09/2026 a 22/10/2026');
    expect(w.find('[data-testid="painel-historico"]').text()).toContain('120');
    expect(chamadas[0]?.url).toBe('/api/qualidade/nsp/painel');
    w.unmount();
  });
});

const registro = (x: Record<string, unknown> = {}) => ({
  id: 3,
  area: 'tecnovigilancia',
  tipo: 'queixaTecnica',
  item: 55,
  produto: null,
  lote: 'L-01',
  serie: null,
  fabricante: 'FABRICANTE SINTETICO',
  registroAnvisa: null,
  descricao: 'Equipo sintético com vazamento na conexão.',
  notificacao: 7,
  alerta: null,
  conduta: 'nenhuma',
  situacao: 'aberta',
  notivisaNumero: null,
  versao: 1,
  registradaPor: 'SINT.NSP',
  registradaEm: '2026-10-22T10:00:00',
  atualizadaEm: null,
  encerradaEm: null,
  itemNome: 'EQUIPO SINTETICO',
  ...x,
});
const GRAV_VIG = { ligada: true, motivo: null, registrar: true };

describe('a vigilância de produto', () => {
  it('vindo da análise, o registro nasce ligado à notificação; o produto vem da busca', async () => {
    rotaAtual.query = { notificacao: '7', protocolo: 'NSP-2026-000007' };
    const chamadas = simular((url, init) => {
      if (url.includes('/tecnovigilancia/itens'))
        return { itens: [{ codigo: 55, nome: 'EQUIPO SINTETICO' }] };
      if (init?.method === 'POST') return { ok: true, id: 3, versao: 1, mensagem: 'Registro aberto.' };
      return { itens: [], temMais: false, pagina: 1, gravacao: GRAV_VIG };
    });
    const w = montar(TecnovigilanciaTela);
    await flushPromises();
    expect(w.find('[data-testid="vig-ligada"]').text()).toContain('NSP-2026-000007');
    await escolher(w, 'vig-tipo', 'queixaTecnica');
    await digitar(w, 'vig-busca', 'equipo');
    await clicar(w, 'vig-buscar');
    await escolher(w, 'vig-item', '55');
    await digitar(w, 'vig-lote', 'L-01');
    await digitar(w, 'vig-descricao', 'Equipo sintético com vazamento na conexão.');
    await w.find('[data-testid="form-vigilancia"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.url).toBe('/api/qualidade/tecnovigilancia');
    expect(post?.corpo).toMatchObject({
      acao: 'abrir',
      item: 55,
      lote: 'L-01',
      notificacao: 7,
      produto: null,
    });
    expect(push).toHaveBeenCalledWith('/qualidade/nsp/tecnovigilancia/3');
    w.unmount();
  });

  it('o detalhe: expostos só sob demanda (só números) e o andamento com a versão', async () => {
    const chamadas = simular((url, init) => {
      if (url.endsWith('/expostos'))
        return {
          item: 55,
          itemNome: 'EQUIPO SINTETICO',
          lote: 'L-01',
          expostos: [
            { origem: 'estoque', data: '2026-10-20', atendimento: 48001, paciente: 99, quantidade: 2 },
          ],
          cortada: false,
        };
      if (init?.method === 'POST') return { ok: true, id: 3, versao: 2, mensagem: 'Andamento registrado.' };
      return {
        registro: registro(),
        eventos: [
          { em: '2026-10-22T10:00:00', por: 'SINT.NSP', situacao: 'aberta', conduta: 'nenhuma', texto: null },
        ],
        protocoloNotificacao: 'NSP-2026-000007',
        calculaExpostos: true,
        gravacao: GRAV_VIG,
      };
    });
    const w = montar(TecnovigilanciaDetalheTela, { id: '3' });
    await flushPromises();
    expect(chamadas.some((c) => c.url.endsWith('/expostos'))).toBe(false);
    await clicar(w, 'vigd-ver-expostos');
    expect(w.find('[data-testid="vigd-tabela-expostos"]').text()).toContain('48001');
    expect(w.find('[data-testid="vigd-tabela-expostos"]').text()).toContain('Saída do estoque');
    await escolher(w, 'vigd-nova-situacao', 'emInvestigacao');
    await escolher(w, 'vigd-conduta', 'segregado');
    await digitar(w, 'vigd-texto', 'Lote segregado para investigação.');
    await w.find('[data-testid="form-andamento"]').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.metodo === 'POST')).toMatchObject({
      url: '/api/qualidade/tecnovigilancia/3/andamento',
      corpo: { acao: 'andamento', id: 3, versao: 1, situacao: 'emInvestigacao', conduta: 'segregado' },
    });
    w.unmount();
  });

  it('encerrado não tem andamento', async () => {
    simular(() => ({
      registro: registro({ situacao: 'encerrada' }),
      eventos: [],
      protocoloNotificacao: null,
      calculaExpostos: false,
      gravacao: { ...GRAV_VIG, registrar: false },
    }));
    const w = montar(TecnovigilanciaDetalheTela, { id: '3' });
    await flushPromises();
    expect(w.find('[data-testid="vigd-encerrado"]').exists()).toBe(true);
    expect(w.find('[data-testid="form-andamento"]').exists()).toBe(false);
    expect(w.find('[data-testid="vigd-ver-expostos"]').exists()).toBe(false);
    w.unmount();
  });
});

describe('as sugestões no "Notificar incidente"', () => {
  const FORMULARIO = {
    ligada: true,
    motivo: null,
    unidades: [{ codigo: 3, nome: 'UNIDADE SINTETICA A' }],
    anonimaPermitida: true,
    agora: '2026-10-22T09:00:00',
  };
  const SUGESTAO = {
    origem: 'omitida:7',
    fonte: 'omitida',
    tipo: 'medicacao',
    titulo: 'Dose não administrada na checagem',
    quando: '2026-10-21T10:05:00',
    atendimento: 48002,
    chegouAoPaciente: false,
    descricao: 'Dose não administrada por falta do item.',
  };
  it('usar a sugestão manda a origem e o atendimento do registro (não o da tela)', async () => {
    const chamadas = simular((url, init) => {
      if (url.endsWith('/formulario')) return FORMULARIO;
      if (url.endsWith('/sugestoes')) return { ligada: true, itens: [SUGESTAO], agora: FORMULARIO.agora };
      if (init?.method === 'POST')
        return { protocolo: 'NSP-2026-000009', codigoAcompanhamento: 'ABCDEFGH23', repetida: false };
      return {};
    });
    const w = montar(FormularioNotificacao);
    await flushPromises();
    await clicar(w, 'sugestao-usar-omitida:7');
    expect(w.find('[data-testid="notificar-sugestao"]').text()).toContain(
      'Dose não administrada na checagem',
    );
    expect(w.find('[data-testid="notificar-paciente"]').text()).toContain('Atendimento 48002');
    // A anônima a partir da sugestão avisa que o paciente pode indicar quem registrou (regra 1).
    expect(w.find('[data-testid="notificar-anonima-sugestao"]').exists()).toBe(false);
    await w.find('[data-testid="notificar-anonima"]').setValue(true);
    expect(w.find('[data-testid="notificar-anonima-sugestao"]').text()).toContain('Sem paciente');
    await w.find('[data-testid="notificar-anonima"]').setValue(false);
    await w.find('form').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.corpo).toMatchObject({
      atendimento: 48002,
      tipo: 'medicacao',
      chegouAoPaciente: false,
      danoPercebido: 'nenhum',
      ocorridoEm: '2026-10-21T10:05',
      origem: { sugestao: 'omitida:7' },
    });
    w.unmount();
  });

  it('"Não é incidente" dispensa a sugestão', async () => {
    let dispensada = false;
    const chamadas = simular((url, init) => {
      if (url.endsWith('/formulario')) return FORMULARIO;
      if (url.endsWith('/sugestoes/dispensar') && init?.method === 'POST') {
        dispensada = true;
        return { ok: true, mensagem: 'Sugestão dispensada.' };
      }
      if (url.endsWith('/sugestoes'))
        return { ligada: true, itens: dispensada ? [] : [SUGESTAO], agora: FORMULARIO.agora };
      return {};
    });
    const w = montar(FormularioNotificacao);
    await flushPromises();
    await clicar(w, 'sugestao-dispensar-omitida:7');
    await flushPromises();
    expect(chamadas.find((c) => c.metodo === 'POST')?.corpo).toEqual({ origem: 'omitida:7' });
    expect(w.find('[data-testid="sugestao-dispensada"]').exists()).toBe(true);
    expect(w.find('[data-testid="sugestao-omitida:7"]').exists()).toBe(false);
    w.unmount();
  });
});

describe('o contexto clínico das telas (D-CONTEXTO-48.2)', () => {
  it('acompanha o atendimento da tela e é solto quando ela sai', async () => {
    const atendimento = ref<number | null>(48001);
    const Tela = defineComponent({
      setup() {
        usarContextoClinico(() =>
          atendimento.value === null
            ? null
            : { atendimento: atendimento.value, rotulo: 'PACIENTE SINTETICO' },
        );
        return () => h('div');
      },
    });
    const w = mount(Tela);
    expect(contextoClinico.value).toEqual({ atendimento: 48001, rotulo: 'PACIENTE SINTETICO' });
    atendimento.value = 48002;
    await nextTick();
    expect(contextoClinico.value?.atendimento).toBe(48002);
    atendimento.value = null;
    await nextTick();
    expect(contextoClinico.value).toBeNull();
    atendimento.value = 48003;
    await nextTick();
    w.unmount();
    expect(contextoClinico.value).toBeNull();
  });
});
