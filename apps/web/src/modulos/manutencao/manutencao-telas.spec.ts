// @vitest-environment jsdom
// Telas da manutenção e engenharia clínica (M55, etapa 1): os comuns (tempo e prazo, instantes, reais digitados, URL do
// QR, abas por perfil, corpos estritos conferidos pelo esquema do servidor, contas dos indicadores); a lista de OS
// (desligada com o motivo, abas conforme o perfil, prazos, QR que abre a abertura com o equipamento, detalhe com o
// alerta do crítico parado e o caminho para o bloqueio, assumir com a versão, aceite e recusa de quem abriu com a nota
// obrigatória, recusa do servidor com o texto da aplicação); a abertura (corpo certo, conferência antes do servidor); os
// equipamentos (lista, ficha com a etiqueta QR, execução do plano, painel com os três números, contratos com o corpo
// certo, indicadores com a conta impressa). Dados SINTÉTICOS; o fetch é simulado.
import type {
  ApoioManutencao,
  EquipamentoPeloCodigo,
  IndicadoresManutencao,
  OsDetalhe,
  OsResumo,
  PainelPlano,
} from '@sgh/contratos';
import { esquemaAbrirOs, esquemaAlterarEquipamento, esquemaConcluirOs } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca, SanteSelecao } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import {
  abaInicial,
  abasDaPessoa,
  contasDosIndicadores,
  corpoDaAbertura,
  corpoDaCobertura,
  corpoDaConclusao,
  corpoDoEquipamento,
  instanteBr,
  juntarInstante,
  problemasDe,
  rascunhoAberturaVazio,
  rascunhoCoberturaVazio,
  rascunhoConclusaoVazio,
  rascunhoDoEquipamento,
  reaisDigitados,
  setoresDaAbertura,
  textoDoPrazo,
  textoMinutos,
  urlDoQr,
} from './comum-manutencao.js';
import { rotasManutencao } from './rotas.js';
import EquipamentosTela from './telas/EquipamentosTela.vue';
import FormAlerta from './telas/FormAlerta.vue';
import FormAbrirOs from './telas/FormAbrirOs.vue';
import FormEquipamento from './telas/FormEquipamento.vue';
import OrdensServicoTela from './telas/OrdensServicoTela.vue';

const rotaAtual = { query: {} as Record<string, string> };
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
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
const montar = (componente: unknown, props: Record<string, unknown> = {}) =>
  mount(componente as never, {
    attachTo: document.body,
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to" data-testid="link"><slot /></a>' } },
    },
  });

// ── Dados sintéticos ────────────────────────────────────────────────────────────────────────────────────────────────
const HOJE = '2026-10-28';
const apoio = (x: Partial<ApoioManutencao> = {}): ApoioManutencao => ({
  hoje: HOJE,
  agora: `${HOJE}T10:00`,
  setores: [
    { codigo: 101, nome: 'SETOR SINTETICO A', ativo: true },
    { codigo: 102, nome: 'SETOR SINTETICO B', ativo: true },
    { codigo: 199, nome: 'SETOR SINTETICO INATIVO', ativo: false },
  ],
  unidades: [{ codigo: 1, nome: 'UNIDADE SINTETICA' }],
  meusSetores: [102],
  sla: {
    emergencia: { atendimentoHoras: 1, solucaoHoras: 4 },
    alta: { atendimentoHoras: 4, solucaoHoras: 24 },
    media: { atendimentoHoras: 24, solucaoHoras: 72 },
    baixa: { atendimentoHoras: 72, solucaoHoras: 240 },
  },
  antecedenciaDias: 15,
  aceiteHoras: 48,
  pode: { abrir: true, atender: false, encerrar: false, ler: false, editar: false, planejar: false },
  gravacao: { ligada: true, motivo: null },
  ...x,
});
const CHEFIA = { abrir: true, atender: true, encerrar: true, ler: true, editar: true, planejar: true };
const EQ_QR: EquipamentoPeloCodigo = {
  id: 9001,
  codigo: 'EQ-SINT-01',
  nome: 'MONITOR SINTETICO',
  criticidade: 'critica',
  situacao: 'ativo',
  setor: { codigo: '102', nome: 'SETOR SINTETICO B' },
  centroCusto: 102,
  parado: false,
  osAbertas: 1,
};
const prazo = (restante: number | null, situacao: OsResumo['atendimento']['situacao'] = 'noPrazo') => ({
  limite: `${HOJE}T12:00`,
  situacao,
  restanteMinutos: restante,
});
const OS: OsResumo = {
  id: 501,
  versao: 2,
  numero: '2026-000501',
  natureza: 'corretiva',
  prioridade: 'alta',
  situacao: 'aberta',
  equipamento: { id: 9001, codigo: 'EQ-SINT-01', nome: 'MONITOR SINTETICO' },
  critico: true,
  parado: true,
  setor: { codigo: '102', nome: 'SETOR SINTETICO B' },
  local: null,
  abertaEm: `${HOJE}T08:00`,
  solicitante: 'USUARIO SINTETICO',
  tecnico: null,
  atendimento: prazo(-30, 'vencido'),
  solucao: prazo(1500),
};
const detalhe = (x: Partial<OsDetalhe> = {}): OsDetalhe => ({
  ...OS,
  descricao: 'Tela apagada ao ligar o aparelho sintetico.',
  contato: 'RAMAL 1234',
  executor: 'interno',
  cobertura: null,
  paradaInicio: `${HOJE}T08:00`,
  paradaFim: null,
  causa: null,
  solucaoTexto: null,
  inicioReparo: null,
  fimReparo: null,
  custos: { pecas: 0, maoDeObra: 0, terceiros: 0, total: 0 },
  laudo: null,
  eventos: [{ em: `${HOJE}T08:00`, ator: 'USUARIO SINTETICO', de: null, para: 'aberta', nota: null }],
  souSolicitante: false,
  prioridadeSugerida: 'alta',
  podeCorrigir: false,
  acoes: ['assumir', 'cancelar'],
  alerta: {
    setor: { codigo: '102', nome: 'SETOR SINTETICO B' },
    recurso: { tipo: 'agendaConsulta', id: 7, nome: 'AGENDA SINTETICA' },
    operacaoBloqueio: 'agenda.bloquearHorarios',
  },
  ...x,
});
const PAINEL: PainelPlano = {
  hoje: HOJE,
  resumo: { vencida: 1, aVencer: 1, emDia: 0 },
  itens: [
    {
      plano: 9201,
      versao: 0,
      equipamento: { id: 9001, codigo: 'EQ-SINT-01', nome: 'MONITOR SINTETICO' },
      criticidade: 'critica',
      atividade: 'calibracao',
      periodicidade: { quantidade: 12, unidade: 'meses' },
      ultimaExecucao: '2025-10-01',
      ultimoResultado: 'aprovado',
      proxima: '2026-10-01',
      situacao: 'vencida',
      diasParaVencer: -27,
      exigeLaudo: true,
    },
    {
      plano: 9202,
      versao: 0,
      equipamento: { id: 9002, codigo: 'EQ-SINT-02', nome: 'BOMBA SINTETICA' },
      criticidade: 'alta',
      atividade: 'preventiva',
      periodicidade: { quantidade: 6, unidade: 'meses' },
      ultimaExecucao: null,
      ultimoResultado: null,
      proxima: '2026-11-05',
      situacao: 'aVencer',
      diasParaVencer: 8,
      exigeLaudo: false,
    },
  ],
};
const INDICADORES: IndicadoresManutencao = {
  inicio: '2026-10-01',
  fim: HOJE,
  equipamentos: 2,
  parcelas: {
    horasPeriodo: 1296,
    horasParadas: 6,
    horasOperacao: 1290,
    falhas: 2,
    reparos: 2,
    horasReparo: 4.5,
  },
  disponibilidade: 99.54,
  mtbf: 645,
  mttr: 2.25,
  porEquipamento: [],
};
const FICHA = {
  id: 9001,
  versao: 3,
  codigo: 'EQ-SINT-01',
  nome: 'MONITOR SINTETICO',
  tipo: 'medico',
  criticidade: 'critica',
  classeRisco: 'III',
  situacao: 'ativo',
  parado: false,
  setor: { codigo: '102', nome: 'SETOR SINTETICO B' },
  unidade: { codigo: '1', nome: 'UNIDADE SINTETICA' },
  localizacao: 'SALA 1',
  planosVencidos: 1,
  osAbertas: 0,
  fabricante: 'FABRICANTE SINT',
  modelo: 'M1',
  numeroSerie: 'S-0001',
  registroAnvisa: null,
  recurso: { tipo: 'agendaConsulta', id: 7, nome: 'AGENDA SINTETICA' },
  bemPatrimonial: null,
  instalacao: '2024-01-10',
  garantiaAte: null,
  coberturas: [],
  planos: [PAINEL.itens[0]],
};

const CATALOGO = [
  { id: 701, codigo: 'C-701', titulo: 'OPERACAO DO MONITOR SINTETICO', validadeMeses: 24, ativo: true },
  { id: 702, codigo: 'C-702', titulo: 'SEGURANCA ELETRICA SINTETICA', validadeMeses: 0, ativo: true },
  { id: 703, codigo: 'C-703', titulo: 'CURSO SINTETICO INATIVO', validadeMeses: 12, ativo: false },
];
const INDICE = {
  indice: 47,
  faixa: 'acompanhar',
  janelaMeses: 12,
  idade: { pontos: 22, peso: 40, razao: 0.55, idadeMeses: 33, vidaUtilMeses: 60 },
  custo: { pontos: 15, peso: 30, razao: 0.5, custoCent: 500000, valorCent: 1000000 },
  falhas: { pontos: 10, peso: 30, razao: 0.33, corretivas: 2, teto: 6 },
};

type Pedido = { url: string; metodo: string; corpo: unknown };
type Resposta = { status?: number; corpo: unknown };
function simular(rota: (url: string, metodo: string) => Resposta | null = () => null, a = apoio()): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      const u = String(url);
      pedidos.push({ url: u, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      const r = rota(u, metodo) ?? base(u, a);
      return new Response(JSON.stringify(r.corpo), {
        status: r.status ?? 200,
        headers: {
          'content-type': r.status && r.status >= 400 ? 'application/problem+json' : 'application/json',
        },
      });
    }),
  );
  return pedidos;
}
function base(u: string, a: ApoioManutencao): Resposta {
  if (u === '/api/manutencao/apoio') return { corpo: a };
  // O detalhe da corretiva embute a parte externa (C2-089): sem oficina, orçamento nem remessa.
  if (/\/os\/\d+\/corretiva-externa$/.test(u)) {
    const d = detalhe();
    return {
      corpo: {
        os: d.id,
        versaoOs: d.versao,
        situacaoOs: d.situacao,
        oficina: null,
        oficinaNome: null,
        equipamento: null,
        orcamentos: [],
        remessas: [],
      },
    };
  }
  if (u.startsWith('/api/manutencao/os/')) return { corpo: detalhe() };
  if (u.startsWith('/api/manutencao/os')) return { corpo: { itens: [OS], proxima: null } };
  if (u.startsWith('/api/manutencao/equipamentos/busca')) return { corpo: [EQ_QR] };
  if (u.startsWith('/api/manutencao/equipamentos/codigo/')) return { corpo: EQ_QR };
  if (u.startsWith('/api/manutencao/modelos/cursos/catalogo')) return { corpo: CATALOGO };
  if (u.startsWith('/api/manutencao/modelos/cursos')) return { corpo: [] };
  if (/\/equipamentos\/\d+\/operadores/.test(u)) return { corpo: { cursos: [], aptos: [], pendentes: [] } };
  if (/\/equipamentos\/\d+\/obsolescencia/.test(u)) return { corpo: INDICE };
  if (/\/equipamentos\/\d+\/eventos/.test(u)) return { corpo: [] };
  if (u.startsWith('/api/manutencao/equipamentos/')) return { corpo: FICHA };
  if (u.startsWith('/api/manutencao/equipamentos'))
    return {
      corpo: {
        itens: [{ ...FICHA, planos: undefined, coberturas: undefined }],
        proxima: null,
      },
    };
  if (u.startsWith('/api/manutencao/plano/painel')) return { corpo: PAINEL };
  if (u.includes('/execucoes')) return { corpo: [] };
  if (u.startsWith('/api/manutencao/coberturas')) return { corpo: [] };
  if (u.startsWith('/api/manutencao/fornecedores'))
    return { corpo: [{ codigo: 77, nome: 'EMPRESA SINTETICA' }] };
  if (u.startsWith('/api/manutencao/recursos')) return { corpo: [] };
  if (u.startsWith('/api/manutencao/indicadores')) return { corpo: INDICADORES };
  return { corpo: {} };
}
afterEach(() => {
  vi.unstubAllGlobals();
  rotaAtual.query = {};
  document.body.innerHTML = '';
});

async function escolher(w: VueWrapper, testid: string, valor: unknown) {
  const c = w.findAllComponents(SanteSelecao).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`combo ${testid} não achado`);
  c.vm.$emit('update:modelValue', valor);
  await flushPromises();
}
async function digitar(w: VueWrapper, testid: string, texto: string) {
  const el = w.find(
    `[data-testid="${testid}"] input, [data-testid="${testid}"] textarea, input[data-testid="${testid}"], textarea[data-testid="${testid}"]`,
  );
  if (!el.exists()) throw new Error(`campo ${testid} não achado`);
  await el.setValue(texto);
  await flushPromises();
}
async function clicar(w: VueWrapper, testid: string) {
  const el = w.find(`[data-testid="${testid}"]`);
  if (!el.exists()) throw new Error(`botão ${testid} não achado`);
  await el.trigger('click');
  await flushPromises();
  await flushPromises();
}
async function enviarForm(w: VueWrapper, testid: string) {
  await w.find(`[data-testid="${testid}"]`).trigger('submit');
  await flushPromises();
  await flushPromises();
}
const posts = (ps: Pedido[], trecho: string) =>
  ps.filter((p) => p.metodo === 'POST' && p.url.includes(trecho));
const esperar = async () => {
  for (let i = 0; i < 4; i++) await flushPromises();
};

// Mais de 50 equipamentos sintéticos: a primeira página da busca traz só os 50 mais novos (o servidor ordena do mais
// novo e corta em 50); o termo vai na consulta e acha o mais antigo, que fica fora da primeira página.
const MUITOS: EquipamentoPeloCodigo[] = Array.from({ length: 60 }, (_, i) => ({
  ...EQ_QR,
  id: 1001 + i,
  codigo: `EQ-SINT-${String(1001 + i)}`,
  nome: `EQUIPAMENTO SINTETICO ${1001 + i}`,
}));
const buscaComMuitos = (u: string): Resposta | null => {
  if (!u.startsWith('/api/manutencao/equipamentos/busca')) return null;
  const termo = new URLSearchParams(u.split('?')[1] ?? '').get('termo') ?? '';
  const achados = MUITOS.filter((e) => !termo || e.codigo.includes(termo)).sort((x, y) => y.id - x.id);
  return { corpo: achados.slice(0, 50) };
};
const opcoesDoCombo = (w: VueWrapper, testid: string) =>
  (
    w
      .findAllComponents(SanteSelecao)
      .find((x) => x.attributes('data-testid') === testid)!
      .props() as { opcoes: { valor: unknown; rotulo: string }[] }
  ).opcoes.map((o) => o.valor);

// ── Comuns ──────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('comuns da manutenção', () => {
  it('tempo e prazo em texto', () => {
    expect(textoMinutos(45)).toBe('45 min');
    expect(textoMinutos(185)).toBe('3 h 05 min');
    expect(textoMinutos(-120)).toBe('2 h');
    expect(textoMinutos(60 * 52)).toBe('2 dias 4 h');
    expect(textoDoPrazo(prazo(-30, 'vencido'))).toEqual({
      chave: 'manutencao.prazo.vencidoHa',
      tempo: '30 min',
    });
    expect(textoDoPrazo(prazo(90))).toEqual({ chave: 'manutencao.prazo.restante', tempo: '1 h 30 min' });
    expect(textoDoPrazo(prazo(null, 'cumprido')).chave).toBe('manutencao.prazo.cumprido');
    expect(textoDoPrazo(prazo(null, 'descumprido')).chave).toBe('manutencao.prazo.descumprido');
  });

  it('instantes, reais digitados e o endereço do QR', () => {
    expect(juntarInstante('2026-10-28', '09:05')).toBe('2026-10-28T09:05');
    // A mensagem padrão do Zod não chega à tela.
    expect(Object.values(problemasDe(esquemaConcluirOs, { versao: 1 })).join(' ')).not.toMatch(/Invalid/);
    // Hora em quatro dígitos ainda é aceita pelo auxiliar.
    expect(juntarInstante('2026-10-28', '0905')).toBe('2026-10-28T09:05');
    expect(juntarInstante('2026-10-28', null)).toBeNull();
    expect(instanteBr('2026-10-28T09:05')).toBe('28/10/2026 09:05');
    expect(reaisDigitados('1.234,56')).toBe(1234.56);
    expect(reaisDigitados('R$ 10')).toBe(10);
    expect(reaisDigitados('')).toBe(0);
    expect(reaisDigitados('1,2,3')).toBeNull();
    expect(urlDoQr('https://sgh.exemplo/', 'EQ 01/A')).toBe(
      'https://sgh.exemplo/manutencao/os?abrir=EQ%2001%2FA',
    );
  });

  it('abas conforme o perfil e a aba inicial', () => {
    expect(abasDaPessoa(apoio({ meusSetores: [] }))).toEqual(['minhas']);
    expect(abasDaPessoa(apoio())).toEqual(['minhas', 'doSetor']);
    expect(abasDaPessoa(apoio({ pode: CHEFIA }))).toEqual(['minhas', 'doSetor', 'todas']);
    expect(abaInicial(apoio())).toBe('minhas');
    expect(abaInicial(apoio({ pode: CHEFIA }))).toBe('todas');
  });

  it('setores da abertura: os da pessoa, ou todos os ativos sem restrição', () => {
    expect(setoresDaAbertura(apoio()).map((s) => s.valor)).toEqual([102]);
    expect(setoresDaAbertura(apoio({ meusSetores: [] })).map((s) => s.valor)).toEqual([101, 102]);
  });

  it('o corpo da abertura passa no esquema do servidor; sem equipamento, a corretiva é recusada antes', () => {
    const r = {
      ...rascunhoAberturaVazio(102),
      equipamento: 9001,
      descricao: 'Tela apagada ao ligar.',
      equipamentoParado: true,
    };
    expect(problemasDe(esquemaAbrirOs, corpoDaAbertura(r))).toEqual({});
    const sem = problemasDe(esquemaAbrirOs, corpoDaAbertura({ ...r, equipamento: null }));
    expect(sem['equipamento']).toBe('Escolha o equipamento com defeito.');
    expect(
      corpoDaAbertura({ ...r, equipamento: null, natureza: 'predial', local: 'Corredor' }).equipamentoParado,
    ).toBe(false);
  });

  it('a alteração do equipamento leva a versão; a conclusão leva os instantes e os custos', () => {
    const r = rascunhoDoEquipamento(FICHA as never);
    expect(r.centroCusto).toBe(102);
    const corpo = corpoDoEquipamento(r, { id: 9001, versao: 3 });
    expect(corpo).toMatchObject({
      id: 9001,
      versao: 3,
      recurso: { tipo: 'agendaConsulta', id: 7 },
      motivo: null,
    });
    expect(problemasDe(esquemaAlterarEquipamento, corpo)).toEqual({});
    const c = {
      ...rascunhoConclusaoVazio(HOJE),
      causa: 'desgaste' as const,
      solucao: 'Troca da fonte de alimentação.',
      inicioHora: '09:00',
      fimHora: '10:30',
      voltaData: HOJE,
      voltaHora: '10:45',
      custoPecas: '123,45',
      custoMaoDeObra: '50',
    };
    const k = corpoDaConclusao(c, 3, true);
    expect(k).toMatchObject({
      inicioReparo: `${HOJE}T09:00`,
      fimReparo: `${HOJE}T10:30`,
      voltaAoUso: `${HOJE}T10:45`,
      custoPecas: 123.45,
      custoMaoDeObra: 50,
      custoTerceiros: 0,
      laudo: null,
    });
    expect(problemasDe(esquemaConcluirOs, { ...k, os: 1 })).toEqual({});
    expect(corpoDaConclusao(c, 3, false).voltaAoUso).toBeNull();
  });

  it('o contrato converte o prazo e o valor; as contas dos indicadores levam as parcelas', () => {
    const r = {
      ...rascunhoCoberturaVazio(HOJE),
      fornecedor: 77,
      numero: 'CT-1',
      fim: '2027-10-27',
      equipamentos: [9001],
      slaHoras: '8',
      valorMensal: '1.500,00',
    };
    expect(corpoDaCobertura(r)).toMatchObject({ slaHoras: 8, valorMensal: 1500, contrato: null });
    expect(contasDosIndicadores(INDICADORES)).toEqual({
      disponibilidade: { operacao: '1.290,00', periodo: '1.296,00' },
      mtbf: { operacao: '1.290,00', falhas: '2' },
      mttr: { reparo: '4,50', reparos: '2' },
    });
    expect(contasDosIndicadores({ ...INDICADORES, mtbf: null, mttr: null })).toMatchObject({
      mtbf: null,
      mttr: null,
    });
  });

  it('as rotas declaram a permissão', () => {
    expect(rotasManutencao.map((r) => [r.path, r.meta?.['permissao']])).toEqual([
      ['/manutencao/os', 'manutencao.os.abrir'],
      ['/manutencao/equipamentos', 'manutencao.equipamento.ler'],
      ['/manutencao/oficinas', 'manutencao.equipamento.ler'],
    ]);
  });
});

// ── Ordens de serviço ───────────────────────────────────────────────────────────────────────────────────────────────
describe('tela das ordens de serviço', () => {
  it('desligada: avisa o motivo e não deixa abrir; a consulta segue', async () => {
    const ps = simular(undefined, apoio({ gravacao: { ligada: false, motivo: 'desligada' } }));
    const w = montar(OrdensServicoTela);
    await esperar();
    expect(w.find('[data-testid="manutencao-desligado"]').text()).toContain('ainda não foi ligada');
    expect(w.find('[data-testid="os-nova"]').attributes('disabled')).toBeDefined();
    expect(ps.some((p) => p.url.startsWith('/api/manutencao/os?') && p.url.includes('minhas=true'))).toBe(
      true,
    );
    expect(w.find('[data-testid="os-501"]').text()).toContain('vencido há 30 min');
    expect(w.text()).not.toMatch(/spdata|legado|sistema atual/i);
  });

  it('abas: quem só abre não vê "Todas"; "Do meu setor" filtra pelo setor da pessoa', async () => {
    const ps = simular();
    const w = montar(OrdensServicoTela);
    await esperar();
    expect(w.find('[data-testid="os-aba-todas"]').exists()).toBe(false);
    await clicar(w, 'os-aba-doSetor');
    await esperar();
    expect(ps.some((p) => p.url.startsWith('/api/manutencao/os?') && p.url.includes('centroCusto=102'))).toBe(
      true,
    );
  });

  it('filtro do equipamento: com mais de 50, a busca vai ao servidor e o escolhido fica na lista', async () => {
    const ps = simular((u) => buscaComMuitos(u));
    const w = montar(OrdensServicoTela);
    await esperar();
    expect(opcoesDoCombo(w, 'os-filtro-equipamento')).not.toContain(1003);
    await digitar(w, 'os-filtro-termo-equipamento', 'EQ-SINT-1003');
    await clicar(w, 'os-filtro-buscar-equipamento');
    await esperar();
    expect(
      ps.some(
        (p) => p.url.startsWith('/api/manutencao/equipamentos/busca') && p.url.includes('EQ-SINT-1003'),
      ),
    ).toBe(true);
    expect(opcoesDoCombo(w, 'os-filtro-equipamento')).toContain(1003);
    await escolher(w, 'os-filtro-equipamento', 1003);
    await esperar();
    expect(
      ps.some((p) => p.url.startsWith('/api/manutencao/os?') && p.url.includes('equipamento=1003')),
    ).toBe(true);
    await digitar(w, 'os-filtro-termo-equipamento', 'EQ-SINT-1060');
    await clicar(w, 'os-filtro-buscar-equipamento');
    await esperar();
    expect(opcoesDoCombo(w, 'os-filtro-equipamento')).toEqual([null, 1003, 1060]);
  });

  it('o QR da etiqueta abre a abertura já com o equipamento', async () => {
    rotaAtual.query = { abrir: 'EQ-SINT-01' };
    const ps = simular();
    montar(OrdensServicoTela);
    await esperar();
    expect(ps.some((p) => p.url === '/api/manutencao/equipamentos/codigo/EQ-SINT-01')).toBe(true);
    expect(document.querySelector('[data-testid="os-form-abrir"]')).not.toBeNull();
  });

  it('código não achado: avisa sem abrir a janela', async () => {
    simular((u) =>
      u.includes('/equipamentos/codigo/')
        ? {
            status: 404,
            corpo: { type: 'about:blank', title: 'Não encontrado', status: 404, codigo: 'nao-encontrado' },
          }
        : null,
    );
    const w = montar(OrdensServicoTela);
    await esperar();
    await digitar(w, 'os-codigo-campo', 'NAO-EXISTE');
    await enviarForm(w, 'os-codigo');
    expect(w.find('[data-testid="os-codigo-nao-achado"]').exists()).toBe(true);
    expect(document.querySelector('[data-testid="os-form-abrir"]')).toBeNull();
  });

  it('detalhe: alerta do crítico parado com o caminho para bloquear a agenda; assumir vai com a versão', async () => {
    rotaAtual.query = { os: '501' };
    const ps = simular(
      (_u, m) =>
        m === 'POST'
          ? { corpo: { ok: true, id: 501, versao: 3, mensagem: 'Ordem de serviço em atendimento.' } }
          : null,
      apoio({ pode: CHEFIA }),
    );
    const w = montar(OrdensServicoTela);
    await esperar();
    expect(w.find('[data-testid="os-alerta-parado"]').exists()).toBe(true);
    expect(w.find('[data-testid="os-alerta-bloqueio"] a').attributes('href')).toBe(
      '/agenda/consultas/bloqueios',
    );
    expect(w.find('[data-testid="os-prazo-atendimento"]').classes()).toContain('vencido');
    expect(w.find('[data-testid="os-documento"]').attributes('href')).toBe(
      '/api/manutencao/os/501/documento',
    );
    expect(w.find('[data-testid="os-acao-encerrarManutencao"]').exists()).toBe(false);
    await clicar(w, 'os-acao-assumir');
    await escolher(w, 'os-assumir-prioridade', 'emergencia');
    await clicar(w, 'os-acao-gravar');
    expect(posts(ps, '/os/501/assumir')[0]!.corpo).toEqual({
      versao: 2,
      prioridade: 'emergencia',
      executor: 'interno',
      cobertura: null,
      nota: null,
    });
    expect(w.find('[data-testid="os-mensagem"]').text()).toContain('em atendimento');
  });

  it('W0-08: corrigir a abertura antes de assumida pede o motivo e manda a versão; sem a marca, sem o botão', async () => {
    rotaAtual.query = { os: '501' };
    let marca = true;
    const ps = simular(
      (u, m) => {
        if (m === 'POST')
          return {
            corpo: { ok: true, id: 501, versao: 3, mensagem: 'Ordem de serviço 2026-000501 corrigida.' },
          };
        if (u === '/api/manutencao/os/501') return { corpo: detalhe({ podeCorrigir: marca }) };
        return null;
      },
      apoio({ pode: CHEFIA }),
    );
    const w = montar(OrdensServicoTela);
    await esperar();
    await clicar(w, 'os-acao-corrigir');
    expect(w.find('[data-testid="os-form-corrigir"]').exists()).toBe(true);
    await escolher(w, 'os-corrigir-prioridade', 'media');
    await enviarForm(w, 'os-form-corrigir');
    expect(posts(ps, '/os/501/correcao')).toHaveLength(0);
    await digitar(w, 'os-corrigir-motivo', 'A urgência foi informada errada');
    await enviarForm(w, 'os-form-corrigir');
    expect(posts(ps, '/os/501/correcao')[0]!.corpo).toEqual({
      versao: 2,
      equipamento: 9001,
      centroCusto: 102,
      local: null,
      descricao: 'Tela apagada ao ligar o aparelho sintetico.',
      prioridadeSugerida: 'media',
      motivo: 'A urgência foi informada errada',
    });
    expect(w.find('[data-testid="os-mensagem"]').text()).toContain('corrigida');
    marca = false;
    w.unmount();
    const w2 = montar(OrdensServicoTela);
    await esperar();
    expect(w2.find('[data-testid="os-acao-corrigir"]').exists()).toBe(false);
  });

  it('concluída: quem abriu aceita ou recusa; a recusa pede a explicação antes de enviar', async () => {
    rotaAtual.query = { os: '501' };
    const ps = simular((u, m) =>
      u === '/api/manutencao/os/501' && m === 'GET'
        ? {
            corpo: detalhe({
              situacao: 'concluida',
              souSolicitante: true,
              acoes: ['encerrar'],
              alerta: null,
            }),
          }
        : m === 'POST'
          ? { corpo: { ok: true, id: 501, versao: 5, mensagem: 'Ordem de serviço aberta.' } }
          : null,
    );
    const w = montar(OrdensServicoTela);
    await esperar();
    expect(w.find('[data-testid="os-acao-aceitar"]').exists()).toBe(true);
    await clicar(w, 'os-acao-recusar');
    await clicar(w, 'os-acao-gravar');
    expect(w.find('[data-testid="os-problemas"]').text()).toContain('Explique o que não ficou resolvido');
    expect(posts(ps, '/encerrar')).toHaveLength(0);
    await digitar(w, 'os-acao-nota', 'Continua apagando depois de uma hora de uso.');
    await clicar(w, 'os-acao-gravar');
    expect(posts(ps, '/os/501/encerrar')[0]!.corpo).toEqual({
      versao: 2,
      aceite: false,
      nota: 'Continua apagando depois de uma hora de uso.',
    });
  });

  it('a recusa do servidor aparece com o texto da aplicação', async () => {
    rotaAtual.query = { os: '501' };
    simular(
      (_u, m) =>
        m === 'POST'
          ? {
              status: 422,
              corpo: { type: 'about:blank', title: 'Recusa', status: 422, codigo: 'desatualizado' },
            }
          : null,
      apoio({ pode: CHEFIA }),
    );
    const w = montar(OrdensServicoTela);
    await esperar();
    await clicar(w, 'os-acao-assumir');
    await clicar(w, 'os-acao-gravar');
    expect(w.find('[data-testid="recusa-manutencao"]').text()).toContain(
      'Outra pessoa alterou este registro',
    );
  });
});

describe('abertura da ordem de serviço', () => {
  it('confere antes de enviar e manda o corpo certo; o resultado sobe com o número', async () => {
    const ps = simular((_u, m) =>
      m === 'POST'
        ? { status: 201, corpo: { ok: true, id: 600, versao: 0, numero: '2026-000600', mensagem: 'ok' } }
        : null,
    );
    const w = montar(FormAbrirOs, { apoio: apoio(), equipamento: EQ_QR });
    await esperar();
    expect(w.find('[data-testid="os-abrir-duplicada"]').exists()).toBe(true);
    await enviarForm(w, 'os-form-abrir');
    expect(w.text()).toContain('Descreva com pelo menos 10 caracteres.');
    expect(posts(ps, '/api/manutencao/os')).toHaveLength(0);
    await digitar(w, 'os-abrir-descricao', 'Tela apagada ao ligar o aparelho.');
    await w.find('[data-testid="os-abrir-parado"]').setValue(true);
    await enviarForm(w, 'os-form-abrir');
    expect(posts(ps, '/api/manutencao/os')[0]!.corpo).toEqual({
      natureza: 'corretiva',
      equipamento: 9001,
      codigoEquipamento: null,
      centroCusto: 102,
      local: null,
      descricao: 'Tela apagada ao ligar o aparelho.',
      prioridadeSugerida: 'media',
      equipamentoParado: true,
      contato: null,
    });
    expect((w.emitted('aberta') as unknown[][])[0]![0]).toMatchObject({ numero: '2026-000600' });
  });
});

// ── Equipamentos ────────────────────────────────────────────────────────────────────────────────────────────────────
describe('tela dos equipamentos', () => {
  it('sem a permissão de consulta, avisa e não lista', async () => {
    const ps = simular();
    const w = montar(EquipamentosTela);
    await esperar();
    expect(w.text()).toContain('Você não tem permissão para consultar os equipamentos.');
    expect(ps.some((p) => p.url.startsWith('/api/manutencao/equipamentos?'))).toBe(false);
  });

  it('lista, ficha com a etiqueta QR e a execução do plano com o corpo certo', async () => {
    const ps = simular(
      (u, m) =>
        m === 'POST'
          ? { status: 201, corpo: { ok: true, id: 1, versao: 1, numero: '2026-000777', mensagem: 'ok' } }
          : u.includes('/plano/9201/execucoes')
            ? {
                corpo: [
                  {
                    id: 55,
                    data: '2025-10-01',
                    resultado: 'aprovado',
                    laudo: 900,
                    certificadoPadrao: null,
                    observacao: null,
                    osCorretiva: null,
                    por: 'Chefia Sintetica',
                  },
                ],
              }
            : null,
      apoio({ pode: CHEFIA }),
    );
    const w = montar(EquipamentosTela);
    await esperar();
    expect(w.find('[data-testid="equipamento-9001"]').text()).toContain('MONITOR SINTETICO');
    await clicar(w, 'equipamento-abrir-9001');
    await esperar();
    expect(w.find('[data-testid="equipamento-etiqueta"] svg path').attributes('d')).toMatch(/^M/);
    expect(w.find('[data-testid="equipamento-recurso-lido"]').text()).toContain('AGENDA SINTETICA');
    expect(w.find('[data-testid="equipamento-abrir-os"]').attributes('href')).toBe(
      '/manutencao/os?abrir=EQ-SINT-01',
    );
    expect(w.find('[data-testid="plano-9201"]').text()).toContain('Vencida');
    await clicar(w, 'plano-execucoes-9201');
    await esperar();
    expect(w.find('[data-testid="execucao-laudo-pdf-55"]').attributes('href')).toBe(
      '/api/manutencao/equipamentos/9001/laudo/55',
    );
    await clicar(w, 'plano-registrar-9201');
    expect(w.find('[data-testid="plano-form-execucao"]').text()).toContain('exigem o laudo');
    await escolher(w, 'execucao-resultado', 'reprovado');
    await enviarForm(w, 'plano-form-execucao');
    expect(w.find('[data-testid="execucao-problemas"]').text()).toContain('pelo menos 10 caracteres');
    await digitar(w, 'execucao-observacao', 'Fora da tolerância em duas faixas.');
    await digitar(w, 'execucao-laudo', '4321');
    await enviarForm(w, 'plano-form-execucao');
    expect(posts(ps, '/plano/9201/execucao')[0]!.corpo).toEqual({
      versao: 0,
      data: HOJE,
      resultado: 'reprovado',
      laudo: 4321,
      certificadoPadrao: null,
      observacao: 'Fora da tolerância em duas faixas.',
    });
    expect(w.find('[data-testid="equipamento-mensagem"]').text()).toContain('2026-000777');
  });

  it('W0-08: alterar o plano pela versão lida, com motivo; mostra as versões anteriores; versão velha avisa', async () => {
    let conflito = false;
    const ps = simular(
      (u, m) =>
        m === 'PUT'
          ? conflito
            ? {
                status: 409,
                corpo: {
                  type: 'about:blank',
                  title: 'Operação recusada',
                  status: 409,
                  detail: 'O plano de manutenção mudou depois que você abriu.',
                  codigo: 'desatualizado',
                },
              }
            : { corpo: { ok: true, id: 9201, versao: 4, mensagem: 'Plano de manutenção alterado.' } }
          : u === '/api/manutencao/plano/9201'
            ? {
                corpo: {
                  id: 9201,
                  versao: 3,
                  equipamento: 9001,
                  atividade: PAINEL.itens[0]!.atividade,
                  periodicidade: { quantidade: 12, unidade: 'meses' },
                  dataBase: '2025-10-01',
                  antecedenciaDias: null,
                  procedimento: 'Roteiro do fabricante',
                  executor: 'interno',
                  cobertura: null,
                  ativo: true,
                  versoes: [
                    {
                      versao: 2,
                      periodicidade: { quantidade: 6, unidade: 'meses' },
                      dataBase: '2025-04-01',
                      antecedenciaDias: null,
                      procedimento: null,
                      executor: 'interno',
                      cobertura: null,
                      motivo: 'Intervalo revisado pelo fabricante',
                      por: 'Chefia Sintetica',
                      em: '2026-11-01T10:00',
                    },
                  ],
                },
              }
            : null,
      apoio({ pode: CHEFIA }),
    );
    const w = montar(EquipamentosTela);
    await esperar();
    await clicar(w, 'equipamento-abrir-9001');
    await esperar();
    await clicar(w, 'plano-alterar-9201');
    await esperar();
    const form = () => w.find('[data-testid="plano-alterar"]');
    expect(form().text()).toContain('as execuções já registradas não mudam');
    expect(w.find('[data-testid="plano-versao-2"]').text()).toContain('Intervalo revisado pelo fabricante');
    await digitar(w, 'plano-alterar-quantidade', '9');
    await enviarForm(w, 'plano-form-alterar');
    expect(w.find('[data-testid="plano-alterar-problemas"]').text()).toContain('pelo menos 10 caracteres');
    expect(ps.filter((p) => p.metodo === 'PUT')).toHaveLength(0);
    await digitar(w, 'plano-alterar-motivo', 'Fabricante reduziu o intervalo');
    conflito = true;
    await enviarForm(w, 'plano-form-alterar');
    expect(form().find('[data-testid="recusa-manutencao"]').text()).toContain(
      'Outra pessoa alterou este registro',
    );
    conflito = false;
    await enviarForm(w, 'plano-form-alterar');
    const put = ps.filter((p) => p.metodo === 'PUT');
    expect(put.map((p) => p.url)).toEqual(['/api/manutencao/plano/9201', '/api/manutencao/plano/9201']);
    expect(put[1]!.corpo).toEqual({
      versao: 3,
      periodicidade: { quantidade: 9, unidade: 'meses' },
      dataBase: '2025-10-01',
      antecedenciaDias: null,
      procedimento: 'Roteiro do fabricante',
      executor: 'interno',
      cobertura: null,
      motivo: 'Fabricante reduziu o intervalo',
    });
    expect(w.find('[data-testid="equipamento-mensagem"]').text()).toContain('Plano de manutenção alterado.');
    expect(form().exists()).toBe(false);
  });

  it('o bem patrimonial pela busca no patrimônio: o atual relido aparece e o escolhido vai pelo ID', async () => {
    const ps = simular(
      (u, m) =>
        m === 'POST'
          ? { corpo: { ok: true, id: 9001, versao: 4, mensagem: 'ok' } }
          : u.includes('/bens?')
            ? { corpo: [{ id: 7003, plaqueta: 'PAT-000003', descricao: 'MONITOR PATRIMONIO' }] }
            : null,
      apoio({ pode: CHEFIA }),
    );
    const w = montar(FormEquipamento, {
      apoio: apoio({ pode: CHEFIA }),
      equipamento: {
        ...FICHA,
        bemPatrimonial: 7001,
        bem: { id: 7001, plaqueta: 'PAT-000001', descricao: 'BEM ATUAL' },
      },
    });
    await esperar();
    const combo = () =>
      w.findAllComponents(SanteSelecao).find((x) => x.attributes('data-testid') === 'equipamento-bem')!;
    expect(JSON.stringify((combo().props() as { opcoes: unknown }).opcoes)).toContain('PAT-000001 BEM ATUAL');
    await digitar(w, 'equipamento-bem-termo', 'PAT');
    await clicar(w, 'equipamento-bem-buscar');
    await esperar();
    expect(ps.some((p) => p.url.includes('/api/manutencao/bens?termo=PAT'))).toBe(true);
    expect(JSON.stringify((combo().props() as { opcoes: unknown }).opcoes)).toContain(
      'PAT-000003 MONITOR PATRIMONIO',
    );
    await escolher(w, 'equipamento-bem', 7003);
    await enviarForm(w, 'equipamento-form');
    expect(posts(ps, '/equipamentos/9001')[0]!.corpo).toMatchObject({ bemPatrimonial: 7003, versao: 3 });
  });

  it('painel do plano com os três números e os dias de atraso', async () => {
    simular(undefined, apoio({ pode: CHEFIA }));
    const w = montar(EquipamentosTela);
    await esperar();
    await clicar(w, 'equipamentos-aba-painel');
    await esperar();
    expect(w.find('[data-testid="painel-vencidas"]').text()).toBe('1');
    expect(w.find('[data-testid="painel-a-vencer"]').text()).toBe('1');
    expect(w.find('[data-testid="painel-item-9201"]').text()).toContain('27 dias de atraso');
    expect(w.find('[data-testid="painel-item-9202"]').text()).toContain('faltam 8 dias');
  });

  it('indicadores com a conta impressa', async () => {
    const ps = simular(undefined, apoio({ pode: CHEFIA }));
    const w = montar(EquipamentosTela);
    await esperar();
    await clicar(w, 'equipamentos-aba-indicadores');
    await esperar();
    expect(ps.some((p) => p.url === `/api/manutencao/indicadores?inicio=2026-10-01&fim=${HOJE}`)).toBe(true);
    expect(w.find('[data-testid="indicador-disponibilidade"]').text()).toContain(
      '1.290,00 h em operação ÷ 1.296,00 h no período',
    );
    expect(w.find('[data-testid="indicador-mtbf"]').text()).toContain('÷ 2 falhas');
    expect(w.find('[data-testid="indicador-mttr"]').text()).toContain('4,50 h de reparo ÷ 2 reparos');
  });

  it('contrato de manutenção: empresa pela busca, equipamentos e o corpo certo', async () => {
    const ps = simular(
      (_u, m) =>
        m === 'POST'
          ? { status: 201, corpo: { ok: true, id: 9101, versao: 0, mensagem: 'Contrato registrado.' } }
          : null,
      apoio({ pode: CHEFIA }),
    );
    const w = montar(EquipamentosTela);
    await esperar();
    await clicar(w, 'equipamentos-aba-contratos');
    await esperar();
    expect(w.find('[data-testid="contratos-vazio"]').exists()).toBe(true);
    await clicar(w, 'contratos-novo');
    await digitar(w, 'contratos-termo', 'SINT');
    await clicar(w, 'contratos-buscar');
    expect(ps.some((p) => p.url === '/api/manutencao/fornecedores?termo=SINT')).toBe(true);
    await escolher(w, 'contratos-fornecedor', 77);
    await digitar(w, 'contratos-numero', 'CT-SINT-1');
    await w
      .findAllComponents({ name: 'SanteData' })
      .find((c) => c.attributes('data-testid') === 'contratos-fim')!
      .vm.$emit('update:modelValue', '2027-10-27');
    await escolher(w, 'contratos-equipamento', 9001);
    await clicar(w, 'contratos-adicionar');
    await enviarForm(w, 'contratos-form');
    expect(posts(ps, '/api/manutencao/coberturas')[0]!.corpo).toEqual({
      fornecedor: 77,
      numero: 'CT-SINT-1',
      cobertura: 'integral',
      inicio: HOJE,
      fim: '2027-10-27',
      equipamentos: [9001],
      slaHoras: null,
      valorMensal: null,
      contrato: null,
    });
    expect(w.find('[data-testid="contratos-mensagem"]').text()).toContain('Contrato registrado.');
  });
  it('W0-08: contrato alterado pela versão (PUT com o motivo), excluir com vínculo mostra quantos e quais e oferece o encerramento', async () => {
    const CONTRATO = {
      id: 9101,
      versao: 2,
      numero: 'CT-SINT-9',
      fornecedor: { codigo: '77', nome: 'EMPRESA SINTETICA' },
      cobertura: 'integral',
      inicio: '2026-01-01',
      fim: '2026-12-31',
      vigente: true,
      slaHoras: 8,
      equipamentos: [9001, 9002],
      valorMensal: 1500,
      ativa: true,
      encerradaEm: null,
      motivoEncerramento: null,
    };
    const DETALHE = {
      ...CONTRATO,
      versoes: [
        {
          versao: 1,
          operacao: 'alteracao',
          inicio: '2026-01-01',
          fim: '2026-06-30',
          slaHoras: 8,
          valorMensal: 1500,
          equipamentos: [9001],
          motivo: 'Aditivo de prazo (sintético)',
          por: 'Pessoa Sintética',
          em: '2026-10-01T10:00:00',
        },
      ],
    };
    const ps = simular(
      (u, m) => {
        if (u === '/api/manutencao/coberturas/9101' && m === 'GET') return { corpo: DETALHE };
        if (u === '/api/manutencao/coberturas/9101' && m === 'PUT')
          return { corpo: { ok: true, id: 9101, versao: 3, mensagem: 'Contrato de manutenção alterado.' } };
        if (u.endsWith('/exclusao'))
          return {
            status: 409,
            corpo: {
              type: 'https://sgh.invalid/problemas/com-dependentes',
              title: 'Operação recusada',
              status: 409,
              codigo: 'com-dependentes',
              detail: 'O contrato de manutenção tem 1 registro dependente.',
              dependentes: [
                { rotulo: 'Planos de manutenção', quantidade: 1, amostra: ['9201'], origem: 'fk' },
              ],
              podeInativar: true,
            },
          };
        if (u.endsWith('/encerramento'))
          return { corpo: { ok: true, id: 9101, versao: 3, mensagem: 'Contrato de manutenção encerrado.' } };
        if (u.startsWith('/api/manutencao/coberturas')) return { corpo: [CONTRATO] };
        return null;
      },
      apoio({ pode: CHEFIA }),
    );
    const w = montar(EquipamentosTela);
    await esperar();
    await clicar(w, 'equipamentos-aba-contratos');
    await esperar();
    await clicar(w, 'contrato-alterar-9101');
    await esperar();
    expect(w.find('[data-testid="contrato-versao-1"]').text()).toContain('Aditivo de prazo (sintético)');
    await w
      .findAllComponents({ name: 'SanteData' })
      .find((c) => c.attributes('data-testid') === 'contrato-gerir-fim')!
      .vm.$emit('update:modelValue', '2027-06-30');
    await clicar(w, 'contrato-gerir-remover-9002');
    await enviarForm(w, 'contrato-gerir-form');
    expect(w.find('[data-testid="contrato-gerir-problemas"]').text()).toContain('pelo menos 10 caracteres');
    expect(ps.filter((p) => p.metodo === 'PUT')).toHaveLength(0);
    await digitar(w, 'contrato-gerir-motivo', 'Aditivo de prazo assinado');
    await enviarForm(w, 'contrato-gerir-form');
    const put = ps.filter((p) => p.metodo === 'PUT');
    expect(put).toHaveLength(1);
    expect(put[0]).toMatchObject({
      url: '/api/manutencao/coberturas/9101',
      corpo: {
        versao: 2,
        inicio: '2026-01-01',
        fim: '2027-06-30',
        equipamentos: [9001],
        slaHoras: 8,
        valorMensal: 1500,
        motivo: 'Aditivo de prazo assinado',
      },
    });
    expect(w.find('[data-testid="contratos-mensagem"]').text()).toContain('Contrato de manutenção alterado.');
    // Excluir com vínculo: a recusa lista quantos e quais e oferece encerrar.
    await clicar(w, 'contrato-excluir-9101');
    await esperar();
    await digitar(w, 'contrato-gerir-motivo', 'Registrado por engano');
    await clicar(w, 'contrato-gerir-gravar');
    const bs = document.querySelectorAll<HTMLElement>('[data-testid="confirmacao"] button');
    expect(bs.length).toBeGreaterThan(0);
    bs[bs.length - 1]!.click();
    await esperar();
    expect(posts(ps, '/coberturas/9101/exclusao')[0]!.corpo).toEqual({
      versao: 2,
      motivo: 'Registrado por engano',
    });
    expect(w.find('[data-testid="contrato-gerir-dependentes"]').text()).toContain('Planos de manutenção: 1');
    await clicar(w, 'contrato-gerir-encerrar-em-vez');
    expect(w.find('[data-testid="contrato-gerir-encerrar"]').exists()).toBe(true);
    await enviarForm(w, 'contrato-gerir-form');
    expect(posts(ps, '/coberturas/9101/encerramento')[0]!.corpo).toEqual({
      versao: 2,
      data: HOJE,
      motivo: 'Registrado por engano',
    });
    expect(w.find('[data-testid="contratos-mensagem"]').text()).toContain(
      'Contrato de manutenção encerrado.',
    );
  });
  it('contrato: com mais de 50 equipamentos, o fora da primeira página entra pela busca e mantém o nome', async () => {
    const ps = simular(
      (u, m) =>
        m === 'POST'
          ? { status: 201, corpo: { ok: true, id: 9102, versao: 0, mensagem: 'Contrato registrado.' } }
          : buscaComMuitos(u),
      apoio({ pode: CHEFIA }),
    );
    const w = montar(EquipamentosTela);
    await esperar();
    await clicar(w, 'equipamentos-aba-contratos');
    await esperar();
    await clicar(w, 'contratos-novo');
    await esperar();
    expect(opcoesDoCombo(w, 'contratos-equipamento')).not.toContain(1002);
    await digitar(w, 'contratos-termo-equipamento', 'EQ-SINT-1002');
    await clicar(w, 'contratos-buscar-equipamento');
    await esperar();
    expect(opcoesDoCombo(w, 'contratos-equipamento')).toContain(1002);
    await escolher(w, 'contratos-equipamento', 1002);
    await clicar(w, 'contratos-adicionar');
    await digitar(w, 'contratos-termo-equipamento', 'EQ-SINT-1059');
    await clicar(w, 'contratos-buscar-equipamento');
    await esperar();
    expect(w.find('[data-testid="contratos-equipamentos"]').text()).toContain(
      'EQ-SINT-1002 - EQUIPAMENTO SINTETICO 1002',
    );
    expect(
      ps.filter((p) => p.url.startsWith('/api/manutencao/equipamentos/busca')).length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('tecnovigilância e recall (W0-08, M2)', () => {
  const ALERTA = {
    id: 7,
    numero: 'AL-SINT-7',
    tipo: 'recall',
    origem: 'manual',
    titulo: 'Bateria sintetica com defeito',
    fabricante: 'Fabricante Sintetico',
    modelo: 'MX-1',
    serieInicio: 'SN-0001',
    serieFim: 'SN-0099',
    registroAnvisa: null,
    publicadoEm: '2026-10-20',
    descricao: 'Bateria pode desligar o aparelho sintetico.',
    acao: 'Trocar a bateria do lote afetado.',
    situacao: 'aberto',
    encerradoEm: null,
    encerradoPor: null,
    motivo: null,
    versao: 0,
    criadoPor: 'Pessoa Sintética',
    criadoEm: `${HOJE}T09:00:00`,
    acoes: 0,
  };
  const DETALHE_ALERTA = {
    ...ALERTA,
    importacaoAnvisa: false,
    afetados: [
      {
        equipamento: 9001,
        codigo: 'EQ-SINT-01',
        nome: 'MONITOR SINTETICO',
        modelo: 'MX-1',
        numeroSerie: 'SN-0001',
        centroCusto: 102,
        enquadramento: 'afetado',
        os: null,
        queixa: null,
      },
      {
        equipamento: 9003,
        codigo: 'EQ-SINT-03',
        nome: 'MONITOR SINTETICO SEM SERIE',
        modelo: 'MX-1',
        numeroSerie: null,
        centroCusto: 102,
        enquadramento: 'conferir',
        os: null,
        queixa: null,
      },
    ],
  };

  it('registro à mão confere pelo esquema e manda o corpo certo (faixa de série, sem a versão)', async () => {
    const ps = simular((_u, m) =>
      m === 'POST'
        ? { status: 201, corpo: { ok: true, id: 7, versao: 0, mensagem: 'Alerta AL-SINT-7 registrado.' } }
        : null,
    );
    const w = montar(FormAlerta, { ligada: true });
    await enviarForm(w, 'alerta-form');
    expect(w.find('[data-testid="alerta-problemas"]').exists()).toBe(true);
    expect(posts(ps, '/alertas')).toHaveLength(0);
    await digitar(w, 'alerta-numero', 'AL-SINT-7');
    await escolher(w, 'alerta-tipo', 'recall');
    await digitar(w, 'alerta-titulo', 'Bateria sintetica com defeito');
    await digitar(w, 'alerta-fabricante', 'Fabricante Sintetico');
    await digitar(w, 'alerta-modelo', 'MX-1');
    await digitar(w, 'alerta-serie-inicio', 'SN-0001');
    await digitar(w, 'alerta-serie-fim', 'SN-0099');
    await digitar(w, 'alerta-descricao', 'Bateria pode desligar o aparelho sintetico.');
    await digitar(w, 'alerta-acao', 'Trocar a bateria do lote afetado.');
    await enviarForm(w, 'alerta-form');
    expect(posts(ps, '/api/manutencao/alertas')[0]!.corpo).toEqual({
      numero: 'AL-SINT-7',
      tipo: 'recall',
      titulo: 'Bateria sintetica com defeito',
      fabricante: 'Fabricante Sintetico',
      modelo: 'MX-1',
      serieInicio: 'SN-0001',
      serieFim: 'SN-0099',
      registroAnvisa: null,
      publicadoEm: null,
      descricao: 'Bateria pode desligar o aparelho sintetico.',
      acao: 'Trocar a bateria do lote afetado.',
    });
    expect(w.emitted('gravado')?.[0]).toEqual([7, 'Alerta AL-SINT-7 registrado.']);
    // Com OS gerada, o critério trava (aparece só para leitura) e a alteração leva versão e motivo.
    const w2 = montar(FormAlerta, { ligada: true, alerta: { ...ALERTA, acoes: 1, versao: 1 } });
    expect(w2.find('[data-testid="alerta-criterio-travado"]').text()).toContain('SN-0001 - SN-0099');
    expect(w2.find('[data-testid="alerta-fabricante"]').exists()).toBe(false);
  });

  it('aba: o detalhe mostra afetados e a conferir; a ação de campo vai pela versão com os conferidos; excluir com OS recusa com quantos e oferece encerrar', async () => {
    const ps = simular(
      (u, m) => {
        if (u === '/api/manutencao/alertas/7' && m === 'GET') return { corpo: DETALHE_ALERTA };
        if (u === '/api/manutencao/alertas/7' && m === 'DELETE')
          return {
            status: 409,
            corpo: {
              type: 'https://sgh.invalid/problemas/com-dependentes',
              title: 'Operação recusada',
              status: 409,
              codigo: 'com-dependentes',
              detail: 'O alerta tem 2 registros dependentes.',
              dependentes: [
                {
                  rotulo: 'Ordens de serviço de ação de campo',
                  quantidade: 2,
                  amostra: ['2026-000601'],
                  origem: 'fk',
                },
              ],
              podeInativar: true,
            },
          };
        if (u.endsWith('/acao-de-campo'))
          return {
            corpo: {
              ok: true,
              id: 7,
              versao: 1,
              mensagem: '2 ordens de serviço de ação de campo geradas.',
              geradas: [],
            },
          };
        if (u.endsWith('/encerramento'))
          return { corpo: { ok: true, id: 7, versao: 2, mensagem: 'Alerta encerrado.' } };
        if (u.startsWith('/api/manutencao/alertas')) return { corpo: [ALERTA] };
        return null;
      },
      apoio({ pode: CHEFIA }),
    );
    const w = montar(EquipamentosTela);
    await esperar();
    await clicar(w, 'equipamentos-aba-alertas');
    await esperar();
    expect(ps.some((p) => p.url === '/api/manutencao/alertas?situacao=aberto')).toBe(true);
    expect(w.find('[data-testid="alerta-7"]').text()).toContain('SN-0001 - SN-0099');
    await clicar(w, 'alerta-abrir-7');
    await esperar();
    expect(w.find('[data-testid="alerta-afetado-9001"]').text()).toContain('SN-0001');
    expect(w.find('[data-testid="alerta-afetado-9003"]').text()).toContain('EQ-SINT-03');
    await w.find('[data-testid="alerta-conferido-9003"]').setValue(true);
    await clicar(w, 'alerta-gerar');
    await esperar();
    expect(posts(ps, '/alertas/7/acao-de-campo')[0]!.corpo).toEqual({
      versao: 0,
      equipamentos: [9001, 9003],
      prioridade: 'alta',
    });
    expect(w.find('[data-testid="alerta-mensagem"]').text()).toContain('2 ordens de serviço');
    await clicar(w, 'alerta-excluir');
    await digitar(w, 'alerta-gerir-motivo', 'Registrado por engano');
    await clicar(w, 'alerta-gerir-gravar');
    const bs = document.querySelectorAll<HTMLElement>('[data-testid="confirmacao"] button');
    expect(bs.length).toBeGreaterThan(0);
    bs[bs.length - 1]!.click();
    await esperar();
    const del = ps.filter((p) => p.metodo === 'DELETE');
    expect(del[0]).toMatchObject({
      url: '/api/manutencao/alertas/7',
      corpo: { versao: 0, motivo: 'Registrado por engano' },
    });
    expect(w.find('[data-testid="alerta-dependentes"]').text()).toContain(
      'Ordens de serviço de ação de campo: 2',
    );
    await clicar(w, 'alerta-encerrar-em-vez');
    expect(w.find('[data-testid="alerta-form-encerrar"]').exists()).toBe(true);
    await enviarForm(w, 'alerta-form-encerrar');
    expect(posts(ps, '/alertas/7/encerramento')[0]!.corpo).toEqual({
      versao: 0,
      motivo: 'Registrado por engano',
    });
    expect(w.find('[data-testid="alerta-mensagem"]').text()).toContain('Alerta encerrado.');
  });

  it('OS do alerta: abre a queixa técnica com o corpo certo e mostra o vínculo com a qualidade', async () => {
    rotaAtual.query = { os: '501' };
    let queixa: number | null = null;
    const ps = simular(
      (u, m) => {
        if (m === 'POST' && u.endsWith('/queixa-tecnica')) {
          queixa = 31;
          return {
            status: 201,
            corpo: { ok: true, id: 31, versao: 0, mensagem: 'Queixa técnica 31 aberta.' },
          };
        }
        if (u === '/api/manutencao/os/501')
          return {
            corpo: detalhe({
              tecnovigilancia: {
                alerta: { id: 7, numero: 'AL-SINT-7' },
                queixa,
                podeAbrirQueixa: queixa === null,
              },
            } as Partial<OsDetalhe>),
          };
        return null;
      },
      apoio({ pode: CHEFIA }),
    );
    const w = montar(OrdensServicoTela);
    await esperar();
    expect(w.find('[data-testid="os-do-alerta"]').text()).toContain('AL-SINT-7');
    await clicar(w, 'os-acao-queixa');
    await enviarForm(w, 'os-form-queixa');
    expect(w.find('[data-testid="os-queixa-problemas"]').exists()).toBe(true);
    expect(posts(ps, '/queixa-tecnica')).toHaveLength(0);
    await digitar(w, 'os-queixa-descricao', 'Bateria desligou durante o uso sintetico.');
    await escolher(w, 'os-queixa-conduta', 'suspensoUso');
    await enviarForm(w, 'os-form-queixa');
    expect(posts(ps, '/os/501/queixa-tecnica')[0]!.corpo).toEqual({
      tipo: 'queixaTecnica',
      descricao: 'Bateria desligou durante o uso sintetico.',
      conduta: 'suspensoUso',
    });
    await esperar();
    expect(w.find('[data-testid="os-queixa"]').text()).toContain('31');
    expect(w.find('[data-testid="os-queixa"] a').attributes('href')).toBe(
      '/qualidade/nsp/tecnovigilancia/31',
    );
    expect(w.find('[data-testid="os-acao-queixa"]').exists()).toBe(false);
  });
});

describe('treinamento dos operadores e ciclo de vida (W0-08, M3)', () => {
  const CURSO_MODELO = {
    id: 31,
    fabricante: 'FABRICANTE SINT',
    modelo: 'M1',
    curso: 701,
    cursoCodigo: 'C-701',
    cursoTitulo: 'OPERACAO DO MONITOR SINTETICO',
    cursoAtivo: true,
    validadeMeses: 24,
    criadoPor: 'Chefia Sintetica',
    criadoEm: `${HOJE}T09:00:00`,
  };
  const INCORPORACAO = {
    id: 41,
    equipamento: 9001,
    tipo: 'incorporacao',
    data: '2024-01-10',
    motivo: 'Compra sintetica para a UTI.',
    documento: null,
    destino: null,
    valorContabilCent: 1000000,
    valorObtidoCent: null,
    autorizadoPor: 'Diretoria Sintetica',
    por: 'Chefia Sintetica',
    em: '2024-01-10T10:00:00',
  };

  it('aptos e pendentes, índice com as parcelas e a conta, cursos exigidos (exigir e deixar de exigir com motivo), eventos com o corpo certo e a recusa traduzida, PGTS', async () => {
    let recusar = true;
    const ps = simular(
      (u, m) => {
        if (m === 'DELETE')
          return { corpo: { ok: true, id: 31, versao: 1, mensagem: 'O curso deixou de ser exigido.' } };
        if (m === 'POST' && u.endsWith('/modelos/cursos'))
          return {
            status: 201,
            corpo: { ok: true, id: 32, versao: 1, mensagem: 'Curso exigido para operar o modelo.' },
          };
        if (m === 'POST' && u.endsWith('/equipamentos/9001/eventos'))
          return recusar
            ? {
                status: 409,
                corpo: {
                  type: 'about:blank',
                  title: 'Recusada',
                  status: 409,
                  codigo: 'fora-de-ordem',
                  detail: 'fora de ordem',
                },
              }
            : {
                status: 201,
                corpo: { ok: true, id: 42, versao: 1, mensagem: 'Evento do ciclo de vida registrado.' },
              };
        if (u.startsWith('/api/manutencao/modelos/cursos?')) return { corpo: [CURSO_MODELO] };
        if (u.endsWith('/equipamentos/9001/operadores'))
          return {
            corpo: {
              cursos: [CURSO_MODELO],
              aptos: [
                { vinculo: 801, nome: 'OPERADORA SINTETICA', matricula: 'M-801', validoAte: '2027-05-01' },
              ],
              pendentes: [
                { vinculo: 802, nome: 'OPERADOR SINTETICO', matricula: null, faltam: [], vencidos: [701] },
              ],
            },
          };
        if (u.endsWith('/equipamentos/9001/eventos')) return { corpo: [INCORPORACAO] };
        return null;
      },
      apoio({ pode: CHEFIA }),
    );
    const w = montar(EquipamentosTela);
    await esperar();
    await clicar(w, 'equipamento-abrir-9001');
    await esperar();
    expect(w.find('[data-testid="ciclo-pgts"]').attributes('href')).toBe(
      '/api/manutencao/equipamentos/pgts/documento',
    );
    // Fechada, a seção não lê nada.
    expect(ps.some((p) => p.url.includes('/operadores'))).toBe(false);
    await clicar(w, 'ciclo-alternar');
    await esperar();
    expect(
      ps.some((p) => p.url === '/api/manutencao/modelos/cursos?fabricante=FABRICANTE+SINT&modelo=M1'),
    ).toBe(true);
    expect(w.find('[data-testid="ciclo-curso-31"]').text()).toContain('OPERACAO DO MONITOR SINTETICO');
    expect(w.find('[data-testid="ciclo-apto-801"]').text()).toContain('OPERADORA SINTETICA');
    expect(w.find('[data-testid="ciclo-pendente-802"]').text()).toContain('OPERACAO DO MONITOR SINTETICO');
    expect(w.find('[data-testid="ciclo-indice-valor"]').text()).toContain('47 de 100');
    expect(w.find('[data-testid="ciclo-indice-idade"]').text()).toContain('22 de 40 pontos (33 de 60 meses');
    expect(w.find('[data-testid="ciclo-indice-custo"]').text()).toContain('15 de 30');
    expect(w.find('[data-testid="ciclo-indice-falhas"]').text()).toContain('2 corretivas');
    expect(w.find('[data-testid="ciclo-indice-conta"]').text()).toBe(
      'Índice = idade + custo + falhas = 22 + 15 + 10 = 47',
    );
    expect(w.find('[data-testid="ciclo-evento-41"]').text()).toContain('Incorporação');

    // O combo do catálogo tem busca e só os cursos ativos ainda não exigidos.
    const combo = w
      .findAllComponents(SanteSelecao)
      .find((x) => x.attributes('data-testid') === 'ciclo-curso-escolha')!;
    const rotulos = (combo.props() as { opcoes: { rotulo: string }[] }).opcoes.map((o) => o.rotulo);
    expect(rotulos.some((r) => r.includes('C-702') && r.includes('não vence'))).toBe(true);
    expect(rotulos.some((r) => r.includes('C-701') || r.includes('C-703'))).toBe(false);
    await escolher(w, 'ciclo-curso-escolha', 702);
    await enviarForm(w, 'ciclo-curso-form');
    expect(posts(ps, '/modelos/cursos')[0]!.corpo).toEqual({
      fabricante: 'FABRICANTE SINT',
      modelo: 'M1',
      curso: 702,
    });
    expect(w.find('[data-testid="ciclo-mensagem"]').text()).toContain('Curso exigido');

    // Deixar de exigir: motivo curto não sai; com motivo, DELETE com o motivo no corpo.
    await clicar(w, 'ciclo-curso-remover-31');
    await digitar(w, 'ciclo-curso-motivo', 'curto');
    await enviarForm(w, 'ciclo-curso-form-remover-31');
    expect(ps.some((p) => p.metodo === 'DELETE')).toBe(false);
    expect(w.find('[data-testid="ciclo-problemas"]').text()).toContain('10 caracteres');
    await digitar(w, 'ciclo-curso-motivo', 'Curso trocado pelo fabricante sintetico.');
    await enviarForm(w, 'ciclo-curso-form-remover-31');
    const del = ps.find((p) => p.metodo === 'DELETE')!;
    expect(del.url).toBe('/api/manutencao/modelos/cursos/31');
    expect(del.corpo).toEqual({ motivo: 'Curso trocado pelo fabricante sintetico.' });

    // Evento: o próximo da ordem vem escolhido (desativação); o descarte incompleto é conferido antes do servidor.
    await clicar(w, 'ciclo-evento-novo');
    const tipo = w
      .findAllComponents(SanteSelecao)
      .find((x) => x.attributes('data-testid') === 'ciclo-evento-tipo')!;
    expect((tipo.props() as { modelValue: unknown }).modelValue).toBe('desativacao');
    await escolher(w, 'ciclo-evento-tipo', 'descarte');
    await digitar(w, 'ciclo-evento-motivo', 'Fim da vida util do monitor sintetico.');
    await digitar(w, 'ciclo-evento-autorizado', 'Diretoria Sintetica');
    await enviarForm(w, 'ciclo-evento-form');
    expect(w.find('[data-testid="ciclo-problemas"]').text()).toContain('certificado de destinação');
    expect(posts(ps, '/eventos')).toHaveLength(0);
    await escolher(w, 'ciclo-evento-tipo', 'desativacao');
    await enviarForm(w, 'ciclo-evento-form');
    expect(w.find('[data-testid="recusa-manutencao"]').text()).toContain('ordem do ciclo de vida');
    recusar = false;
    await enviarForm(w, 'ciclo-evento-form');
    expect(posts(ps, '/equipamentos/9001/eventos').at(-1)!.corpo).toEqual({
      tipo: 'desativacao',
      data: HOJE,
      motivo: 'Fim da vida util do monitor sintetico.',
      documento: null,
      destino: null,
      valorObtidoCent: null,
      autorizadoPor: 'Diretoria Sintetica',
    });
    expect(w.find('[data-testid="ciclo-mensagem"]').text()).toContain('Evento do ciclo de vida registrado');
  });

  it('descarte com destino e valor obtido em centavos; sem fabricante e modelo, não pede cursos', async () => {
    const ps = simular(
      (u, m) => {
        if (m === 'POST')
          return {
            status: 201,
            corpo: { ok: true, id: 43, versao: 1, mensagem: 'Evento do ciclo de vida registrado.' },
          };
        if (u === '/api/manutencao/equipamentos/9001')
          return { corpo: { ...FICHA, fabricante: null, modelo: null } };
        return null;
      },
      apoio({ pode: CHEFIA }),
    );
    const w = montar(EquipamentosTela);
    await esperar();
    await clicar(w, 'equipamento-abrir-9001');
    await esperar();
    await clicar(w, 'ciclo-alternar');
    await esperar();
    expect(w.find('[data-testid="ciclo-sem-modelo"]').exists()).toBe(true);
    expect(ps.some((p) => p.url.includes('/modelos/cursos'))).toBe(false);
    await clicar(w, 'ciclo-evento-novo');
    await escolher(w, 'ciclo-evento-tipo', 'descarte');
    await escolher(w, 'ciclo-evento-destino', 'venda');
    await digitar(w, 'ciclo-evento-documento', 'CERT-SINT-9');
    await digitar(w, 'ciclo-evento-valor', '1.234,56');
    await digitar(w, 'ciclo-evento-motivo', 'Leilao sintetico do equipamento.');
    await digitar(w, 'ciclo-evento-autorizado', 'Diretoria Sintetica');
    await enviarForm(w, 'ciclo-evento-form');
    expect(posts(ps, '/equipamentos/9001/eventos')[0]!.corpo).toEqual({
      tipo: 'descarte',
      data: HOJE,
      motivo: 'Leilao sintetico do equipamento.',
      documento: 'CERT-SINT-9',
      destino: 'venda',
      valorObtidoCent: 123456,
      autorizadoPor: 'Diretoria Sintetica',
    });
  });
});

describe('PMOC e infraestrutura crítica (W0-08, M4)', () => {
  const MODELOS = [
    {
      codigo: 'pmocAr',
      versao: 1,
      nome: 'PMOC: equipamento de ar condicionado',
      atividade: 'preventiva',
      periodicidade: { quantidade: 1, unidade: 'meses' },
      norma: 'Lei 13.589/2018; Portaria GM/MS 3.523/1998',
      procedimento: '1. Filtros de ar: limpar ou trocar.',
      pmoc: true,
    },
    {
      codigo: 'geradorEnergia',
      versao: 1,
      nome: 'Teste do grupo gerador de emergência',
      atividade: 'inspecao',
      periodicidade: { quantidade: 1, unidade: 'meses' },
      norma: 'RDC 50/2002',
      procedimento: '1. Conferir combustível.',
      pmoc: false,
    },
  ];
  const recusa = (codigo: string) => ({
    status: 409,
    corpo: { type: 'about:blank', title: 'Recusada', status: 409, codigo, detail: codigo },
  });
  const COM_MODELO = {
    ...PAINEL.itens[1]!,
    plano: 9203,
    equipamento: PAINEL.itens[0]!.equipamento,
    modelo: 'pmocAr',
  };

  it('instala o modelo pronto na ficha com o corpo certo, mostra norma e roteiro, traduz modelo-instalado e põe o selo no plano', async () => {
    let instalado = true;
    const ps = simular(
      (u, m) => {
        if (u === '/api/manutencao/plano/modelos') return { corpo: MODELOS };
        if (m === 'POST' && u === '/api/manutencao/plano/modelo')
          return instalado
            ? recusa('modelo-instalado')
            : { status: 201, corpo: { ok: true, id: 9204, versao: 0, mensagem: 'Modelo instalado.' } };
        if (/\/equipamentos\/9001$/.test(u))
          return { corpo: { ...FICHA, planos: [PAINEL.itens[0], COM_MODELO] } };
        return null;
      },
      apoio({ pode: CHEFIA }),
    );
    const w = montar(EquipamentosTela);
    await esperar();
    await clicar(w, 'equipamento-abrir-9001');
    await esperar();
    expect(w.find('[data-testid="plano-modelo-9203"]').text()).toBe(
      'Modelo: PMOC: equipamento de ar condicionado',
    );
    expect(w.find('[data-testid="plano-modelo-9201"]').exists()).toBe(false);

    await clicar(w, 'plano-modelo');
    await esperar();
    expect(opcoesDoCombo(w, 'modelo-plano-escolha')).toEqual(['pmocAr', 'geradorEnergia']);
    // Sem o modelo, o esquema recusa antes de enviar.
    await enviarForm(w, 'modelo-plano-form');
    expect(posts(ps, '/plano/modelo')).toHaveLength(0);
    expect(w.find('[data-testid="modelo-plano-problemas"]').exists()).toBe(true);

    await escolher(w, 'modelo-plano-escolha', 'pmocAr');
    expect(w.find('[data-testid="modelo-plano-resumo"]').text()).toContain('Lei 13.589/2018');
    expect(w.find('[data-testid="modelo-plano-resumo"]').text()).toContain('A cada 1 meses');
    await enviarForm(w, 'modelo-plano-form');
    expect(posts(ps, '/plano/modelo')[0]!.corpo).toEqual({
      equipamento: 9001,
      modelo: 'pmocAr',
      dataBase: HOJE,
      executor: 'interno',
      cobertura: null,
    });
    expect(w.find('[data-testid="recusa-manutencao"]').text()).toContain('já está instalado e ativo');

    instalado = false;
    await escolher(w, 'modelo-plano-escolha', 'geradorEnergia');
    await enviarForm(w, 'modelo-plano-form');
    expect(posts(ps, '/plano/modelo')[1]!.corpo).toMatchObject({ modelo: 'geradorEnergia' });
    expect(w.find('[data-testid="modelo-plano-form"]').exists()).toBe(false);
    expect(w.text()).toContain('Modelo instalado.');
  });

  it('painel: selo do modelo e relatório do PMOC com o período (sem responsável técnico, a recusa traduzida; com ele, o PDF)', async () => {
    let semResponsavel = true;
    const ps = simular(
      (u) => {
        if (u.startsWith('/api/manutencao/plano/painel'))
          return { corpo: { ...PAINEL, itens: [...PAINEL.itens, COM_MODELO] } };
        if (u.startsWith('/api/manutencao/plano/pmoc/relatorio'))
          return semResponsavel ? recusa('pmoc-sem-responsavel') : { corpo: { pdf: true } };
        return null;
      },
      apoio({ pode: CHEFIA }),
    );
    const criar = vi.fn(() => 'blob:pmoc');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: criar, revokeObjectURL: vi.fn() }));
    const w = montar(EquipamentosTela);
    await esperar();
    await clicar(w, 'equipamentos-aba-painel');
    await esperar();
    expect(w.find('[data-testid="painel-modelo-9203"]').text()).toContain('PMOC');
    expect(w.find('[data-testid="painel-modelo-9201"]').exists()).toBe(false);

    await enviarForm(w, 'pmoc-relatorio');
    const pedido = ps.find((p) => p.url.startsWith('/api/manutencao/plano/pmoc/relatorio'))!;
    expect(pedido.url).toBe(`/api/manutencao/plano/pmoc/relatorio?de=${HOJE.slice(0, 4)}-01-01&ate=${HOJE}`);
    expect(w.find('[data-testid="recusa-manutencao"]').text()).toContain(
      'Falta o responsável técnico do PMOC',
    );
    expect(criar).not.toHaveBeenCalled();

    semResponsavel = false;
    await enviarForm(w, 'pmoc-relatorio');
    expect(criar).toHaveBeenCalledTimes(1);
    expect(w.find('[data-testid="recusa-manutencao"]').exists()).toBe(false);
    expect(w.find('[data-testid="pmoc-gerado"]').text()).toContain(
      `pmoc_${HOJE.slice(0, 4)}-01-01_${HOJE}.pdf`,
    );
  });
});
