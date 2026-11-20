// @vitest-environment jsdom
// Tela dos contratos com fornecedores (M55, etapa 3): os textos cobrem todo evento, vigência e situação sem citar o
// sistema anterior; os apoios puros (dinheiro digitado, eventos por permissão, exceção disponível); o painel e a lista;
// o contrato aberto com o saldo e as parcelas impressas; o aditivo e a avaliação enviados à rota da sua permissão com a
// Idempotency-Key; o cadastro recusa gestor igual ao fiscal antes de enviar; com a funcionalidade em consulta, as ações
// desabilitadas e o motivo. Dados SINTÉTICOS; o fetch é simulado.
import {
  type ContratoDetalhe,
  type ContratoResumo,
  type EventoContrato,
  FAIXAS_VIGENCIA,
  SITUACOES_CONTRATO_FORNECEDOR,
  TIPOS_EVENTO_CONTRATO,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import ContratoFormulario from './componentes/ContratoFormulario.vue';
import EscolhaContrato from './componentes/EscolhaContrato.vue';
import {
  eventosRegistraveis,
  excecoesDisponiveis,
  foraDaVigencia,
  lerDinheiro,
  rotuloEvento,
  rotuloFaixa,
} from './componentes/contrato-tela.js';
import { mensagensContrato } from './i18n-contrato.js';
import ContratosTela from './telas/ContratosTela.vue';

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
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montar = (c: unknown, props: Record<string, unknown> = {}) =>
  mount(c as never, {
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

interface Chamada {
  url: string;
  metodo: string;
  corpo: Record<string, unknown> | null;
  chave: string | null;
}
function simular(rota: (url: string, metodo: string) => unknown): Chamada[] {
  const chamadas: Chamada[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      const h = (init?.headers ?? {}) as Record<string, string>;
      chamadas.push({
        url: String(url),
        metodo,
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        chave: h['idempotency-key'] ?? null,
      });
      return new Response(JSON.stringify(rota(String(url), metodo)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return chamadas;
}
afterEach(() => vi.unstubAllGlobals());

const gravacao = (
  ligada: boolean,
  ops: Record<string, boolean> = { editar: true, aditar: true, avaliar: true },
) => ({
  ligada,
  motivo: ligada ? null : 'Os contratos com fornecedores ainda não foram liberados neste estabelecimento.',
  operacoes: Object.fromEntries(
    Object.entries(ops).map(([o, p]) => [o, { pode: ligada && p, motivo: null }]),
  ),
});

const resumo: ContratoResumo = {
  id: 41,
  numero: 'CT-SINT-01',
  fornecedor: 7001,
  fornecedorNome: 'DISTRIBUIDORA SINTÉTICA ALFA LTDA',
  tipo: 'fornecimento',
  objeto: 'Fornecimento sintético de luvas e seringas',
  critico: true,
  inicio: '2026-01-01',
  fim: '2026-12-31',
  situacao: 'ativo',
  faixa: 'vence-90',
  diasParaVencer: 64,
  valorTotal: 120_000,
  saldo: 95_000,
  gestor: 'SINT.GERCOMPRAS',
  fiscal: 'SINT.CONTRATOS',
  versao: 3,
};

const evento = (x: Partial<EventoContrato>): EventoContrato => ({
  id: 1,
  tipo: 'aditivo',
  data: null,
  valor: null,
  percentual: null,
  novoFim: null,
  numeroTermo: null,
  notas: null,
  resultado: null,
  descricao: null,
  documento: null,
  usado: false,
  usuario: 'SINT.GERCOMPRAS',
  criadoEm: '2026-10-20T10:00:00',
  ...x,
});

const detalhe: ContratoDetalhe & { gravacao: ReturnType<typeof gravacao> } = {
  ...resumo,
  indiceReajuste: 'ipca',
  dataBase: '2025-12-01',
  proximoReajuste: '2026-12-01',
  garantia: 'nenhuma',
  garantiaValor: null,
  garantiaValidade: null,
  centroCusto: null,
  centroCustoNome: null,
  observacao: null,
  valorInicial: 100_000,
  fimOriginal: '2026-12-31',
  saldoDetalhe: {
    valorInicial: 100_000,
    aditivos: 20_000,
    reajustes: 0,
    renovacoes: 0,
    valorTotal: 120_000,
    pedidos: 15_000,
    titulosAvulsos: 10_000,
    titulosDePedidos: 5_000,
    consumido: 25_000,
    saldo: 95_000,
    percentualConsumido: 20.83,
    conta: '100.000,00 + 20.000,00 + 0,00 + 0,00 − 15.000,00 − 10.000,00 = 95.000,00',
  },
  ultimaAvaliacao: null,
  proximaAvaliacao: '2026-07-01',
  avisos: [{ codigo: 'avaliacao-vencida', mensagem: 'A avaliação do fornecedor está vencida.' }],
  eventos: [
    evento({ id: 5, tipo: 'aditivo', valor: 20_000, numeroTermo: 'TA-1', descricao: 'Acréscimo sintético' }),
  ],
  vinculos: [],
  criadoPor: 'SINT.CONTRATOS',
  criadoEm: '2026-01-01T09:00:00',
  gravacao: gravacao(true),
};

const lista = (ligada = true) => ({
  hoje: '2026-10-28',
  itens: [resumo],
  pagina: 1,
  cortada: false,
  painel: {
    hoje: '2026-10-28',
    ativos: 1,
    porFaixa: {
      'a-iniciar': 0,
      vigente: 0,
      'vence-90': 1,
      'vence-60': 0,
      'vence-30': 0,
      vencido: 0,
      encerrado: 0,
    },
    avaliacaoVencida: 1,
    saldoExcedido: 0,
  },
  gravacao: gravacao(ligada),
});

const rotaPadrao = (url: string, metodo: string) => {
  if (metodo !== 'GET')
    return { ok: true, id: 9, repetido: false, mensagem: 'Termo aditivo registrado.', saldo: null };
  if (/\/contratos\/41$/.test(url)) return detalhe;
  if (url.includes('/contratos/centros')) return { itens: [{ codigo: 9001, nome: 'SETOR SINTÉTICO' }] };
  return lista();
};

describe('textos dos contratos com fornecedores', () => {
  it('cobrem os eventos, as vigências e as situações e não citam o sistema anterior', () => {
    for (const e of TIPOS_EVENTO_CONTRATO) expect(rotuloEvento(e.codigo)).not.toBe('—');
    for (const f of FAIXAS_VIGENCIA) expect(rotuloFaixa(f.codigo)).not.toBe('—');
    expect(SITUACOES_CONTRATO_FORNECEDOR).toHaveLength(3);
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    const todos = valores(mensagensContrato).join('\n');
    expect(todos).not.toMatch(/spdata|legado|sistema anterior|GECADPED|MFCONPAG|SGH_/i);
    // vue-i18n: | separa plural e @ liga mensagens; nenhum texto os usa sem querer.
    expect(todos).not.toMatch(/[|@]/);
  });
});

describe('apoios puros da tela', () => {
  it('lê o dinheiro com vírgula, ponto de milhar ou ponto decimal', () => {
    expect(lerDinheiro('1.234,56')).toBe(1234.56);
    expect(lerDinheiro('1234.5')).toBe(1234.5);
    expect(lerDinheiro('-500,00')).toBe(-500);
    expect(lerDinheiro('R$ 10,00')).toBe(10);
    expect(lerDinheiro('')).toBeNull();
    expect(lerDinheiro('dez')).toBeNull();
  });

  it('os eventos registráveis seguem a permissão de agir de cada rota', () => {
    expect(eventosRegistraveis(gravacao(true, { editar: true, aditar: false, avaliar: true }))).toEqual([
      'ocorrencia',
      'anexo',
      'encerramento',
      'rescisao',
    ]);
    expect(eventosRegistraveis(gravacao(true, { editar: false, aditar: true, avaliar: false }))).toEqual([
      'aditivo',
      'reajuste',
      'renovacao',
      'excecao',
    ]);
    expect(eventosRegistraveis(gravacao(false))).toEqual([]);
    expect(eventosRegistraveis(null)).toEqual([]);
  });

  it('a exceção disponível: não usada e dentro dos 30 dias, a mais nova primeiro', () => {
    const xs = excecoesDisponiveis(
      [
        evento({ id: 1, tipo: 'excecao', criadoEm: '2026-10-01T08:00:00' }),
        evento({ id: 2, tipo: 'excecao', criadoEm: '2026-10-20T08:00:00' }),
        evento({ id: 3, tipo: 'excecao', usado: true, criadoEm: '2026-10-21T08:00:00' }),
        evento({ id: 4, tipo: 'excecao', criadoEm: '2026-09-01T08:00:00' }),
        evento({ id: 5, tipo: 'ocorrencia', criadoEm: '2026-10-22T08:00:00' }),
      ],
      '2026-10-28',
    );
    expect(xs.map((x) => x.id)).toEqual([2, 1]);
    expect(foraDaVigencia('vencido')).toBe(true);
    expect(foraDaVigencia('a-iniciar')).toBe(true);
    expect(foraDaVigencia('vence-30')).toBe(false);
  });
});

describe('a tela dos contratos', () => {
  it('o painel e a lista com a vigência, o valor e o saldo', async () => {
    simular(rotaPadrao);
    const w = montar(ContratosTela);
    await flushPromises();
    expect(w.get('[data-testid="ctr-painel-ativos"]').text()).toBe('1');
    expect(w.get('[data-testid="ctr-painel-vence-90"]').text()).toContain('Vence em até 90 dias: 1');
    expect(w.get('[data-testid="ctr-painel-avaliacao"]').text()).toBe('1');
    const linha = w.get('[data-testid="ctr-linha-41"]');
    expect(linha.text()).toContain('CT-SINT-01');
    expect(linha.text()).toContain('faltam 64 dia(s)');
    expect(w.get('[data-testid="ctr-saldo-41"]').text()).toMatch(/95\.000,00/);
    expect(w.find('[data-testid="ctr-desligado"]').exists()).toBe(false);
  });

  it('o contrato aberto mostra o saldo com as parcelas e os avisos', async () => {
    simular(rotaPadrao);
    const w = montar(ContratosTela);
    await flushPromises();
    await w.get('[data-testid="ctr-abrir-41"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="ctr-det-saldo-valor"]').text()).toMatch(/95\.000,00/);
    expect(w.get('[data-testid="ctr-det-saldo-conta"]').text()).toContain('= 95.000,00');
    expect(w.get('[data-testid="ctr-det-aviso-avaliacao-vencida"]').text()).toContain('vencida');
    expect(w.get('[data-testid="ctr-det-saldo"]').text()).toContain('não abatem de novo');
    await w.get('[data-testid="ctr-det-aba-eventos"]').trigger('click');
    expect(w.get('[data-testid="ctr-det-evento-5"]').text()).toContain('termo TA-1');
  });

  it('o aditivo vai à rota de aditamentos com a versão e a Idempotency-Key, e avisa acima de 25%', async () => {
    const chamadas = simular(rotaPadrao);
    const w = montar(ContratosTela);
    await flushPromises();
    await w.get('[data-testid="ctr-abrir-41"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="ctr-det-aba-registrar"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="ctr-det-ev-termo"]').setValue('TA-2');
    await w.get('[data-testid="ctr-det-ev-valor"]').setValue('10.000,00');
    expect(w.get('[data-testid="ctr-det-ev-acrescimo"]').text()).toContain('30%');
    await w.get('[data-testid="ctr-det-ev-desc"]').setValue('Acréscimo sintético de consumo');
    await w.get('form.formulario-contrato').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.url).toBe('/api/suprimentos/contratos/41/aditamentos');
    expect(post.corpo).toMatchObject({
      tipo: 'aditivo',
      versao: 3,
      valor: 10_000,
      numeroTermo: 'TA-2',
      novoFim: null,
    });
    expect(post.chave).toBeTruthy();
    expect(post.corpo!['chave']).toBe(post.chave);
    expect(w.get('[data-testid="ctr-det-mensagem"]').text()).toBe('Termo aditivo registrado.');
  });

  it('a avaliação mostra a prévia do resultado e vai à rota de avaliações', async () => {
    const chamadas = simular(rotaPadrao);
    const w = montar(ContratosTela);
    await flushPromises();
    await w.get('[data-testid="ctr-abrir-41"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="ctr-det-aba-avaliacao"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="ctr-det-av-previa"]').text()).toContain('Qualificado (média 5)');
    await w.get('form.formulario-contrato').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.url).toBe('/api/suprimentos/contratos/41/avaliacoes');
    expect(post.corpo).toMatchObject({
      tipo: 'avaliacao',
      versao: 3,
      notas: { qualidade: 5, prazo: 5, atendimento: 5, documentacao: 5 },
    });
  });

  it('em consulta: o motivo e o novo contrato desabilitado', async () => {
    simular((url) => (url.includes('/contratos/41') ? detalhe : lista(false)));
    const w = montar(ContratosTela);
    await flushPromises();
    expect(w.get('[data-testid="ctr-desligado"]').text()).toContain('ainda não foram liberados');
    expect(w.get('[data-testid="ctr-novo"]').attributes('disabled')).toBeDefined();
  });
});

describe('o cadastro do contrato', () => {
  it('pede os campos que faltam e recusa o gestor igual ao fiscal antes de enviar', async () => {
    const chamadas = simular(rotaPadrao);
    const w = montar(ContratoFormulario, { pode: true, contrato: null });
    await flushPromises();
    expect(w.get('[data-testid="ctr-faltam"]').text()).toContain('Número do contrato');
    expect(w.get('[data-testid="ctr-gravar"]').attributes('disabled')).toBeDefined();
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);
  });

  it('na alteração o número, a vigência e o valor ficam fixos e vai pelo PUT com a versão', async () => {
    const chamadas = simular(rotaPadrao);
    const w = montar(ContratoFormulario, { pode: true, contrato: detalhe });
    await flushPromises();
    expect(w.get('[data-testid="ctr-numero"]').attributes('disabled')).toBeDefined();
    expect(w.get('[data-testid="ctr-valor"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="ctr-conflito"]').exists()).toBe(false);
    await w.get('[data-testid="ctr-objeto"]').setValue('Fornecimento sintético de luvas, seringas e agulhas');
    await w.get('form').trigger('submit');
    await flushPromises();
    const put = chamadas.find((c) => c.metodo === 'PUT')!;
    expect(put.url).toBe('/api/suprimentos/contratos/41');
    expect(put.chave).toBeNull();
    expect(put.corpo).toMatchObject({
      versao: 3,
      gestor: 'SINT.GERCOMPRAS',
      fiscal: 'SINT.CONTRATOS',
      dataBase: '2025-12-01',
    });
    expect(w.emitted('gravado')?.[0]).toEqual([9, 'Termo aditivo registrado.']);
  });
});

describe('a escolha do contrato no pedido e no título', () => {
  it('os contratos ativos do fornecedor; o vigente sem exceção', async () => {
    const chamadas = simular(rotaPadrao);
    const w = montar(EscolhaContrato, { fornecedor: 7001, testid: 'esc', modelValue: null });
    await flushPromises();
    expect(chamadas[0]!.url).toBe('/api/suprimentos/contratos?situacao=ativo&fornecedor=7001');
    expect(w.find('[data-testid="esc"]').exists()).toBe(true);
    (w.vm as unknown as { $: { setupState: { contrato: number | null } } }).$.setupState.contrato = 41;
    await flushPromises();
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([
      { contrato: 41, excecao: null, pedidoDeOrigem: null },
    ]);
    expect(w.find('[data-testid="esc-precisa-excecao"]').exists()).toBe(false);
  });

  it('o contrato vencido pede a exceção aprovada ainda não usada', async () => {
    const vencido = { ...resumo, faixa: 'vencido' as const, diasParaVencer: -3 };
    const det = {
      ...detalhe,
      ...vencido,
      eventos: [
        evento({
          id: 77,
          tipo: 'excecao',
          criadoEm: '2026-10-25T08:00:00',
          descricao: 'Justificativa sintética',
        }),
      ],
    };
    simular((url) => (/\/contratos\/41$/.test(url) ? det : { ...lista(), itens: [vencido] }));
    const w = montar(EscolhaContrato, { fornecedor: 7001, testid: 'esc', modelValue: null });
    await flushPromises();
    const estado = (
      w.vm as unknown as { $: { setupState: { contrato: number | null; excecao: number | null } } }
    ).$.setupState;
    estado.contrato = 41;
    await flushPromises();
    expect(w.get('[data-testid="esc-precisa-excecao"]').text()).toContain('fora da vigência');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([
      { contrato: 41, excecao: null, pedidoDeOrigem: null },
    ]);
    estado.excecao = 77;
    await flushPromises();
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([
      { contrato: 41, excecao: 77, pedidoDeOrigem: null },
    ]);
  });

  it('no título: o pedido ligado ao contrato que o título paga vai como pedido de origem (regra 6)', async () => {
    const vinculo = {
      id: 901,
      tipo: 'pedido' as const,
      legado: 5001,
      chaveNatural: '2026/123',
      valor: 15_000,
      pedidoDeOrigem: null,
      ativo: true,
      excecao: null,
      usuario: 'SINT.COMPRAS',
      criadoEm: '2026-10-01T09:00:00',
    };
    const det = { ...detalhe, vinculos: [vinculo, { ...vinculo, id: 902, ativo: false }] };
    simular((url) => (/\/contratos\/41$/.test(url) ? det : lista()));
    const w = montar(EscolhaContrato, { fornecedor: 7001, testid: 'esc', modelValue: null, tipo: 'titulo' });
    await flushPromises();
    const estado = (
      w.vm as unknown as { $: { setupState: { contrato: number | null; origem: number | null } } }
    ).$.setupState;
    estado.contrato = 41;
    await flushPromises();
    expect(w.find('[data-testid="esc-origem"]').exists()).toBe(true);
    expect(w.get('[data-testid="esc-origem-explica"]').text()).toContain('não abate o saldo de novo');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([
      { contrato: 41, excecao: null, pedidoDeOrigem: null },
    ]);
    estado.origem = 901;
    await flushPromises();
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([
      { contrato: 41, excecao: null, pedidoDeOrigem: 901 },
    ]);
    // No pedido não há pedido de origem.
    const w2 = montar(EscolhaContrato, { fornecedor: 7001, testid: 'esc', modelValue: null });
    await flushPromises();
    (w2.vm as unknown as { $: { setupState: { contrato: number | null } } }).$.setupState.contrato = 41;
    await flushPromises();
    expect(w2.find('[data-testid="esc-origem"]').exists()).toBe(false);
  });

  it('no contrato aberto: ligar o título do pedido já ligado manda o pedido de origem', async () => {
    const vinculo = {
      id: 901,
      tipo: 'pedido' as const,
      legado: 5001,
      chaveNatural: '2026/123',
      valor: 15_000,
      pedidoDeOrigem: null,
      ativo: true,
      excecao: null,
      usuario: 'SINT.COMPRAS',
      criadoEm: '2026-10-01T09:00:00',
    };
    const det = { ...detalhe, vinculos: [vinculo] };
    const candidato = {
      tipo: 'titulo' as const,
      ids: [7101, 7102],
      chaveNatural: 'NF 555',
      data: '2026-10-20',
      valor: 15_000,
      descricao: 'Título sintético',
    };
    const chamadas = simular((url, metodo) => {
      if (metodo !== 'GET') return { ok: true, id: 9, repetido: false, mensagem: 'Ligado.', saldo: null };
      if (url.endsWith('/candidatos')) return { itens: [candidato] };
      if (/\/contratos\/41$/.test(url)) return det;
      return lista();
    });
    const w = montar(ContratosTela);
    await flushPromises();
    await w.get('[data-testid="ctr-abrir-41"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="ctr-det-aba-vinculos"]').trigger('click');
    await w.get('[data-testid="ctr-det-candidatos"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="ctr-det-origem"]').exists()).toBe(true);
    const painel = w.findComponent({ name: 'ContratoDetalhePainel' });
    (painel.vm as unknown as { $: { setupState: { origem: number | null } } }).$.setupState.origem = 901;
    await flushPromises();
    await w.get('[data-testid="ctr-det-ligar-titulo-7101"]').trigger('click');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST' && c.url.endsWith('/vinculos'))!;
    expect(post.corpo).toMatchObject({
      tipo: 'titulo',
      ids: [7101, 7102],
      excecao: null,
      pedidoDeOrigem: 901,
    });
  });

  it('sem a funcionalidade ligada ou sem a permissão, o campo não aparece', async () => {
    simular(() => lista(false));
    const w = montar(EscolhaContrato, { fornecedor: 7001, testid: 'esc', modelValue: null });
    await flushPromises();
    expect(w.find('[data-testid="esc"]').exists()).toBe(false);
    // Lê contratos, mas sem a permissão de ligar (editar): o campo some.
    vi.unstubAllGlobals();
    simular(() => ({ ...lista(), gravacao: gravacao(true, { editar: false, aditar: true, avaliar: true }) }));
    const w1 = montar(EscolhaContrato, { fornecedor: 7001, testid: 'esc', modelValue: null });
    await flushPromises();
    expect(w1.find('[data-testid="esc"]').exists()).toBe(false);
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"codigo":"sem-permissao"}', { status: 403 })),
    );
    const w2 = montar(EscolhaContrato, { fornecedor: 7001, testid: 'esc', modelValue: null });
    await flushPromises();
    expect(w2.find('[data-testid="esc"]').exists()).toBe(false);
    expect(w2.text()).toBe('');
  });
});
