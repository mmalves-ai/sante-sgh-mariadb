// @vitest-environment jsdom
// W0-05, revisão (testes de componente; dados SINTÉTICOS, fetch simulado):
// - TerapiaNutricionalTela (a ficha EMTN): o cartão do paciente e as abas; com a única meta ENCERRADA, a meta encerrada
//   (quem, quando, o motivo) e o histórico do acompanhamento com os dias retificado e estornado continuam na tela e no
//   que se imprime (as abas são painéis que a impressão junta; as ações ficam no que não se imprime); o "Imprimir"
//   chama a impressão do navegador; retificar e estornar o dia só aparecem para o próprio autor; a avaliação da NPT tem
//   a observação com rótulo próprio e a justificativa (o motivo) com outro rótulo, não dois "Parecer";
// - OncologiaTela: o ciclo ajustado mostra a versão anterior (data, redução e doses) riscada e inativa, fora do que a
//   impressão esconde;
// - FilaNutricaoTela: "Histórico" leva o foco ao título do painel (e fechar devolve o foco ao botão da linha).
import { urnProblema } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import OncologiaTela from '../../especialidades/telas/OncologiaTela.vue';
import FilaNutricaoTela from './FilaNutricaoTela.vue';
import TerapiaNutricionalTela from './TerapiaNutricionalTela.vue';

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}
const GRAVACAO = (ops: Record<string, boolean>) => ({
  ligada: true,
  motivo: null,
  operacoes: Object.fromEntries(Object.entries(ops).map(([k, v]) => [k, { pode: v, motivo: null }])),
  categoria: 'nutricao',
});

async function montar(
  tela: Component,
  caminho: string,
  rota: string,
  respostas: Record<string, unknown>,
  login = 'SINT.NUTRI',
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url).split('?')[0]!;
      const chave = Object.keys(respostas).find((k) => u.endsWith(k));
      if (chave) return json(respostas[chave]);
      return json({ type: urnProblema('nao-encontrado'), title: 'x', status: 404 }, 404);
    }),
  );
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 600_000 } } });
  cliente.setQueryData(CHAVE_SESSAO, { usuario: { id: login, login }, permissoes: [] });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: rota, component: tela }] });
  await router.push(caminho);
  await router.isReady();
  const w = mount(tela, {
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: cliente }],
        router,
      ] as never,
    },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const COR = (acao: string, motivo: string, por = 'SINT.NUTRI') => ({
  acao,
  idNovo: null,
  motivo,
  por,
  em: '2026-11-17T12:00',
});
const META = {
  id: 10,
  via: 'enteral',
  itemDieta: null,
  pesoKg: 60,
  kcalPorKg: 25,
  proteinaGPorKg: 1,
  metaKcal: 1500,
  metaProteinaG: 60,
  densidadeKcalMl: 1,
  proteinaGL: 40,
  metaVolumeMl: 1500,
  por: 'SINT.NUTRI',
  em: '2026-11-14T10:00',
  origemTerapia: 'informada',
  observacao: null,
  situacao: 'encerrada',
  correcao: COR('encerramento', 'Alta da terapia enteral (sintético)'),
  substitui: null,
  avaliacaoNpt: null,
};
const DIA = (id: number, data: string, situacao: string, correcao: unknown, por = 'SINT.NUTRI') => ({
  id,
  meta: 10,
  data,
  volumePrescritoMl: null,
  volumeInfundidoMl: 1000,
  origemVolume: 'informado',
  kcalAtingida: 1000,
  proteinaAtingidaG: 40,
  pctKcal: 66.7,
  pctProteina: 66.7,
  motivo: 'progressao',
  observacao: null,
  por,
  em: `${data}T10:00`,
  situacao,
  correcao,
  substitui: null,
});
const TERAPIA = {
  internacao: 950_002,
  paciente: 99_502,
  nome: 'ANA SINTETICA COSTA',
  leito: { bloco: '2A', acomodacao: '201', leito: 'A' },
  admissao: '2026-11-13T08:00',
  dietas: [],
  metas: [META],
  acompanhamentos: [
    DIA(21, '2026-11-15', 'retificado', { ...COR('retificacao', 'Volume digitado errado'), idNovo: 24 }),
    DIA(22, '2026-11-16', 'estornado', COR('estorno', 'Dia lançado no paciente errado')),
    DIA(23, '2026-11-17', 'ativo', null, 'SINT.OUTRA.NUTRI'),
    DIA(24, '2026-11-15', 'ativo', null),
  ],
  checagens: [],
  horasAteIniciar: null,
  fichas: { quantidade: 0, ultima: null },
  metaAdequadaPct: 80,
  progresso: [],
  alerta: null,
  balanco: [],
  nptOrigem: 'ficha-emtn',
  lidoEm: '2026-11-18T09:00',
};

describe('TerapiaNutricionalTela (ficha EMTN)', () => {
  const abrir = (t: unknown = TERAPIA) =>
    montar(TerapiaNutricionalTela, '/nutricao/terapia/950002', '/nutricao/terapia/:reg', {
      '/api/nutricao/gravacao': GRAVACAO({ terapia: true, avaliarNpt: true }),
      '/api/nutricao/terapias/950002': t,
    });

  it('a única meta encerrada e o histórico (retificado, estornado) continuam visíveis e no que se imprime', async () => {
    const w = await abrir();
    // O cartão do paciente e as abas.
    expect(w.find('[data-testid="terapia-perfil"] h1').text()).toBe('ANA SINTETICA COSTA');
    expect(w.findAll('[role="tab"]').map((a) => a.attributes('id'))).toEqual([
      'terapia-aba-meta',
      'terapia-aba-progresso',
      'terapia-aba-acompanhamento',
    ]);
    // Sem meta vigente: a versão encerrada (quem, quando, o motivo) continua listada.
    expect(w.find('[data-testid="terapia-sem-meta"]').exists()).toBe(true);
    const versoes = w.find('[data-testid="terapia-versoes"]');
    expect(versoes.exists()).toBe(true);
    const enc = versoes.find('[data-situacao="encerrada"]');
    expect(enc.text()).toMatch(/Encerrada/);
    expect(enc.text()).toMatch(/SINT\.NUTRI/);
    expect(enc.text()).toMatch(/Alta da terapia enteral/);
    expect(enc.classes()).toContain('inativo');
    // O histórico do dia está no DOM (painel da aba, que a impressão mostra), com o retificado e o estornado.
    const hist = w.find('[data-testid="terapia-acompanhamentos"]');
    expect(hist.exists()).toBe(true);
    expect(hist.find('[data-situacao="retificado"]').text()).toMatch(/Volume digitado errado/);
    expect(hist.find('[data-situacao="estornado"]').text()).toMatch(/Dia lançado no paciente errado/);
    const painel = hist.element.closest('[role="tabpanel"]')!;
    expect(painel.classList.contains('painel-aba')).toBe(true);
    expect(painel.closest('.nao-imprimir')).toBeNull();
    expect(w.find('[data-testid="tela-terapia-nutricional"]').classes()).toContain('tela-correcoes');
    // Sem meta vigente, nada de formulário do dia, mas o aviso.
    expect(w.find('[data-testid="terapia-dia-sem-meta"]').exists()).toBe(true);
    // O Imprimir chama a impressão do navegador; as ações ficam fora do que se imprime.
    const imprimir = vi.fn();
    window.print = imprimir;
    await w.find('[data-testid="terapia-imprimir"]').trigger('click');
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(w.find('[data-testid="terapia-imprimir"]').element.closest('.nao-imprimir')).not.toBeNull();
    w.unmount();
  });

  it('retificar e estornar o dia só para o próprio autor; as abas mudam pelo teclado', async () => {
    const w = await abrir({ ...TERAPIA, metas: [{ ...META, situacao: 'vigente', correcao: null }] });
    const do23 = w.find('[data-testid="acompanhamento-23"]');
    const do24 = w.find('[data-testid="acompanhamento-24"]');
    expect(do23.find('[data-testid="acompanhamento-estornar"]').exists()).toBe(false);
    expect(do23.find('[data-testid="acompanhamento-retificar"]').exists()).toBe(false);
    expect(do24.find('[data-testid="acompanhamento-estornar"]').exists()).toBe(true);
    expect(do24.find('[data-testid="acompanhamento-retificar"]').exists()).toBe(true);
    expect(do24.find('.acoes-linha').classes()).toContain('nao-imprimir');
    // Teclado: a seta leva à aba seguinte.
    await w.find('#terapia-aba-meta').trigger('keydown', { key: 'ArrowRight' });
    expect(w.find('#terapia-aba-progresso').attributes('aria-selected')).toBe('true');
    w.unmount();
  });

  it('a avaliação da NPT: a observação tem rótulo próprio; o motivo é a justificativa (sem dois "Parecer")', async () => {
    const npt = { ...META, via: 'parenteral', situacao: 'vigente', correcao: null };
    const w = await abrir({ ...TERAPIA, metas: [npt], acompanhamentos: [] });
    await w.find('[data-testid="npt-avaliar"]').trigger('click');
    await flushPromises();
    const rotulos = [
      ...document.querySelectorAll(
        '[data-testid="form-correcao"] label, [data-testid="form-correcao"] .sgh-selecao__rotulo',
      ),
    ].map((l) => (l.textContent ?? '').trim());
    expect(rotulos.filter((r) => r === 'Parecer')).toHaveLength(1);
    expect(rotulos).toContain('Justificativa da avaliação');
    expect(rotulos.some((r) => r.startsWith('Observação do parecer'))).toBe(true);
    // Os campos do diálogo (montado no body) levam o atributo do slot: o estilo do diálogo os alcança.
    const osm = document.querySelector('#npt-osm')!;
    expect([...osm.attributes].some((a) => /^data-v-.+-s$/.test(a.name))).toBe(true);
    w.unmount();
  });
});

const DOSE = {
  farmaco: 'Paclitaxel',
  via: 'iv',
  dias: [1],
  prescrita: 80,
  unidade: 'mg/m2',
  base: 1.82,
  calculada: 145.6,
  final: 116.5,
  conta: '80 × 1,82 − 20%',
};
const ONCO = {
  internacao: {
    internacao: 950_102,
    paciente: 99_602,
    prontuario: 7_002,
    nome: 'BRUNO SINTETICO LIMA',
    nascimento: '1970-05-02',
    idade: 56,
    sexo: 'M',
    leito: { bloco: '3B', acomodacao: '301', leito: 'B' },
    admissao: '2026-11-10T08:00',
    aberta: true,
  },
  protocolos: [],
  ciclos: [
    {
      id: 5,
      protocolo: { id: 1, codigo: 'SINT-PAC', versao: 1, nome: 'Paclitaxel semanal SINTETICO' },
      numero: 1,
      dataPrevista: '2026-11-17',
      pesoKg: 70,
      alturaCm: 170,
      superficieM2: 1.82,
      creatininaMgDl: null,
      clearanceMlMin: null,
      reducaoPct: 20,
      motivoReducao: 'Neutropenia grau 2',
      justificativaIntervalo: null,
      doses: [DOSE],
      situacao: 'prescrito',
      por: 'SINT.MED',
      em: '2026-11-15T10:00',
      validadoPor: null,
      validadoEm: null,
      curso: 1,
      motivoCurso: null,
      prescricoes: [],
      andamento: 'ativo',
      eventos: [
        {
          id: 70,
          evento: 'ciclo-ajustado',
          categoria: null,
          prescricao: null,
          ciclosAfetados: null,
          antes: {
            dataPrevista: '2026-11-16',
            reducaoPct: 0,
            motivoReducao: null,
            justificativaIntervalo: null,
            doses: [{ farmaco: 'Paclitaxel', final: 145.6 }],
          },
          motivo: 'Redução por toxicidade hematológica',
          por: 'SINT.MED',
          em: '2026-11-16T09:00',
        },
      ],
    },
  ],
};

describe('OncologiaTela (o ciclo ajustado é nova versão)', () => {
  it('a versão anterior (data, redução e doses) aparece riscada e inativa, e fica no que se imprime', async () => {
    const w = await montar(
      OncologiaTela,
      '/pep/especialidades/oncologia/950102',
      '/pep/especialidades/oncologia/:reg',
      {
        '/api/especialidades/oncologia/gravacao': GRAVACAO({ registrar: true }),
        '/api/especialidades/oncologia/internacoes/950102': ONCO,
      },
    );
    expect(w.find('[data-testid="esp-cabecalho"] h1').text()).toBe('BRUNO SINTETICO LIMA');
    const v = w.find('[data-testid="ciclo-versao-70"]');
    expect(v.exists()).toBe(true);
    expect(v.classes()).toContain('inativo');
    expect(v.attributes('data-situacao')).toBe('substituida');
    expect(v.text()).toMatch(/Versão anterior \(inativa\)/);
    expect(v.text()).toMatch(/16\/11\/2026/);
    expect(v.text()).toMatch(/redução de 0%/);
    expect(v.text()).toMatch(/Paclitaxel: 145,6 mg/);
    expect(v.text()).toMatch(/SINT\.MED: Redução por toxicidade hematológica/);
    expect(v.find('.riscado').exists()).toBe(true);
    expect(v.element.closest('.nao-imprimir')).toBeNull();
    // A versão vigente continua com as doses novas.
    expect(w.find('[data-testid="ciclo-5"]').text()).toMatch(/116,5 mg/);
    w.unmount();
  });
});

const FILA = {
  itens: [950_001, 950_002, 950_003].map((reg, i) => ({
    internacao: reg,
    paciente: 99_500 + i,
    nome: `PACIENTE SINTETICO ${i + 1}`,
    leito: { bloco: '2A', acomodacao: `20${i}`, leito: 'A' },
    unidade: '2A',
    admissao: '2026-11-17T08:00',
    horasDesdeAdmissao: 25,
    prazoEm: '2026-11-19T08:00',
    preferencialEm: '2026-11-18T08:00',
    situacao: 'atencao',
    intensiva: false,
    idade: 50,
    ultima: null,
    emTerapia: false,
  })),
  contagens: { 'a-triar': 0, atencao: 3, vencida: 0, triado: 0, reavaliar: 0 },
  indicadores: { admitidos: 3, triados24h: 0, triados48h: 0 },
  cortada: false,
  prazoHoras: 48,
  preferencialHoras: 24,
  lidoEm: '2026-11-18T09:00',
};

describe('FilaNutricaoTela (o histórico com o foco)', () => {
  it('"Histórico" leva o foco ao título do painel; fechar devolve o foco ao botão da linha', async () => {
    const w = await montar(FilaNutricaoTela, '/nutricao/triagem', '/nutricao/triagem', {
      '/api/nutricao/gravacao': GRAVACAO({ triar: true }),
      '/api/nutricao/fila': FILA,
      '/api/nutricao/internacoes/950002/triagens': { itens: [] },
    });
    const botao = w.find('[data-testid="historico-950002"]');
    expect(botao.exists()).toBe(true);
    (botao.element as HTMLElement).focus();
    await botao.trigger('click');
    await flushPromises();
    const titulo = document.querySelector<HTMLElement>('[data-testid="triagens-titulo"]')!;
    expect(titulo).not.toBeNull();
    expect(titulo.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(titulo);
    await w.find('[data-testid="triagens-fechar"]').trigger('click');
    await flushPromises();
    expect(document.querySelector('[data-testid="triagens-titulo"]')).toBeNull();
    expect((document.activeElement as HTMLElement | null)?.getAttribute('data-testid')).toBe(
      'historico-950002',
    );
    w.unmount();
  });
});
