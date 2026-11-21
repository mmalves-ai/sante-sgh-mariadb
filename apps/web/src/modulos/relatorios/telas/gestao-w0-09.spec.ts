// @vitest-environment jsdom
// W0-09: pedido de relatório e envio agendado na tela, sempre com motivo: corrigir o pedido aberto, cancelar, excluir
// (a recusa 409 do já atendido mostra os vínculos e oferece o cancelamento); Alterar o envio sem redigitar (só os
// endereços mascarados aparecem e `manterEnderecos` vai no pedido), desativar com motivo, excluir o que já rodou
// recusado com a oferta de desativar; o aviso de envio desligado fora de produção continua. Dados sintéticos.
import { esquemaAgendamentoLido, esquemaPedidoLido, esquemaRelatorioDescrito } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import AgendamentosRelatorioTela from './AgendamentosRelatorioTela.vue';
import PedidosRelatorioTela from './PedidosRelatorioTela.vue';

vi.mock('../../../casca/sessao/pode.js', () => ({ pode: () => true }));

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
const i18n = () => criarI18n(mensagensWeb as unknown as Record<string, unknown>);

const pedido = (o: Record<string, unknown> = {}) => ({
  id: 'P1',
  titulo: 'Censo por ala',
  descricao: 'Pacientes internados por ala com o total diário e o mês.',
  finalidade: 'Planejar a escala de enfermagem',
  area: 'Enfermagem',
  solicitante: 'ANA',
  prazo: '2026-12-15',
  situacao: 'aberto',
  relatorio: null,
  resposta: null,
  respondidoPor: null,
  respondidoEm: null,
  criadoEm: '2026-11-18T08:00:00',
  atrasado: false,
  canceladoEm: null,
  canceladoPor: null,
  motivoCancelamento: null,
  editavel: true,
  cancelavel: true,
  excluivel: true,
  ...o,
});
const envio = (o: Record<string, unknown> = {}) => ({
  id: 'A1',
  relatorio: 'censoDiarioUnidade',
  titulo: 'Censo das 7h',
  parametros: {},
  grupos: ['DIRETORIA'],
  enderecos: 2,
  enderecosMascarados: ['di***@ex***.invalid', 'co***@ex***.invalid'],
  periodicidade: 'diaria',
  hora: '07:00',
  diaSemana: null,
  diaMes: null,
  ativo: true,
  dono: 'ANA',
  proximoEnvio: '2026-11-19T07:00:00',
  ultimoEnvio: '2026-11-18T07:00:00',
  ultimaSituacao: 'enviado',
  ultimaFalha: null,
  falhasSeguidas: 0,
  ...o,
});
const descrito = {
  codigo: 'censoDiarioUnidade',
  titulo: 'Censo diário por unidade',
  descricao: 'Pacientes internados por unidade.',
  area: 'Recepção interna e coordenação de leitos',
  papelDono: 'Coordenação de leitos',
  onda: 1,
  fonte: 'ao-vivo',
  regua: null,
  formula: 'Internados no fim do dia.',
  parametros: [],
  colunas: [],
  tetoLinhas: 1000,
  tempoMaximoMs: 30000,
  conferencia: { situacao: 'pendente', como: 'Contar no mapa de leitos.' },
  liberado: true,
  motivo: null,
  podeExecutar: true,
  podeExportar: true,
  veDadoPessoal: true,
};
const conflito = (codigo: string) =>
  Response.json(
    {
      type: 'about:blank',
      title: 'Recusado',
      status: 409,
      detail: 'Já foi atendido.',
      codigo,
      dependentes: [{ rotulo: 'Execuções do relatório', quantidade: 3, amostra: [], origem: 'logica' }],
      total: 3,
      podeInativar: true,
    },
    { status: 409, headers: { 'content-type': 'application/problem+json' } },
  );

type Chamada = { url: string; metodo: string; corpo: Record<string, unknown> | null };
function servidor(leituras: Record<string, unknown>, gravar: (c: Chamada) => Response) {
  const chamadas: Chamada[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Chamada = {
        url: String(url),
        metodo: init?.method ?? 'GET',
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      chamadas.push(c);
      if (c.metodo === 'GET') {
        const k = Object.keys(leituras).find((u) => c.url.startsWith(u));
        return Response.json(k ? leituras[k] : []);
      }
      return gravar(c);
    }),
  );
  return chamadas;
}
const montar = (tela: Component) =>
  mount(tela, {
    global: {
      plugins: [
        i18n(),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
      stubs: { GrupoDominiosTela: true },
    },
    attachTo: document.body,
  });
const digitar = (w: ReturnType<typeof montar>, testid: string, v: string) =>
  w.get(`[data-testid="${testid}"] input, [data-testid="${testid}"] textarea`).setValue(v);
const confirmarDialogo = async () => {
  // O SanteBotao destrutivo pergunta de novo: o "sim" do diálogo.
  const botoes = [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
  const sim = botoes.find((b) => /confirmar|sim/i.test(b.textContent ?? '')) ?? botoes[botoes.length - 1];
  sim!.click();
  await flushPromises();
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('os dados sintéticos passam pelo contrato', () => {
  expect(esquemaPedidoLido.safeParse(pedido()).error?.issues ?? []).toEqual([]);
  expect(esquemaAgendamentoLido.safeParse(envio()).error?.issues ?? []).toEqual([]);
  expect(esquemaRelatorioDescrito.safeParse(descrito).error?.issues ?? []).toEqual([]);
});

describe('pedidos de relatório (W0-09)', () => {
  it('corrige o aberto só com motivo e cancela com motivo', async () => {
    const chamadas = servidor({ '/api/relatorios/pedidos': [pedido()] }, () => Response.json({ ok: true }));
    const w = montar(PedidosRelatorioTela);
    await flushPromises();
    await w.get('[data-testid="pedido-editar-P1"]').trigger('click');
    await digitar(w, 'pedido-motivo', 'ab');
    await w.get('[data-testid="pedido-novo"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="pedido-motivo-curto"]').exists()).toBe(true);
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);
    await digitar(w, 'pedido-motivo', 'prazo combinado mudou');
    await w.get('[data-testid="pedido-novo"]').trigger('submit');
    await flushPromises();
    const alt = chamadas.find((c) => c.url === '/api/relatorios/pedidos/P1');
    expect(alt?.corpo).toMatchObject({ titulo: 'Censo por ala', motivo: 'prazo combinado mudou' });

    await w.get('[data-testid="pedido-cancelar-P1"]').trigger('click');
    await w.get('[data-testid="acao-motivo"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="acao-motivo-curto"]').exists()).toBe(true);
    await digitar(w, 'acao-motivo-texto', 'a área desistiu do pedido');
    await w.get('[data-testid="acao-motivo"]').trigger('submit');
    await flushPromises();
    const canc = chamadas.find((c) => c.url === '/api/relatorios/pedidos/P1/cancelamento');
    expect(canc?.corpo).toEqual({ motivo: 'a área desistiu do pedido' });
    expect(w.get('[data-testid="pedido-feito"]').text()).toBe('Pedido cancelado.');
  });

  it('excluir o já atendido: a recusa mostra os vínculos e oferece o cancelamento', async () => {
    const chamadas = servidor(
      { '/api/relatorios/pedidos': [pedido({ situacao: 'em-analise', editavel: false, excluivel: false })] },
      (c) => (c.url.endsWith('/exclusao') ? conflito('pedido-ja-executado') : Response.json({ ok: true })),
    );
    const w = montar(PedidosRelatorioTela);
    await flushPromises();
    expect(w.find('[data-testid="pedido-editar-P1"]').exists()).toBe(false);
    await w.get('[data-testid="pedido-excluir-P1"]').trigger('click');
    await digitar(w, 'acao-motivo-texto', 'pedido em duplicidade');
    await w.get('[data-testid="acao-motivo-confirmar"]').trigger('click');
    await flushPromises();
    await confirmarDialogo();
    expect(chamadas.some((c) => c.url === '/api/relatorios/pedidos/P1/exclusao')).toBe(true);
    const recusa = w.get('[data-testid="recusa-vinculos"]').text();
    expect(recusa).toContain('3 registro(s)');
    expect(recusa).toContain('Execuções do relatório: 3');
    await w.get('[data-testid="recusa-vinculos-oferta"]').trigger('click');
    expect(w.get('[data-testid="acao-motivo"]').text()).toContain('Cancelar o pedido');
  });

  it('o cancelado mostra quem, quando e o motivo', async () => {
    servidor(
      {
        '/api/relatorios/pedidos': [
          pedido({
            situacao: 'cancelado',
            canceladoEm: '2026-11-18T09:00:00',
            canceladoPor: 'ANA',
            motivoCancelamento: 'a área desistiu',
            editavel: false,
            cancelavel: false,
            excluivel: false,
          }),
        ],
      },
      () => Response.json({ ok: true }),
    );
    const w = montar(PedidosRelatorioTela);
    await flushPromises();
    expect(w.get('[data-testid="pedido-cancelado-P1"]').text()).toContain('a área desistiu');
    expect(w.find('[data-testid="pedido-excluir-P1"]').exists()).toBe(false);
  });
});

describe('envio agendado (W0-09)', () => {
  const leituras = (a = envio()) => ({
    '/api/relatorios/agendamentos/A1/historico': [
      { evento: 'desativacao', motivo: 'férias da diretoria', por: 'ANA', em: '2026-11-10T10:00:00' },
    ],
    '/api/relatorios/agendamentos': {
      agendamentos: [a],
      origem: { agendamentos: 0, porAno: [], ultimoEnviado: null, naoEnviados: 0 },
      envioLigado: false,
      motivo: 'Fora de produção nada sai (SEM_ENVIO_NO_DEV)',
    },
    '/api/relatorios/catalogo': [descrito],
  });

  it('Alterar mostra só os endereços mascarados, mantém sem redigitar e pede o motivo', async () => {
    const chamadas = servidor(leituras(), () => Response.json({ ok: true }));
    const w = montar(AgendamentosRelatorioTela);
    await flushPromises();
    expect(w.get('[data-testid="agendamento-desligado"]').text()).toContain('SEM_ENVIO_NO_DEV');
    await w.get('[data-testid="agendamento-alterar-A1"]').trigger('click');
    const masc = w.get('[data-testid="agendamento-mascarados"]').text();
    expect(masc).toContain('di***@ex***.invalid');
    expect(w.html()).not.toMatch(/[a-z]+@[a-z]+\.[a-z]+/);
    expect(w.find('[data-testid="agendamento-enderecos"]').exists()).toBe(false);
    await digitar(w, 'agendamento-motivo', 'mudou o horário do plantão');
    await w.get('[data-testid="agendamento-novo"]').trigger('submit');
    await flushPromises();
    const alt = chamadas.find((c) => c.url === '/api/relatorios/agendamentos/A1');
    expect(alt?.corpo).toMatchObject({
      relatorio: 'censoDiarioUnidade',
      titulo: 'Censo das 7h',
      hora: '07:00',
      grupos: ['DIRETORIA'],
      enderecos: [],
      manterEnderecos: true,
      motivo: 'mudou o horário do plantão',
    });
    expect(w.get('[data-testid="agendamento-aviso"]').text()).toBe('Envio alterado.');
  });

  it('desativar pede o motivo; excluir o que já rodou é recusado com a oferta de desativar; histórico', async () => {
    const chamadas = servidor(leituras(), (c) =>
      c.url.endsWith('/exclusao') ? conflito('agendamento-ja-executado') : Response.json({ ok: true }),
    );
    const w = montar(AgendamentosRelatorioTela);
    await flushPromises();
    await w.get('[data-testid="agendamento-desativar-A1"]').trigger('click');
    await digitar(w, 'acao-motivo-texto', 'férias da diretoria');
    await w.get('[data-testid="acao-motivo"]').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.url === '/api/relatorios/agendamentos/A1/ativo')?.corpo).toEqual({
      ativo: false,
      motivo: 'férias da diretoria',
    });

    await w.get('[data-testid="agendamento-excluir-A1"]').trigger('click');
    await digitar(w, 'acao-motivo-texto', 'criado por engano');
    await w.get('[data-testid="acao-motivo-confirmar"]').trigger('click');
    await flushPromises();
    await confirmarDialogo();
    expect(w.get('[data-testid="recusa-vinculos"]').text()).toContain('Execuções do relatório: 3');
    await w.get('[data-testid="recusa-vinculos-oferta"]').trigger('click');
    expect(w.get('[data-testid="acao-motivo"]').text()).toContain('Desativar o envio');

    await w.get('[data-testid="agendamento-historico-A1"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="agendamento-historico"]').text()).toContain('Desativação');
  });

  // Revisão W0-09: os parâmetros gravados do envio em alteração, mesmo quando o relatório não muda.
  const comDias = {
    ...descrito,
    parametros: [{ campo: 'dias', rotulo: 'Dias', tipo: 'inteiro', obrigatorio: false, padrao: '7' }],
  };
  const doisEnvios = () => {
    const a = envio({ id: 'A1', titulo: 'Envio A', parametros: { dias: 10 } });
    const b = envio({ id: 'B2', titulo: 'Envio B', parametros: { dias: 20 } });
    return {
      '/api/relatorios/agendamentos': {
        agendamentos: [a, b],
        origem: { agendamentos: 0, porAno: [], ultimoEnviado: null, naoEnviados: 0 },
        envioLigado: false,
        motivo: 'Fora de produção nada sai (SEM_ENVIO_NO_DEV)',
      },
      '/api/relatorios/catalogo': [comDias],
    };
  };
  const dias = (w: ReturnType<typeof montar>) => (w.get('#ag-dias').element as HTMLInputElement).value;

  it('Alterar A e depois B do mesmo relatório mostra (e grava) os parâmetros de B', async () => {
    expect(esquemaRelatorioDescrito.safeParse(comDias).error?.issues ?? []).toEqual([]);
    const chamadas = servidor(doisEnvios(), () => Response.json({ ok: true }));
    const w = montar(AgendamentosRelatorioTela);
    await flushPromises();
    await w.get('[data-testid="agendamento-alterar-A1"]').trigger('click');
    await flushPromises();
    expect(dias(w)).toBe('10');
    await w.get('[data-testid="agendamento-alterar-B2"]').trigger('click');
    await flushPromises();
    expect(dias(w)).toBe('20');
    await digitar(w, 'agendamento-motivo', 'mudou o horário do plantão');
    await w.get('[data-testid="agendamento-novo"]').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.url === '/api/relatorios/agendamentos/B2')?.corpo).toMatchObject({
      parametros: { dias: 20 },
    });
  });

  it('Alterar com um envio novo do mesmo relatório no formulário troca os padrões pelos gravados', async () => {
    servidor(doisEnvios(), () => Response.json({ ok: true }));
    const w = montar(AgendamentosRelatorioTela);
    await flushPromises();
    // Começa um envio novo do relatório (padrão 7) e, sem desistir, clica em Alterar no B.
    (w.vm as unknown as { $: { setupState: { novo: { relatorio: string } } } }).$.setupState.novo.relatorio =
      'censoDiarioUnidade';
    await flushPromises();
    expect(dias(w)).toBe('7');
    await w.get('[data-testid="agendamento-alterar-B2"]').trigger('click');
    await flushPromises();
    expect(dias(w)).toBe('20');
    // Desistir: o formulário volta limpo; escolher o relatório de novo dá o padrão, não o gravado de B.
    await w.get('[data-testid="agendamento-desistir"]').trigger('click');
    await flushPromises();
    (w.vm as unknown as { $: { setupState: { novo: { relatorio: string } } } }).$.setupState.novo.relatorio =
      'censoDiarioUnidade';
    await flushPromises();
    expect(dias(w)).toBe('7');
  });

  it('reativar pede o motivo e o manda ao servidor', async () => {
    const chamadas = servidor(leituras(envio({ ativo: false })), () => Response.json({ ok: true }));
    const w = montar(AgendamentosRelatorioTela);
    await flushPromises();
    await w.get('[data-testid="agendamento-ativar-A1"]').trigger('click');
    await flushPromises();
    expect(chamadas.some((c) => c.url.endsWith('/ativo'))).toBe(false);
    expect(w.get('[data-testid="acao-motivo"]').text()).toContain('Reativar o envio');
    await digitar(w, 'acao-motivo-texto', 'diretoria voltou das férias');
    await w.get('[data-testid="acao-motivo"]').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.url === '/api/relatorios/agendamentos/A1/ativo')?.corpo).toEqual({
      ativo: true,
      motivo: 'diretoria voltou das férias',
    });
    expect(w.get('[data-testid="agendamento-aviso"]').text()).toBe('Envio reativado.');
  });

  it('excluir o envio já desativado que rodou: recusa sem a oferta de desativar', async () => {
    servidor(leituras(envio({ ativo: false })), (c) =>
      c.url.endsWith('/exclusao')
        ? Response.json(
            {
              type: 'about:blank',
              title: 'O envio já rodou e não se exclui',
              status: 409,
              detail: 'O envio já tem execuções registradas e já está desativado: ele fica no histórico.',
              codigo: 'agendamento-ja-executado',
              dependentes: [
                { rotulo: 'Execuções do relatório', quantidade: 3, amostra: [], origem: 'logica' },
              ],
              total: 3,
              podeInativar: false,
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          )
        : Response.json({ ok: true }),
    );
    const w = montar(AgendamentosRelatorioTela);
    await flushPromises();
    await w.get('[data-testid="agendamento-excluir-A1"]').trigger('click');
    await digitar(w, 'acao-motivo-texto', 'criado por engano');
    await w.get('[data-testid="acao-motivo-confirmar"]').trigger('click');
    await flushPromises();
    await confirmarDialogo();
    expect(w.get('[data-testid="recusa-vinculos"]').text()).toContain('Execuções do relatório: 3');
    expect(w.find('[data-testid="recusa-vinculos-oferta"]').exists()).toBe(false);
    expect(w.get('[data-testid="recusa-vinculos-sem-oferta"]').text()).toContain('já está desativado');
  });
});
