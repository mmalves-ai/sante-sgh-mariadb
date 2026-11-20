// @vitest-environment jsdom
// Telas da CCIH (M48, etapa 3): a vigilância (resumo, filtro, ficha do internado e o registro do dispositivo com a
// chave de idempotência), a ficha de IRAS (critérios do sítio, entrada limpa), os denominadores com as contas e o censo
// incompleto, a fila do antimicrobiano (decidir e o consumo com as parcelas), as precauções (aerossóis exigem o bloqueio;
// vizinhos ocupados em alerta; encerrar com a versão lida), a observação das mãos no tablet, os surtos, o alerta ao
// prescritor e a CCIH desligada. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { definirSessaoDaTela } from '../../../casca/sessao/pode.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import AlertaAntimicrobiano from './componentes/AlertaAntimicrobiano.vue';
import PrecaucaoNoCabecalho from './componentes/PrecaucaoNoCabecalho.vue';
import AntimicrobianosTela from './telas/AntimicrobianosTela.vue';
import IrasTela from './telas/IrasTela.vue';
import MaosSurtosTela from './telas/MaosSurtosTela.vue';
import PrecaucoesTela from './telas/PrecaucoesTela.vue';
import VigilanciaTela from './telas/VigilanciaTela.vue';

vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/qualidade/ccih/vigilancia', params: {}, query: {} }),
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
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
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
  const i = w.find(`[data-testid="${testid}"] textarea, [data-testid="${testid}"] input`);
  await i.setValue(texto);
  await i.trigger('blur');
};
const clicar = async (w: ReturnType<typeof mount>, testid: string) => {
  await w.find(`[data-testid="${testid}"]`).trigger('click');
  await flushPromises();
};
const ultimoPost = (c: ReturnType<typeof simular>) => c.filter((x) => x.metodo === 'POST').at(-1);

const TODAS = [
  'qualidade.ccih.ler',
  'qualidade.ccih.registrar',
  'qualidade.iras.ler',
  'qualidade.iras.registrar',
  'qualidade.antimicrobiano.ler',
  'qualidade.antimicrobiano.liberar',
  'qualidade.precaucao.ler',
  'qualidade.precaucao.definir',
];
const FORMULARIO = (ligada = true) => ({
  ligada,
  motivo: ligada ? null : null,
  agora: '2026-10-22T13:00:00',
  prazoLiberacaoHoras: 48,
  unidades: [{ codigo: 1, nome: 'UNIDADE SINTETICA' }],
  tiposSurto: [{ codigo: 2, nome: 'TIPO SINTETICO' }],
  acoes: { registrar: ligada, iras: ligada, liberar: ligada, precaucao: ligada },
});
const VIGILANCIA = {
  agora: '2026-10-22T13:00:00',
  cortada: false,
  resumo: { internados: 3, emVigilancia: 2, semLiberacao: 1, febre: 1, dispositivos: 1 },
  itens: [
    {
      internacao: 4801,
      paciente: 48001,
      nome: 'PACIENTE SINTETICO CCIH',
      prontuario: 480001,
      setor: 'UTI',
      leito: 'UTI 01-A',
      entrada: '2026-10-16',
      motivos: ['antimicrobianoSemLiberacao', 'dispositivo', 'febre'],
      peso: 10,
      dispositivos: [{ id: 5, tipo: 'cvc', dias: 4 }],
      antimicrobianos: [{ nome: 'MEROPENEM SINTETICO', restrito: true, situacao: 'vencida', alerta: true }],
      culturas: [{ id: 9001, exame: 'HEMOCULTURA', data: '2026-10-21', liberado: false }],
      febre: true,
      posOperatorio: false,
      precaucoes: ['contato'],
      iras: 0,
    },
    {
      internacao: 4803,
      paciente: 48003,
      nome: 'TERCEIRO PACIENTE SINTETICO',
      prontuario: 480003,
      setor: 'CM',
      leito: 'CM 201-A',
      entrada: '2026-10-14',
      motivos: ['posOperatorio'],
      peso: 1,
      dispositivos: [],
      antimicrobianos: [],
      culturas: [],
      febre: false,
      posOperatorio: true,
      precaucoes: [],
      iras: 0,
    },
  ],
};
const leito = (l: string) => ({ bloco: 'UTI', acomodacao: '01', leito: l });
const ITEM_FILA = {
  itemPrescricao: 777,
  prescricao: 70,
  internacao: 4801,
  item: 300,
  nome: 'MEROPENEM SINTETICO',
  restrito: true,
  prescritoEm: '2026-10-19T08:00:00',
  inicioTratamento: '2026-10-19',
  situacao: { situacao: 'vencida', venceEm: '2026-10-21T08:00:00', alerta: true },
  liberacao: null,
  revisaoDevida: null,
  ficha: null,
};
const INTERNACAO = (vizinhos = [{ ...leito('B'), ocupado: false }]) => ({
  agora: '2026-10-22T13:00:00',
  internacao: {
    internacao: 4801,
    paciente: 48001,
    nome: 'PACIENTE SINTETICO CCIH',
    prontuario: 480001,
    setor: 'UTI',
    leito: 'UTI 01-A',
    chaveLeito: leito('A'),
    entrada: '2026-10-16',
    aberta: true,
  },
  dispositivos: [
    {
      id: 5,
      reg: 4801,
      setor: 'UTI',
      tipo: 'cvc',
      sitio: 'SUBCLAVIA',
      inseridoEm: '2026-10-19T10:00:00',
      itemPrescricao: null,
      observacao: null,
      retiradoEm: null,
      motivoRetirada: null,
      versao: 1,
      dias: 4,
    },
  ],
  iras: [],
  precaucoes: [],
  antimicrobianos: [ITEM_FILA],
  culturas: [{ id: 9001, reg: 4801, exame: 'HEMOCULTURA', data: '2026-10-21', liberado: false }],
  cirurgias: [],
  temperaturaMaxima48h: 38.6,
  vizinhos,
});
const parcela = (numerador: number, denominador: number, valor: number | null, fator: 1 | 100 | 1000) => ({
  numerador,
  denominador,
  valor,
  fator,
});
const setorDen = (setor: string) => ({
  setor,
  pacientesDia: 100,
  dispositivosDia: { cvc: 40, sondaVesical: 20, ventilacaoMecanica: 10 },
  iras: { ipcs: 1, pav: 0, itu: 0 },
  densidade: {
    ipcs: parcela(1, 40, 25, 1000),
    pav: parcela(0, 10, 0, 1000),
    itu: parcela(0, 20, 0, 1000),
  },
  utilizacao: {
    cvc: parcela(40, 100, 40, 100),
    sondaVesical: parcela(20, 100, 20, 100),
    ventilacaoMecanica: parcela(10, 100, 10, 100),
  },
});

describe('vigilância ativa', () => {
  it('mostra o resumo, filtra por motivo, abre a ficha e registra o dispositivo com a chave', async () => {
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const c = simular((url, init) => {
      if (url.endsWith('/formulario')) return FORMULARIO();
      if (url.endsWith('/vigilancia')) return VIGILANCIA;
      if (url.includes('/internacoes/4801')) return INTERNACAO();
      if (url.endsWith('/dispositivos') && init?.method === 'POST') return { status: 201, corpo: { id: 6 } };
      return { status: 404, corpo: {} };
    });
    const w = montar(VigilanciaTela);
    await flushPromises();
    expect(w.find('[data-testid="vigilancia-resumo"]').text()).toContain('2 em vigilância de 3 internados');
    expect(w.findAll('[data-testid^="vigilancia-48"]')).toHaveLength(2);
    expect(w.find('[data-testid="vigilancia-4801"]').text()).toContain('CVC 4 d');
    expect(w.find('[data-testid="vigilancia-4801"]').text()).toContain('Sem liberação no prazo');

    await escolher(w, 'filtro-motivo', 'posOperatorio');
    expect(w.findAll('[data-testid^="vigilancia-48"]').map((x) => x.attributes('data-testid'))).toEqual([
      'vigilancia-4803',
    ]);
    await escolher(w, 'filtro-motivo', '');

    await clicar(w, 'abrir-4801');
    expect(w.find('[data-testid="ficha-internado"]').exists()).toBe(true);
    expect(w.find('[data-testid="ficha-temperatura"]').text()).toContain('38,6');
    await clicar(w, 'novo-dispositivo');
    await escolher(w, 'dispositivo-tipo', 'sondaVesical');
    await digitar(w, 'dispositivo-data', '22/10/2026');
    await digitar(w, 'dispositivo-hora', '09:15');
    await clicar(w, 'dispositivo-gravar');
    const p = ultimoPost(c);
    expect(p?.url).toBe('/api/qualidade/ccih/dispositivos');
    expect(p?.corpo).toEqual({
      internacao: 4801,
      tipo: 'sondaVesical',
      sitio: null,
      inseridoEm: '2026-10-22T09:15',
      itemPrescricao: null,
      observacao: null,
    });
    expect(p?.chave).toMatch(/^m48c\.dispositivo\./);
    expect(w.find('[data-testid="ficha-aviso"]').exists()).toBe(true);
  });

  it('a retirada acidental mostra a sugestão de notificar o incidente', async () => {
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const c = simular((url, init) => {
      if (url.endsWith('/formulario')) return FORMULARIO();
      if (url.endsWith('/vigilancia')) return VIGILANCIA;
      if (url.includes('/internacoes/4801')) return INTERNACAO();
      if (url.endsWith('/dispositivos/5/retirar') && init?.method === 'POST')
        return { versao: 2, sugerirNotificacao: true };
      return { status: 404, corpo: {} };
    });
    const w = montar(VigilanciaTela);
    await flushPromises();
    await clicar(w, 'abrir-4801');
    await clicar(w, 'retirar-5');
    const f = w.find('[data-testid="form-retirada-5"]');
    const [data, hora] = f.findAll('input');
    await data!.setValue('22/10/2026');
    await data!.trigger('blur');
    await hora!.setValue('11:00');
    await hora!.trigger('blur');
    await escolher(w, 'retirada-motivo', 'acidental');
    await clicar(w, 'retirada-gravar');
    expect(ultimoPost(c)?.corpo).toMatchObject({
      versao: 1,
      retiradoEm: '2026-10-22T11:00',
      motivo: 'acidental',
    });
    expect(w.find('[data-testid="sugerir-notificacao"]').exists()).toBe(true);
  });

  it('com a CCIH desligada a tela avisa e não oferece gravar', async () => {
    definirSessaoDaTela({ permissoes: TODAS } as never);
    simular((url) => {
      if (url.endsWith('/formulario')) return FORMULARIO(false);
      if (url.endsWith('/vigilancia')) return VIGILANCIA;
      if (url.includes('/internacoes/4801')) return INTERNACAO();
      return { status: 404, corpo: {} };
    });
    const w = montar(VigilanciaTela);
    await flushPromises();
    expect(w.find('[data-testid="ccih-desligado"]').exists()).toBe(true);
    await clicar(w, 'abrir-4801');
    expect(w.find('[data-testid="novo-dispositivo"]').exists()).toBe(false);
    expect(w.find('[data-testid="abrir-precaucao"]').exists()).toBe(false);
  });
});

describe('IRAS e denominadores', () => {
  it('denominadores com as contas, censo incompleto e a ficha da IPCS só com os critérios do sítio', async () => {
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const c = simular((url, init) => {
      if (url.endsWith('/formulario')) return FORMULARIO();
      if (url.includes('/denominadores'))
        return {
          competencia: '2026-10',
          setores: [setorDen('UTI'), setorDen('CM')],
          todos: setorDen('todos'),
          censo: { diasFechados: 15, diasTerminados: 21, completo: false },
          cortada: false,
        };
      if (url.includes('/iras?')) return { competencia: '2026-10', itens: [], cortada: false };
      if (url.endsWith('/internados'))
        return {
          itens: [
            {
              internacao: 4801,
              nome: 'PACIENTE SINTETICO CCIH',
              prontuario: 480001,
              setor: 'UTI',
              leito: 'UTI 01-A',
              entrada: '2026-10-16',
            },
          ],
          cortada: false,
        };
      if (url.includes('/internacoes/4801')) return INTERNACAO();
      if (url.endsWith('/iras') && init?.method === 'POST')
        return { status: 201, corpo: { id: 31, dispositivoAssociado: 5 } };
      return { status: 404, corpo: {} };
    });
    const w = montar(IrasTela);
    await flushPromises();
    expect(c.some((x) => x.url.includes('/denominadores?competencia=2026-10'))).toBe(true);
    expect(w.find('[data-testid="censo-incompleto"]').text()).toContain('15 de 21');
    expect(w.find('[data-testid="den-UTI"]').text()).toContain('1 ÷ 40 × 1.000 = 25,00');
    expect(w.find('[data-testid="den-Todos os setores"]').exists()).toBe(true);
    expect(w.find('[data-testid="iras-nenhuma"]').exists()).toBe(true);

    await escolher(w, 'iras-paciente', '4801');
    await clicar(w, 'iras-nova');
    await escolher(w, 'iras-sitio', 'ipcs');
    const rotulos = w.findAll('[data-testid="iras-criterios"] label').map((l) => l.text());
    expect(rotulos.join(' ')).toContain('hemocultura');
    expect(rotulos.join(' ')).not.toContain('Urocultura');
    await digitar(w, 'iras-data', '21/10/2026');
    await clicar(w, 'iras-gravar');
    expect(w.find('[data-testid="iras-problema"]').exists()).toBe(true);
    await marcar(w, 'iras-criterios', 'Patógeno reconhecido em hemocultura');
    expect(w.find('[data-testid="iras-fecha"]').exists()).toBe(true);
    await clicar(w, 'iras-gravar');
    expect(ultimoPost(c)?.corpo).toEqual({
      internacao: 4801,
      sitio: 'ipcs',
      dataInfeccao: '2026-10-21',
      criterios: ['hemoculturaPatogeno'],
      nivelIsc: null,
      cirurgia: null,
      implante: false,
      exame: null,
      microrganismo: null,
      multirresistente: false,
      descricao: null,
    });
    expect(w.find('[data-testid="iras-aviso"]').exists()).toBe(true);
  });
});

describe('pendências da alta e da transferência feitas fora (M48.3, correção)', () => {
  it('o dispositivo sem retirada de quem recebeu alta aparece e a retirada vai na data da alta', async () => {
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const c = simular((url, init) => {
      if (url.endsWith('/formulario')) return FORMULARIO();
      if (url.includes('/denominadores'))
        return {
          competencia: '2026-10',
          setores: [setorDen('UTI')],
          todos: setorDen('todos'),
          censo: { diasFechados: 21, diasTerminados: 21, completo: true },
          semRetirada: [
            {
              id: 7,
              versao: 1,
              internacao: 4801,
              tipo: 'cvc',
              setor: 'UTI',
              inseridoEm: '2026-10-17T10:00:00',
              alta: '2026-10-20',
            },
          ],
          cortada: false,
        };
      if (url.includes('/iras?')) return { competencia: '2026-10', itens: [], cortada: false };
      if (url.endsWith('/internados')) return { itens: [], cortada: false };
      if (url.endsWith('/dispositivos/7/retirar') && init?.method === 'POST')
        return { status: 201, corpo: { versao: 2, sugerirNotificacao: false } };
      return { status: 404, corpo: {} };
    });
    const w = montar(IrasTela);
    await flushPromises();
    const item = w.find('[data-testid="sem-retirada-7"]');
    expect(item.text()).toContain('Cateter venoso central');
    expect(item.text()).toContain('alta em 20/10/2026');
    await clicar(w, 'retirar-na-alta-7');
    expect(ultimoPost(c)).toMatchObject({
      url: expect.stringContaining('/dispositivos/7/retirar'),
      corpo: { versao: 1, retiradoEm: '2026-10-20T00:00', motivo: 'alta', observacao: null },
    });
  });

  it('a precaução de paciente transferido ou que já saiu aparece como pendência', async () => {
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const base = {
      reg: 4801,
      leito: leito('A'),
      motivo: 'kpc',
      motivoOutro: null,
      tipo: 'contato',
      origem: 'manual',
      exame: null,
      multirresistente: true,
      bloqueios: [],
      observacao: null,
      inicioEm: '2026-10-21T10:00:00',
      inicioPor: 'SINT.CCIH',
      fimEm: null,
      motivoFim: null,
      versao: 1,
      prontuario: null,
      leitoTexto: 'UTI 01-A',
    };
    simular((url) => {
      if (url.endsWith('/formulario')) return FORMULARIO();
      if (url.endsWith('/precaucoes'))
        return {
          itens: [
            {
              ...base,
              id: 50,
              paciente: 'PACIENTE SINTETICO CCIH',
              situacao: 'transferida',
              leitoAtual: 'CM 201-B',
            },
            { ...base, id: 51, paciente: '', situacao: 'internacaoEncerrada', leitoAtual: null },
          ],
        };
      if (url.endsWith('/internados')) return { itens: [], cortada: false };
      return { status: 404, corpo: {} };
    });
    const w = montar(PrecaucoesTela);
    await flushPromises();
    expect(w.find('[data-testid="precaucao-pendente-50"]').text()).toContain('CM 201-B');
    expect(w.find('[data-testid="precaucao-pendente-51"]').text()).toContain('Internação encerrada');
    expect(w.find('[data-testid="precaucao-51"]').text()).toContain('Paciente que já saiu');
  });
});

describe('antimicrobianos', () => {
  it('a fila mostra o vencido; decidir grava a decisão; o consumo mostra DDD e DOT com as parcelas', async () => {
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const c = simular((url, init) => {
      if (url.endsWith('/formulario')) return FORMULARIO();
      if (url.endsWith('/antimicrobianos/liberar') && init?.method === 'POST')
        return { status: 201, corpo: { id: 12, noPrazo: false } };
      if (url.includes('/antimicrobianos/consumo'))
        return {
          competencia: '2026-10',
          pacientesDia: 200,
          itens: [
            {
              item: 300,
              nome: 'MEROPENEM SINTETICO',
              atc: 'J01DH02',
              unidadesDispensadas: 30,
              ddd: 10,
              diasTerapia: 9,
            },
          ],
          semDdd: [
            {
              item: 301,
              nome: 'OUTRO SINTETICO',
              atc: null,
              unidadesDispensadas: 4,
              ddd: null,
              diasTerapia: 2,
            },
          ],
          dddPorMilPacientesDia: parcela(10, 200, 50, 1000),
          dotPorMilPacientesDia: parcela(11, 200, 55, 1000),
          cortada: false,
        };
      if (url.includes('/antimicrobianos'))
        return {
          agora: '2026-10-22T13:00:00',
          prazoLiberacaoHoras: 48,
          itens: [
            { ...ITEM_FILA, paciente: 'PACIENTE SINTETICO CCIH', prontuario: 480001, leito: 'UTI 01-A' },
          ],
          cortada: false,
        };
      return { status: 404, corpo: {} };
    });
    const w = montar(AntimicrobianosTela);
    await flushPromises();
    expect(w.find('[data-testid="atm-777"]').text()).toContain('Sem liberação no prazo');
    await clicar(w, 'decidir-777');
    await escolher(w, 'decisao', 'liberadoComAjuste');
    await digitar(w, 'decisao-dias', '5');
    await digitar(w, 'decisao-justificativa', 'Ajustar dose pela função renal sintética.');
    await clicar(w, 'decisao-gravar');
    expect(ultimoPost(c)?.corpo).toEqual({
      itemPrescricao: 777,
      decisao: 'liberadoComAjuste',
      diasAutorizados: 5,
      justificativa: 'Ajustar dose pela função renal sintética.',
    });
    expect(w.find('[data-testid="atm-aviso"]').text()).toContain('fora do prazo');

    const radio = w.findAll('input[type="radio"]').find((r) => r.attributes('value') === 'consumo');
    await radio!.setValue(true);
    await flushPromises();
    expect(w.find('[data-testid="atm-consumo"]').text()).toContain('10 ÷ 200 × 1.000 = 50,00');
    expect(w.find('[data-testid="consumo-sem-ddd"]').text()).toContain('OUTRO SINTETICO');
  });
});

describe('precauções', () => {
  it('aerossóis num quarto com vizinho já vem com o bloqueio; os ocupados voltam em alerta; encerrar vai com a versão', async () => {
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const aberta = {
      id: 40,
      reg: 4801,
      leito: leito('A'),
      motivo: 'kpc',
      motivoOutro: null,
      tipo: 'contato',
      origem: 'microbiologia',
      exame: 9001,
      multirresistente: true,
      bloqueios: [],
      observacao: null,
      inicioEm: '2026-10-21T10:00:00',
      inicioPor: 'SINT.CCIH',
      fimEm: null,
      motivoFim: null,
      versao: 3,
      paciente: 'PACIENTE SINTETICO CCIH',
      prontuario: 480001,
      leitoTexto: 'UTI 01-A',
    };
    const c = simular((url, init) => {
      if (url.endsWith('/formulario')) return FORMULARIO();
      if (url.endsWith('/precaucoes') && init?.method === 'POST')
        return {
          status: 201,
          corpo: {
            id: 41,
            leito: leito('A'),
            tipoDoLeito: 'aerossois',
            bloqueados: 0,
            bloqueioVizinho: 'exigido',
            vizinhosOcupados: ['UTI 01-C'],
          },
        };
      if (url.endsWith('/precaucoes/40/encerrar')) return { versao: 4 };
      if (url.endsWith('/precaucoes')) return { itens: [aberta] };
      if (url.endsWith('/internados'))
        return {
          itens: [
            {
              internacao: 4801,
              nome: 'PACIENTE SINTETICO CCIH',
              prontuario: 480001,
              setor: 'UTI',
              leito: 'UTI 01-A',
              entrada: '2026-10-16',
            },
          ],
          cortada: false,
        };
      if (url.includes('/internacoes/4801'))
        return INTERNACAO([
          { ...leito('B'), ocupado: false },
          { ...leito('C'), ocupado: true },
        ]);
      return { status: 404, corpo: {} };
    });
    const w = montar(PrecaucoesTela);
    await flushPromises();
    expect(w.find('[data-testid="precaucao-40"]').text()).toContain('Multirresistente');
    expect(w.find('[data-testid="precaucao-40"]').text()).toContain('Microbiologia');

    await escolher(w, 'precaucao-paciente', '4801');
    await clicar(w, 'precaucao-nova');
    await escolher(w, 'precaucao-motivo', 'tuberculose');
    expect((w.find('[data-testid="precaucao-bloquear"]').element as HTMLInputElement).checked).toBe(true);
    await w.find('[data-testid="precaucao-bloquear"]').setValue(false);
    await clicar(w, 'precaucao-gravar');
    expect(w.find('[data-testid="precaucao-problema"]').text()).toContain('aerossóis');
    await w.find('[data-testid="precaucao-bloquear"]').setValue(true);
    await clicar(w, 'precaucao-gravar');
    expect(ultimoPost(c)?.corpo).toMatchObject({
      internacao: 4801,
      motivo: 'tuberculose',
      tipo: 'aerossois',
      origem: 'manual',
      bloquearVizinhos: true,
    });
    expect(w.find('[data-testid="vizinhos-ocupados"]').text()).toContain('UTI 01-C');

    await clicar(w, 'encerrar-40');
    await escolher(w, 'encerrar-motivo', 'culturasNegativas');
    await clicar(w, 'encerrar-gravar');
    expect(ultimoPost(c)).toMatchObject({
      url: '/api/qualidade/ccih/precaucoes/40/encerrar',
      corpo: { versao: 3, motivo: 'culturasNegativas', observacao: null },
    });
  });
});

describe('higiene das mãos e surtos', () => {
  it('a sessão do tablet soma as oportunidades e grava sem identificar o profissional; o surto abre', async () => {
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const c = simular((url, init) => {
      if (url.endsWith('/formulario')) return FORMULARIO();
      if (url.endsWith('/internados')) return { itens: [], cortada: false };
      if (url.endsWith('/maos/observacoes')) return { status: 201, corpo: { id: 1 } };
      if (url.endsWith('/surtos') && init?.method === 'POST') return { status: 201, corpo: { id: 2 } };
      if (url.endsWith('/surtos')) return { itens: [] };
      return { status: 404, corpo: {} };
    });
    const w = montar(MaosSurtosTela);
    await flushPromises();
    await clicar(w, 'obs-gravar');
    expect(w.find('[data-testid="obs-incompleta"]').exists()).toBe(true);
    await escolher(w, 'obs-unidade', '1');
    await digitar(w, 'obs-data', '22/10/2026');
    await digitar(w, 'obs-hora', '10:00');
    const radio = (valor: string) =>
      w.findAll('input[type="radio"]').find((r) => r.attributes('value') === valor)!;
    await radio('enfermeiro').setValue(true);
    await clicar(w, 'obs-adicionar');
    await radio('aposContato').setValue(true);
    await radio('naoRealizada').setValue(true);
    await clicar(w, 'obs-adicionar');
    expect(w.find('[data-testid="obs-parcial"]').text()).toContain('2 (1 conformes)');
    await clicar(w, 'obs-gravar');
    expect(ultimoPost(c)?.corpo).toEqual({
      unidade: 1,
      setor: null,
      observadoEm: '2026-10-22T10:00',
      categoria: 'enfermeiro',
      oportunidades: [
        { momento: 'antesContato', acao: 'friccao', luvas: false },
        { momento: 'aposContato', acao: 'naoRealizada', luvas: false },
      ],
      observacao: null,
    });

    await radio('surtos').setValue(true);
    await flushPromises();
    expect(w.find('[data-testid="surtos-nenhum"]').exists()).toBe(true);
    await clicar(w, 'surto-novo');
    await digitar(w, 'surto-titulo', 'Surto sintético de KPC');
    await escolher(w, 'surto-unidade', '1');
    await digitar(w, 'surto-inicio', '20/10/2026');
    await digitar(w, 'surto-casos', '3');
    await clicar(w, 'surto-gravar');
    expect(ultimoPost(c)?.corpo).toEqual({
      titulo: 'Surto sintético de KPC',
      tipoSurto: null,
      agente: null,
      unidade: 1,
      setor: null,
      inicio: '2026-10-20',
      casos: 3,
      medidas: null,
    });
  });
});

describe('alerta ao prescritor', () => {
  it('mostra o restrito sem liberação; sem acesso, nada', async () => {
    simular((url) =>
      url.endsWith('atendimento=48101')
        ? {
            itens: [
              {
                itemPrescricao: 777,
                nome: 'MEROPENEM SINTETICO',
                situacao: 'vencida',
                venceEm: '2026-10-21T08:00:00',
              },
            ],
          }
        : { status: 403, corpo: { codigo: 'proibido' } },
    );
    const w = montar(AlertaAntimicrobiano, { atendimento: 48101 });
    await flushPromises();
    expect(w.find('[data-testid="alerta-antimicrobiano-ccih"]').text()).toContain('MEROPENEM SINTETICO');
    expect(w.text()).toContain('segue valendo');
    const v = montar(AlertaAntimicrobiano, { atendimento: 1 });
    await flushPromises();
    expect(v.find('[data-testid="alerta-antimicrobiano-ccih"]').exists()).toBe(false);
  });
});

describe('precaução no cabeçalho do prontuário (regra 7)', () => {
  it('mostra o tipo e o motivo da precaução aberta; sem internação ou sem acesso, nada', async () => {
    simular((url) =>
      url.endsWith('/do-paciente/1003')
        ? { itens: [{ tipo: 'contato', motivo: 'kpc', motivoOutro: null, multirresistente: true }] }
        : url.endsWith('/do-paciente/2')
          ? { itens: [] }
          : { status: 403, corpo: { codigo: 'proibido' } },
    );
    const w = montar(PrecaucaoNoCabecalho, { paciente: 1003 });
    await flushPromises();
    const c = w.find('[data-testid="precaucao-cabecalho"]');
    expect(c.text()).toContain('Precaução de contato');
    expect(c.text()).toContain('KPC');
    expect(c.text()).toContain('multirresistente');
    for (const p of [2, 3]) {
      const v = montar(PrecaucaoNoCabecalho, { paciente: p });
      await flushPromises();
      expect(v.find('[data-testid="precaucao-cabecalho"]').exists()).toBe(false);
    }
  });
});
