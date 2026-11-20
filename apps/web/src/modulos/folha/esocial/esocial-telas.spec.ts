// @vitest-environment jsdom
// Tela do eSocial (M53.6, etapa F5): os comuns (ações do evento e do lote pelo ciclo, escolha do lote, origem do evento
// do trabalhador, FAP, formulário do empregador, vigência, retorno, contagem do sistema externo); todo código do
// contrato tem texto, sem nome de outro sistema; consulta sem ações; gerar os de tabela pela prévia e gravar; montar o
// lote com os validados (grupo misto barrado); evento do trabalhador com o afastamento escolhido e a recusa traduzida;
// detalhe com o XML; descartar; enviar o lote com confirmação, registrar o retorno e cancelar; conciliação conferida;
// parâmetros com nova vigência; ficha do colaborador; pendências só contadas. Dados SINTÉTICOS; o fetch é simulado.
import {
  AMBIENTES_ESOCIAL,
  esquemaEmpregadorEsocial,
  esquemaFichaEsocialVinculo,
  esquemaRetornoLoteEsocial,
  GRUPOS_EVENTO_ESOCIAL,
  OPERACOES_TABELA_ESOCIAL,
  RECUSAS_ESOCIAL,
  SITUACOES_EVENTO_ESOCIAL,
  SITUACOES_LINHA_CONCILIACAO,
  SITUACOES_LOTE_ESOCIAL,
  TRANSMISSORES_ESOCIAL,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import {
  acoesDoEvento,
  acoesDoLote,
  conferirEscolha,
  entradaDoEmpregador,
  entradaRetorno,
  fichaVazia,
  formDoEmpregador,
  lerExterno,
  lerFap,
  linhaRetornoOk,
  linhasRetorno,
  origemDoEvento,
  rotuloEvento,
  textoFap,
  vigenciaEm,
} from './comum-esocial.js';
import EsocialTela from './EsocialTela.vue';
import { mensagensEsocial } from './i18n.js';

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
const TODAS = [
  'pessoas.esocial.ler',
  'pessoas.esocial.gerar',
  'pessoas.esocial.transmitir',
  'pessoas.folha.ler',
  'pessoas.colaborador.ler',
];
function montar(permissoes: readonly string[] = TODAS) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cliente.setQueryData(CHAVE_SESSAO, {
    usuario: { id: '1', nome: 'Sintético', login: 'SINT.DP.FOLHA' },
    rede: 'r',
    estabelecimentos: [{ codigo: 'pc', nome: 'PC' }],
    estabelecimentoAtivo: 'pc',
    permissoes,
    sintetica: true,
    bloqueioInatividadeSegundos: 0,
  });
  return mount(EsocialTela as never, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: cliente }],
      ] as never,
    },
  });
}

type Pedido = { url: string; metodo: string; corpo: unknown };
type Resposta = { status?: number; corpo: unknown };
function simular(rota: (p: Pedido) => Resposta | null): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const p = {
        url: String(url),
        metodo: init?.method ?? 'GET',
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
      };
      pedidos.push(p);
      const r = rota(p) ?? padrao(p);
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
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  apoioAtual = apoio();
  eventosAtuais = [];
});

const HOJE = '2026-10-28';
const apoio = (gerar = true, transmitir = true) => ({
  hoje: HOJE,
  empresas: [{ codigo: 1, rotulo: 'Empresa Sintética', temCnpj: true }],
  eventos: [],
  leiautes: ['v_S_01_03_00'],
  leiauteCatalogo: [{ evento: 'S-1000', nome: null, versao: 'S-1.3', inicio: '2025-01-01' }],
  motivosAfastamento: [{ codigo: '3', rotulo: 'Doença' }],
  categorias: [
    { codigo: '101', rotulo: 'Empregado geral' },
    { codigo: '901', rotulo: 'Estagiário' },
  ],
  transmissao: { chaveLigada: false, ambiente: 'coletor', podeEnviar: transmitir, motivo: null },
  acoes: { gerar, transmitir },
});
let apoioAtual = apoio();
const evento = (id: number, x: Record<string, unknown> = {}) => ({
  id,
  empresa: 1,
  evento: 'S-1000',
  grupo: 'tabela',
  operacao: 'inclusao',
  idEsocial: `ID1000000000000002026102800000000000${id}`.slice(0, 36),
  vinculo: null,
  matricula: null,
  origem: null,
  referencia: null,
  dataReferencia: '2026-10',
  situacao: 'validado',
  eventoAnterior: null,
  lote: null,
  recibo: null,
  retorno: null,
  leiaute: 'v_S_01_03_00',
  hashXml: 'abc',
  errosXsd: [],
  motivo: null,
  criadoPor: 'SINT.DP.FOLHA',
  criadoEm: '2026-10-28T10:00:00',
  versao: 0,
  ...x,
});
let eventosAtuais: ReturnType<typeof evento>[] = [];
const lote = (id: number, x: Record<string, unknown> = {}) => ({
  id,
  empresa: 1,
  grupo: 'tabela',
  ambiente: 'coletor',
  situacao: 'montado',
  quantidade: 1,
  protocolo: null,
  enviadoPor: null,
  enviadoEm: null,
  criadoPor: 'SINT.DP.FOLHA',
  criadoEm: '2026-10-28T10:00:00',
  versao: 0,
  ...x,
});
const vigencia = (inicio: string, x: Record<string, unknown> = {}) => ({
  id: 1,
  empresa: 1,
  inicio,
  transmissor: 'sante',
  leiaute: 'v_S_01_03_00',
  classTrib: '99',
  indCoop: null,
  indConstr: null,
  indDesFolha: 0,
  indOptRegEletron: 0,
  cnaePrep: '8610101',
  aliqRat: 2,
  fap: 10_000,
  codLotacao: 'LOT01',
  fpas: '515',
  codTercs: '0115',
  ideTabRubr: 'SANTE',
  cnpjSindicato: null,
  motivosAfastamento: { '3': '01' },
  criadoPor: 'SINT.DP.FOLHA',
  criadoEm: '2026-01-02T08:00:00',
  ...x,
});
function padrao(p: Pedido): Resposta {
  if (p.url.endsWith('/esocial/apoio')) return { corpo: apoioAtual };
  if (p.url.includes('/esocial/eventos?') || p.url.endsWith('/esocial/eventos'))
    return { corpo: { itens: eventosAtuais, teto: 500, truncado: false } };
  if (p.url.includes('/esocial/lotes')) return { corpo: { itens: [], teto: 200, truncado: false } };
  if (p.url.includes('/esocial/empregadores')) return { corpo: [] };
  return { corpo: { itens: [] } };
}
const clicar = async (seletor: string) => {
  const b = document.querySelector<HTMLElement>(seletor);
  expect(b, seletor).not.toBeNull();
  b!.click();
  await flushPromises();
  await flushPromises();
};
const escolher = async (testid: string, valor: string) => {
  document.querySelector<HTMLElement>(`[data-testid="${testid}"] [role="combobox"]`)!.click();
  await flushPromises();
  await nextTick();
  const opcao = document.body.querySelector<HTMLElement>(`[role="option"]:has([data-valor="${valor}"])`);
  expect(opcao, `opção ${valor} em ${testid}`).not.toBeNull();
  opcao!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await flushPromises();
};
const marcar = async (testid: string, valor: string) => {
  const c = document.querySelector<HTMLInputElement>(
    `[data-testid="${testid}"] input[data-valor="${valor}"]`,
  );
  expect(c, `caixa ${valor} em ${testid}`).not.toBeNull();
  c!.click();
  await flushPromises();
};
const digitar = async (testid: string, valor: string) => {
  const i = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-testid="${testid}"] input, [data-testid="${testid}"] textarea`,
  )!;
  expect(i, testid).not.toBeNull();
  i.value = valor;
  i.dispatchEvent(new Event('input'));
  i.dispatchEvent(new Event('blur'));
  i.dispatchEvent(new Event('change'));
  await flushPromises();
};
const texto = (seletor: string) => document.querySelector(seletor)?.textContent ?? '';
const desabilitado = (testid: string) =>
  document.querySelector(`[data-testid="${testid}"]`)?.hasAttribute('disabled');
async function abrir(aba: string | null = null) {
  const w = montar();
  await flushPromises();
  await flushPromises();
  if (aba) await clicar(`[data-testid="esocial-aba-${aba}"]`);
  return w;
}
async function abrirCom(permissoes: readonly string[], aba: string | null = null) {
  const w = montar(permissoes);
  await flushPromises();
  await flushPromises();
  if (aba) await clicar(`[data-testid="esocial-aba-${aba}"]`);
  return w;
}
const confirmarDestrutivo = async () => {
  const bs = document.querySelectorAll<HTMLElement>('[data-testid="confirmacao"] button');
  expect(bs.length).toBeGreaterThan(0);
  bs[bs.length - 1]!.click();
  await flushPromises();
  await flushPromises();
};

describe('comuns do eSocial', () => {
  it('ações do evento e do lote pelo ciclo; escolha do lote; origem do evento do trabalhador', () => {
    const a = apoio() as never;
    const consulta = apoio(false, false) as never;
    expect(acoesDoEvento(evento(1) as never, a)).toEqual({
      descartar: true,
      excluir: false,
      retificar: false,
      lote: true,
    });
    const aceito = evento(2, { evento: 'S-2200', grupo: 'nao-periodico', situacao: 'aceito', vinculo: 21 });
    expect(acoesDoEvento(aceito as never, a)).toEqual({
      descartar: false,
      excluir: true,
      retificar: true,
      lote: false,
    });
    expect(
      acoesDoEvento(evento(3, { evento: 'S-3000', grupo: 'nao-periodico', situacao: 'aceito' }) as never, a),
    ).toMatchObject({ excluir: false, retificar: false });
    expect(acoesDoEvento(evento(4, { situacao: 'rejeitado' }) as never, a).descartar).toBe(true);
    expect(acoesDoEvento(evento(5, { situacao: 'enviado' }) as never, a)).toEqual({
      descartar: false,
      excluir: false,
      retificar: false,
      lote: false,
    });
    expect(Object.values(acoesDoEvento(aceito as never, consulta)).some(Boolean)).toBe(false);
    expect(acoesDoLote(lote(1) as never, a)).toEqual({
      enviar: true,
      retorno: false,
      consultar: false,
      cancelar: true,
    });
    expect(acoesDoLote(lote(1, { situacao: 'enviado' }) as never, a)).toEqual({
      enviar: false,
      retorno: true,
      consultar: false,
      cancelar: false,
    });
    // Envio real (produção, com protocolo do eSocial): consulta o retorno pelo serviço.
    expect(
      acoesDoLote(lote(1, { situacao: 'enviado', ambiente: 'producao', protocolo: '1.2.3' }) as never, a)
        .consultar,
    ).toBe(true);
    expect(acoesDoLote(lote(1) as never, apoio(true, false) as never).enviar).toBe(false);
    expect(conferirEscolha([])).toEqual({ ok: false, motivo: 'vazio' });
    expect(conferirEscolha([evento(1), evento(2)] as never)).toEqual({ ok: true, grupo: 'tabela' });
    expect(conferirEscolha([evento(1), evento(2, { grupo: 'nao-periodico' })] as never)).toEqual({
      ok: false,
      motivo: 'misto',
    });
    expect(conferirEscolha(Array.from({ length: 51 }, (_, i) => evento(i + 1)) as never)).toEqual({
      ok: false,
      motivo: 'teto',
    });
    expect(origemDoEvento('S-2230')).toBe('afastamento');
    expect(origemDoEvento('S-2299')).toBe('rescisao');
    expect(origemDoEvento('S-2205')).toBe('data');
    expect(origemDoEvento('S-2206')).toBe('data');
    expect(origemDoEvento('S-2200')).toBe('nenhuma');
    expect(rotuloEvento('S-2200')).toBe('S-2200 · Admissão');
    expect(rotuloEvento('S-9999')).toBe('S-9999');
  });

  it('FAP, formulário e vigência do empregador; retorno; contagem externa; ficha vazia', () => {
    expect(lerFap('1,0000')).toBe(10_000);
    expect(lerFap('0,5')).toBe(5_000);
    expect(lerFap('2.0000')).toBe(20_000);
    expect(lerFap('x')).toBeNull();
    expect(textoFap(12_345)).toBe('1,2345');
    const vs = [vigencia('2026-01'), vigencia('2026-11', { id: 2 }), vigencia('2025-01', { id: 3 })];
    expect(vigenciaEm(vs as never, '2026-10')?.inicio).toBe('2026-01');
    expect(vigenciaEm(vs as never, '2024-12')).toBeNull();
    const f = formDoEmpregador(vs[0] as never, 'v_S_01_03_00', '2026-10');
    expect(f.fap).toBe('1,0000');
    f.cnaePrep = '8610-1/01';
    f.cnpjSindicato = '12.345.678/0001-95';
    f.motivos = { '3': '01', '4': ' ' };
    const e = entradaDoEmpregador(1, f);
    expect(e).toMatchObject({
      cnaePrep: '8610101',
      cnpjSindicato: '12345678000195',
      motivosAfastamento: { '3': '01' },
    });
    expect(esquemaEmpregadorEsocial.safeParse(e).success).toBe(true);
    expect(
      esquemaEmpregadorEsocial.safeParse(entradaDoEmpregador(1, formDoEmpregador(null, 'v_S_01_03_00', null)))
        .success,
    ).toBe(false);
    const ls = linhasRetorno([
      evento(1, { situacao: 'enviado' }),
      evento(2, { situacao: 'aceito' }),
    ] as never);
    expect(ls.map((l) => l.evento)).toEqual([1]);
    expect(linhaRetornoOk(ls[0]!)).toBe(false);
    ls[0]!.codigo = '201';
    ls[0]!.descricao = 'Sucesso';
    ls[0]!.recibo = '1.1.0000000000000000001';
    expect(linhaRetornoOk(ls[0]!)).toBe(true);
    expect(linhaRetornoOk({ ...ls[0]!, recibo: '123' })).toBe(false);
    expect(linhaRetornoOk({ ...ls[0]!, aceito: false, recibo: '' })).toBe(true);
    expect(esquemaRetornoLoteEsocial.safeParse(entradaRetorno(3, ' ', ls)).success).toBe(true);
    expect(entradaRetorno(3, '', ls).protocolo).toBeNull();
    expect(lerExterno({ 'S-1000': '3', 'S-1010': ' ' })).toEqual({ 'S-1000': 3 });
    expect(lerExterno({ 'S-1000': '-1' })).toBeNull();
    const ficha = fichaVazia();
    expect(esquemaFichaEsocialVinculo.safeParse(ficha).success).toBe(false);
  });

  it('todo código do contrato tem texto, sem nome de outro sistema', () => {
    for (const c of RECUSAS_ESOCIAL) expect(mensagensEsocial.recusa[c]).toBeTruthy();
    for (const c of SITUACOES_EVENTO_ESOCIAL) expect(mensagensEsocial.situacoesEvento[c]).toBeTruthy();
    for (const c of SITUACOES_LOTE_ESOCIAL) expect(mensagensEsocial.situacoesLote[c]).toBeTruthy();
    for (const c of AMBIENTES_ESOCIAL) expect(mensagensEsocial.ambientes[c]).toBeTruthy();
    for (const c of GRUPOS_EVENTO_ESOCIAL) expect(mensagensEsocial.grupos[c]).toBeTruthy();
    for (const c of OPERACOES_TABELA_ESOCIAL) expect(mensagensEsocial.operacoes[c]).toBeTruthy();
    for (const c of TRANSMISSORES_ESOCIAL) expect(mensagensEsocial.transmissores[c]).toBeTruthy();
    for (const c of SITUACOES_LINHA_CONCILIACAO) expect(mensagensEsocial.conciliacao.linha[c]).toBeTruthy();
    for (const c of ['conciliada', 'divergente', 'sem-transmissor'] as const)
      expect(mensagensEsocial.conciliacao.situacoes[c]).toBeTruthy();
    expect(JSON.stringify(mensagensEsocial)).not.toMatch(/spdata|legado|sistema atual|sistema antigo/i);
  });
});

describe('tela do eSocial', () => {
  it('consulta: sem gerar, sem lote, sem a ficha; o destino do lote é o coletor', async () => {
    apoioAtual = apoio(false, false);
    eventosAtuais = [evento(1)];
    simular(() => null);
    await abrirCom(['pessoas.esocial.ler']);
    expect(document.querySelector('[data-testid="esocial-so-consulta"]')).not.toBeNull();
    expect(texto('[data-testid="esocial-transmissao"]')).toContain('coletor local');
    expect(document.querySelector('[data-testid="esocial-aba-fichas"]')).toBeNull();
    expect(document.querySelector('[data-testid="esocial-gerar-tabela"]')).toBeNull();
    expect(document.querySelector('[data-testid="esocial-escolha-lote"]')).toBeNull();
    expect(document.querySelector('[data-testid="esocial-evento-descartar-1"]')).toBeNull();
    expect(texto('[data-testid="esocial-evento-1"]')).toContain('S-1000 · Informações do empregador');
  });

  it('gera os de tabela pela prévia conferida e grava; o resultado mostra o XML e as pendências', async () => {
    const xml = '<eSocial><evtInfoEmpregador/></eSocial>';
    const pedidos = simular((p) => {
      if (p.url.endsWith('/esocial/eventos/tabela')) {
        const gravar = (p.corpo as { gravar: boolean }).gravar;
        return {
          corpo: {
            gravado: gravar,
            eventos: [
              {
                evento: 'S-1000',
                operacao: 'inclusao',
                origem: null,
                referencia: null,
                dataReferencia: '2026-10',
                pendencias: [],
                valido: true,
                errosXsd: [],
                xml,
                id: gravar ? 70 : null,
              },
              {
                evento: 'S-1010',
                operacao: 'inclusao',
                origem: 'rubrica',
                referencia: 9,
                dataReferencia: '2026-10',
                pendencias: [
                  { codigo: 'rubrica-sem-natureza', mensagem: 'Rubrica 9 sem a natureza do eSocial.' },
                ],
                valido: false,
                errosXsd: [],
                xml: null,
                id: null,
              },
            ],
          },
        };
      }
      return null;
    });
    await abrir();
    await clicar('[data-testid="esocial-gerar-tabela"]');
    expect(desabilitado('esocial-tabela-previa')).toBe(true);
    await marcar('esocial-tabela-eventos', 'S-1000');
    await marcar('esocial-tabela-eventos', 'S-1010');
    await digitar('esocial-tabela-rubricas', '9, x');
    expect(desabilitado('esocial-tabela-previa')).toBe(true);
    await digitar('esocial-tabela-rubricas', '9, 12');
    await clicar('[data-testid="esocial-tabela-previa"]');
    const previa = pedidos.find((p) => p.url.endsWith('/eventos/tabela'));
    expect(previa?.corpo).toEqual({
      empresa: 1,
      eventos: ['S-1000', 'S-1010'],
      operacao: 'inclusao',
      inicio: '2026-10',
      rubricas: [9, 12],
      gravar: false,
    });
    expect(texto('[data-testid="esocial-resultado-valido-0"]')).toContain('leiaute oficial');
    expect(texto('[data-testid="esocial-resultado"]')).toContain('evtInfoEmpregador');
    expect(texto('[data-testid="esocial-resultado-pendencias-1"]')).toContain('Rubrica 9');
    await clicar('[data-testid="esocial-resultado-gravar"]');
    const gravacoes = pedidos.filter((p) => p.url.endsWith('/eventos/tabela'));
    expect(gravacoes).toHaveLength(2);
    expect((gravacoes[1]!.corpo as { gravar: boolean }).gravar).toBe(true);
    expect(texto('[data-testid="esocial-eventos-aviso"]')).toContain('1 evento(s) gravado(s)');
    expect(document.querySelector('[data-testid="esocial-resultado-gravar"]')).toBeNull();
  });

  it('monta o lote com os validados do mesmo grupo; grupo misto barrado; recusa traduzida', async () => {
    eventosAtuais = [
      evento(1),
      evento(2, { evento: 'S-1005' }),
      evento(3, {
        evento: 'S-2200',
        grupo: 'nao-periodico',
        vinculo: 21,
        matricula: 'S-21',
        dataReferencia: '2026-10-01',
      }),
    ];
    let recusar = true;
    const pedidos = simular((p) => {
      if (p.url.endsWith('/esocial/lotes') && p.metodo === 'POST') {
        if (recusar) {
          recusar = false;
          return {
            status: 422,
            corpo: { title: 'Recusado', status: 422, codigo: 'transmissor-externo', detail: 'x' },
          };
        }
        return { corpo: { lote: lote(5, { quantidade: 2 }), eventos: [] } };
      }
      return null;
    });
    await abrir();
    expect(texto('[data-testid="esocial-evento-3"]')).toContain('Matrícula S-21');
    expect(texto('[data-testid="esocial-evento-3"]')).toContain('01/10/2026');
    await marcar('esocial-escolha-eventos', '1');
    await marcar('esocial-escolha-eventos', '3');
    expect(texto('[data-testid="esocial-escolha-texto"]')).toContain('um só grupo');
    expect(desabilitado('esocial-montar-lote')).toBe(true);
    await marcar('esocial-escolha-eventos', '3');
    await marcar('esocial-escolha-eventos', '2');
    expect(texto('[data-testid="esocial-escolha-texto"]')).toContain('2 evento(s)');
    await clicar('[data-testid="esocial-montar-lote"]');
    expect(texto('[data-testid="recusa-folha"]')).toContain('sistema externo de folha');
    await clicar('[data-testid="esocial-montar-lote"]');
    const montagens = pedidos.filter((p) => p.url.endsWith('/esocial/lotes') && p.metodo === 'POST');
    expect(montagens[1]!.corpo).toEqual({ empresa: 1, eventos: [1, 2] });
    expect(texto('[data-testid="esocial-eventos-aviso"]')).toContain('Lote 5 montado com 2 evento(s)');
  });

  it('evento do trabalhador: busca o colaborador, escolhe o afastamento e mostra a prévia; ficha ausente traduzida', async () => {
    let semFicha = true;
    const pedidos = simular((p) => {
      if (p.url.includes('/pessoas/colaboradores'))
        return {
          corpo: {
            itens: [
              {
                vinculo: 21,
                nome: 'Pessoa Sintética',
                matricula: 'S-21',
                tipo: 'clt',
                cargo: 'Técnico',
                lotacao: null,
                admissao: '2024-01-01',
                desligamento: null,
                estado: 'ativo',
                conselho: null,
              },
            ],
            limitado: false,
          },
        };
      if (p.url.includes('/folha/afastamentos'))
        return {
          corpo: {
            itens: [
              {
                id: 44,
                vinculo: 21,
                matricula: 'S-21',
                motivo: 3,
                motivoRotulo: 'Doença',
                inicio: '2026-10-01',
                fim: '2026-10-20',
                observacao: null,
                situacao: 'ativo',
                motivoCancelamento: null,
                versao: 0,
              },
            ],
          },
        };
      if (p.url.endsWith('/eventos/trabalhador')) {
        if (semFicha) {
          semFicha = false;
          return {
            status: 422,
            corpo: { title: 'x', status: 422, codigo: 'vinculo-sem-esocial', detail: 'x' },
          };
        }
        return {
          corpo: {
            gravado: false,
            eventos: [
              {
                evento: 'S-2230',
                operacao: null,
                origem: 'afastamento',
                referencia: 44,
                dataReferencia: '2026-10-01',
                pendencias: [],
                valido: false,
                errosXsd: ['Element codMotAfast: falta o código.'],
                xml: '<eSocial/>',
                id: null,
              },
            ],
          },
        };
      }
      return null;
    });
    await abrir();
    await clicar('[data-testid="esocial-gerar-trabalhador"]');
    await escolher('esocial-trabalhador-evento', 'S-2230');
    await digitar('esocial-trabalhador-colaborador-termo', 'Sint');
    await clicar('[data-testid="esocial-trabalhador-colaborador-buscar"]');
    await clicar('[data-testid="esocial-trabalhador-colaborador-escolher-21"]');
    expect(desabilitado('esocial-trabalhador-previa')).toBe(true);
    await escolher('esocial-trabalhador-afastamento', '44');
    await clicar('[data-testid="esocial-trabalhador-previa"]');
    expect(texto('[data-testid="recusa-folha"]')).toContain('ficha do eSocial');
    await clicar('[data-testid="esocial-trabalhador-previa"]');
    const previa = pedidos.filter((p) => p.url.endsWith('/eventos/trabalhador'));
    expect(previa[1]!.corpo).toEqual({
      evento: 'S-2230',
      empresa: 1,
      vinculo: 21,
      referencia: 44,
      data: null,
      retificar: null,
      gravar: false,
    });
    expect(texto('[data-testid="esocial-resultado-erros-0"]')).toContain('codMotAfast');
    // Inválido no leiaute: nada a gravar.
    expect(document.querySelector('[data-testid="esocial-resultado-gravar"]')).toBeNull();
  });

  it('detalhe com o XML; descarta com motivo; retifica o aceito com o recibo', async () => {
    eventosAtuais = [
      evento(1, { situacao: 'invalido', errosXsd: ['erro 1'] }),
      evento(2, {
        evento: 'S-2205',
        grupo: 'nao-periodico',
        operacao: null,
        situacao: 'aceito',
        vinculo: 21,
        referencia: 21,
        dataReferencia: '2026-10-05',
        recibo: '1.1.0000000000000000001',
      }),
    ];
    const pedidos = simular((p) => {
      if (p.url.endsWith('/esocial/eventos/1'))
        return { corpo: { evento: eventosAtuais[0], xml: '<eSocial><evtInfoEmpregador/></eSocial>' } };
      if (p.url.endsWith('/eventos/1/descarte'))
        return { corpo: { ...eventosAtuais[0], situacao: 'descartado' } };
      if (p.url.endsWith('/eventos/trabalhador')) return { corpo: { gravado: false, eventos: [] } };
      return null;
    });
    await abrir();
    await clicar('[data-testid="esocial-evento-ver-1"]');
    expect(texto('[data-testid="esocial-evento-xml"]')).toContain('evtInfoEmpregador');
    expect(texto('[data-testid="esocial-evento-erros"]')).toContain('erro 1');
    await clicar('[data-testid="esocial-evento-descartar-1"]');
    await digitar('esocial-descarte-motivo', 'abc');
    expect(desabilitado('esocial-descarte-confirmar')).toBe(true);
    await digitar('esocial-descarte-motivo', 'Gerado por engano');
    await clicar('[data-testid="esocial-descarte-confirmar"]');
    expect(pedidos.find((p) => p.url.endsWith('/descarte'))?.corpo).toEqual({
      motivo: 'Gerado por engano',
      versao: 0,
    });
    expect(texto('[data-testid="esocial-eventos-aviso"]')).toContain('descartado');
    expect(document.querySelector('[data-testid="esocial-evento-descartar-2"]')).toBeNull();
    await clicar('[data-testid="esocial-evento-retificar-2"]');
    await clicar('[data-testid="esocial-trabalhador-previa"]');
    expect(pedidos.find((p) => p.url.endsWith('/eventos/trabalhador'))?.corpo).toEqual({
      evento: 'S-2205',
      empresa: 1,
      vinculo: 21,
      referencia: null,
      data: '2026-10-05',
      retificar: 2,
      gravar: false,
    });
  });

  it('lotes: envia com confirmação, registra o retorno evento a evento e cancela o montado', async () => {
    const lotes = [lote(5), lote(6, { situacao: 'enviado', quantidade: 1, protocolo: 'P1' })];
    const pedidos = simular((p) => {
      if (p.url.includes('/esocial/lotes?') || p.url.endsWith('/esocial/lotes'))
        return { corpo: { itens: lotes, teto: 200, truncado: false } };
      if (p.url.endsWith('/lotes/6'))
        return { corpo: { lote: lotes[1], eventos: [evento(9, { situacao: 'enviado', lote: 6 })] } };
      if (p.url.endsWith('/lotes/5/envio'))
        return { corpo: { lote: { ...lotes[0], situacao: 'enviado' }, eventos: [] } };
      if (p.url.endsWith('/lotes/6/retorno'))
        return { corpo: { lote: { ...lotes[1], situacao: 'processado' }, eventos: [] } };
      if (p.url.endsWith('/lotes/5/cancelamento'))
        return { corpo: { lote: { ...lotes[0], situacao: 'cancelado' }, eventos: [] } };
      return null;
    });
    await abrir('lotes');
    expect(texto('[data-testid="esocial-lote-5"]')).toContain('Coletor local');
    expect(document.querySelector('[data-testid="esocial-lote-retorno-5"]')).toBeNull();
    await clicar('[data-testid="esocial-lote-enviar-5"]');
    expect(pedidos.some((p) => p.url.endsWith('/envio'))).toBe(false);
    await confirmarDestrutivo();
    expect(pedidos.find((p) => p.url.endsWith('/lotes/5/envio'))?.corpo).toEqual({ versao: 0 });
    expect(texto('[data-testid="esocial-lotes-aviso"]')).toContain('Lote 5 enviado');

    await clicar('[data-testid="esocial-lote-retorno-6"]');
    expect(desabilitado('esocial-retorno-gravar')).toBe(true);
    await digitar('esocial-retorno-recibo-9', '1.1.0000000000000000009');
    await digitar('esocial-retorno-codigo-9', '201');
    await digitar('esocial-retorno-descricao-9', 'Sucesso');
    expect(desabilitado('esocial-retorno-gravar')).toBe(false);
    await clicar('[data-testid="esocial-retorno-gravar"]');
    expect(pedidos.find((p) => p.url.endsWith('/lotes/6/retorno'))?.corpo).toEqual({
      versao: 0,
      protocolo: 'P1',
      eventos: [
        { evento: 9, aceito: true, recibo: '1.1.0000000000000000009', codigo: '201', descricao: 'Sucesso' },
      ],
    });
    expect(texto('[data-testid="esocial-lotes-aviso"]')).toContain('Retorno do lote 6 registrado');

    await clicar('[data-testid="esocial-lote-cancelar-5"]');
    await digitar('esocial-lote-cancelar-motivo', 'Lote montado errado');
    await clicar('[data-testid="esocial-lote-cancelar-confirmar"]');
    expect(pedidos.find((p) => p.url.endsWith('/lotes/5/cancelamento'))?.corpo).toEqual({
      motivo: 'Lote montado errado',
      versao: 0,
    });
  });

  it('conciliação: linhas com a situação; registra a conferência com a contagem do sistema externo', async () => {
    const conc = {
      empresa: 1,
      competencia: '2026-10',
      transmissor: 'sante',
      mesmaRaiz: [2],
      linhas: [
        {
          evento: 'S-1200',
          rotulo: 'Remuneração',
          sante: 3,
          externo: null,
          repasse: 2,
          pendenciaLegado: 7,
          situacao: 'repasse-no-periodico',
        },
        {
          evento: 'S-2200',
          rotulo: 'Admissão',
          sante: 1,
          externo: null,
          repasse: 0,
          pendenciaLegado: 0,
          situacao: 'conciliado',
        },
      ],
      situacao: 'conciliada',
      conferida: null,
    };
    const pedidos = simular((p) => {
      if (p.url.includes('/esocial/conciliacao') && p.metodo === 'GET') return { corpo: conc };
      if (p.url.endsWith('/esocial/conciliacao'))
        return {
          corpo: {
            ...conc,
            situacao: 'divergente',
            conferida: {
              por: 'SINT.DP.FOLHA',
              em: '2026-10-28T11:00:00',
              observacao: 'ok',
              situacao: 'divergente',
            },
          },
        };
      return null;
    });
    await abrir('conciliacao');
    expect(pedidos.find((p) => p.url.includes('/conciliacao'))?.url).toContain('competencia=2026-10');
    expect(texto('[data-testid="esocial-conciliacao-transmissor"]')).toContain('Este sistema');
    expect(texto('[data-testid="esocial-conciliacao-linha-S-1200"]')).toContain('Repasse nos periódicos');
    await digitar('esocial-conciliacao-externo-S-2200', 'x');
    expect(desabilitado('esocial-conciliacao-conferir')).toBe(true);
    await digitar('esocial-conciliacao-externo-S-2200', '1');
    await digitar('esocial-conciliacao-observacao', 'ok');
    await clicar('[data-testid="esocial-conciliacao-conferir"]');
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      empresa: 1,
      competencia: '2026-10',
      externo: { 'S-2200': 1 },
      observacao: 'ok',
    });
    expect(texto('[data-testid="esocial-conciliacao-conferida"]')).toContain('Divergente');
  });

  it('parâmetros: nova vigência a partir da em vigor; campos inválidos apontados', async () => {
    const pedidos = simular((p) => {
      if (p.url.includes('/esocial/empregadores') && p.metodo === 'GET')
        return { corpo: [vigencia('2026-01')] };
      if (p.url.endsWith('/esocial/empregadores')) return { corpo: vigencia('2026-10', { id: 2 }) };
      return null;
    });
    await abrir('parametros');
    expect(texto('[data-testid="esocial-vigencia-2026-01"]')).toContain('8610101');
    expect(texto('[data-testid="esocial-leiaute-catalogo"]')).toContain('S-1000');
    await clicar('[data-testid="esocial-parametros-nova"]');
    await digitar('esocial-param-fap', '9,9');
    await clicar('[data-testid="esocial-param-gravar"]');
    expect(texto('[data-testid="esocial-param-invalido"]')).toContain('FAP');
    await digitar('esocial-param-fap', '1,2000');
    await clicar('[data-testid="esocial-param-gravar"]');
    const g = pedidos.find((p) => p.url.endsWith('/esocial/empregadores') && p.metodo === 'POST');
    expect(g?.corpo).toMatchObject({
      empresa: 1,
      inicio: '2026-10',
      fap: 12_000,
      cnaePrep: '8610101',
      motivosAfastamento: { '3': '01' },
    });
    expect(texto('[data-testid="esocial-parametros-aviso"]')).toContain('10/2026');
  });

  it('ficha do colaborador pelo número do vínculo (sem a busca de pessoas); grava com a versão lida', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/esocial/fichas/21') && p.metodo === 'GET')
        return {
          corpo: {
            vinculo: 21,
            matricula: 'S-21',
            preenchida: false,
            ficha: null,
            versao: null,
            alteradoPor: null,
            alteradoEm: null,
          },
        };
      if (p.url.endsWith('/esocial/fichas/21'))
        return {
          corpo: {
            vinculo: 21,
            matricula: 'S-21',
            preenchida: true,
            ficha: (p.corpo as { ficha: unknown }).ficha,
            versao: 0,
            alteradoPor: 'SINT.DP.FOLHA',
            alteradoEm: '2026-10-28T12:00:00',
          },
        };
      return null;
    });
    await abrirCom(['pessoas.esocial.ler', 'pessoas.esocial.gerar'], 'fichas');
    await digitar('esocial-ficha-colaborador-numero', '21');
    await clicar('[data-testid="esocial-ficha-colaborador-usar"]');
    expect(document.querySelector('[data-testid="esocial-ficha-nova"]')).not.toBeNull();
    await clicar('[data-testid="esocial-ficha-gravar"]');
    expect(texto('[data-testid="esocial-ficha-invalida"]')).toContain('nascimento');
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
    const nasc = document.querySelector<HTMLInputElement>('[data-testid="esocial-ficha-nascimento"] input')!;
    nasc.value = '01/02/1990';
    nasc.dispatchEvent(new Event('input'));
    nasc.dispatchEvent(new Event('blur'));
    nasc.dispatchEvent(new Event('change'));
    await flushPromises();
    await digitar('esocial-ficha-logradouro', 'Rua Sintética');
    await digitar('esocial-ficha-numero', '10');
    await digitar('esocial-ficha-cep', '01001-000');
    await digitar('esocial-ficha-municipio', '3550308');
    await digitar('esocial-ficha-uf', 'sp');
    await digitar('esocial-ficha-descricao-jornada', 'Segunda a sexta, 8h às 17h');
    await clicar('[data-testid="esocial-ficha-gravar"]');
    const g = pedidos.find((p) => p.metodo === 'POST');
    expect(g?.corpo).toMatchObject({
      versao: null,
      ficha: {
        nascimento: '1990-02-01',
        endereco: {
          logradouro: 'Rua Sintética',
          cep: '01001000',
          uf: 'SP',
          municipio: '3550308',
          bairro: null,
        },
        estagio: null,
      },
    });
    expect(texto('[data-testid="esocial-ficha-aviso"]')).toContain('gravada');
    expect(texto('[data-testid="esocial-ficha-alterada"]')).toContain('SINT.DP.FOLHA');
  });

  it('pendências acumuladas: só a contagem, por evento e por ano, sem ação', async () => {
    simular((p) => {
      if (p.url.includes('/esocial/pendencias'))
        return {
          corpo: {
            total: 12,
            porEvento: [
              {
                evento: 'S-2200',
                rotulo: 'Admissão',
                grupo: 'nao-periodico',
                quantidade: 12,
                porAno: [{ ano: 2024, quantidade: 12 }],
              },
            ],
          },
        };
      return null;
    });
    await abrir('pendencias');
    expect(texto('[data-testid="esocial-pendencias-total"]')).toContain('12');
    expect(texto('[data-testid="esocial-pendencia-S-2200"]')).toContain('2024: 12');
    expect(document.querySelector('[data-testid="esocial-pendencias"] button')).toBeNull();
  });
});
