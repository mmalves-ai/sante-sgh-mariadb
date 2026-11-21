// @vitest-environment jsdom
// Telas do portal do médico externo (M50, etapa 3): sem a sessão de médico externo, o convite para entrar; com ela e sem
// o vínculo, o aviso; com o vínculo, a agenda (o paciente como o servidor manda, mascarado), os pedidos com a retirada e o
// pedido de cirurgia que manda o paciente informado e o CSRF do portal; a tela interna liga a conta ao profissional
// sugerido. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import MedicoExternoInternoTela from './telas/MedicoExternoInternoTela.vue';
import PortalMedicoAgendaTela from './telas/PortalMedicoAgendaTela.vue';
import PortalMedicoAssinaturaRetornoTela from './telas/PortalMedicoAssinaturaRetornoTela.vue';
import PortalMedicoAssinaturasTela from './telas/PortalMedicoAssinaturasTela.vue';
import PortalMedicoConfirmarEmailTela from './telas/PortalMedicoConfirmarEmailTela.vue';
import PortalMedicoContaTela from './telas/PortalMedicoContaTela.vue';
import PortalMedicoCriticosTela from './telas/PortalMedicoCriticosTela.vue';
import PortalMedicoExtratoTela from './telas/PortalMedicoExtratoTela.vue';
import PortalMedicoPacientesTela from './telas/PortalMedicoPacientesTela.vue';

const rotaMock = vi.hoisted(() => ({ query: {} as Record<string, string> }));
const navegacao = vi.hoisted(() => ({ provedor: [] as string[], replace: [] as unknown[] }));
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({
    replace: vi.fn(async (x: unknown) => {
      navegacao.replace.push(x);
    }),
    push: vi.fn(),
  }),
  useRoute: () => rotaMock,
}));
vi.mock('./api-portal-medico.js', async (original) => ({
  ...(await original<typeof import('./api-portal-medico.js')>()),
  irAoProvedorAssinatura: (endereco: string) => {
    navegacao.provedor.push(endereco);
  },
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
const montar = (c: unknown) =>
  mount(c as never, {
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: {
        RouterLink: {
          props: ['to'],
          template: `<a :href="typeof to === 'string' ? to : to.path"><slot /></a>`,
        },
      },
    },
  });

type Rota = (url: string, init?: RequestInit) => unknown;
function simular(rota: Rota) {
  const chamadas: { url: string; metodo: string; corpo: unknown; cabecalhos: Record<string, string> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({
        url: String(url),
        metodo: init?.method ?? 'GET',
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
        cabecalhos: (init?.headers ?? {}) as Record<string, string>,
      });
      const r = rota(String(url), init);
      if (r instanceof Response) return r;
      if (r === undefined) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify(r), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return chamadas;
}
const SESSAO = { perfil: 'medicoExterno', nome: 'Cirurgiao Sintetico', expiraEm: '2026-10-25T23:00:00.000Z' };
const AGENDA = {
  vinculado: true,
  profissional: 'CIRURGIAO SINTETICO A',
  de: '2026-10-25',
  ate: '2026-11-24',
  agendamentos: [
    {
      agendamento: 701,
      data: '2026-10-26',
      hora: '08:00',
      duracaoMin: 120,
      sala: 'SALA 2',
      paciente: 'PACIENTE S. S. D.',
      procedimento: 'COLECISTECTOMIA',
      convenio: 'PARTICULAR',
      estado: 'confirmado',
      estadoRotulo: 'Confirmado',
    },
  ],
  truncado: false,
  pedidos: [
    {
      id: 33,
      data: '2026-11-03',
      hora: '14:00',
      duracaoMin: 90,
      sala: 'SALA 2',
      paciente: 'PACIENTE INFORMADO',
      nascimento: '1970-05-02',
      procedimento: 'COLECISTECTOMIA',
      convenio: 'PARTICULAR',
      estado: 'solicitado',
      estadoRotulo: 'Solicitado',
      motivo: null,
      retiravel: true,
      versao: 1,
      edicao: {
        sala: 2,
        data: '2026-11-03',
        hora: '14:00',
        duracaoMin: 90,
        procedimento: 30101271,
        convenio: 10,
        carater: 2,
        anestesia: 0,
        observacao: 'Levar exames',
      },
      versoes: [],
    },
  ],
  podePedir: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
  document.cookie = 'sgh_portal_csrf=; Max-Age=0';
});

describe('portal do médico externo', () => {
  it('sem a sessão de médico externo, o convite para entrar (nada é pedido ao servidor)', async () => {
    const chamadas = simular(() => undefined);
    const w = montar(PortalMedicoExtratoTela);
    await flushPromises();
    expect(w.find('[data-testid="portal-medico-sem-sessao"]').exists()).toBe(true);
    expect(chamadas.map((c) => c.url)).toEqual(['/api/portal/eu']);
  });

  it('a sessão do paciente não abre o portal do médico', async () => {
    simular((url) => (url.endsWith('/eu') ? { ...SESSAO, perfil: 'paciente' } : {}));
    const w = montar(PortalMedicoAgendaTela);
    await flushPromises();
    expect(w.find('[data-testid="portal-medico-sem-sessao"]').exists()).toBe(true);
  });

  it('sem o vínculo, o aviso no extrato', async () => {
    simular((url) =>
      url.endsWith('/eu') ? SESSAO : { vinculado: false, profissional: null, extrato: null },
    );
    const w = montar(PortalMedicoExtratoTela);
    await flushPromises();
    expect(w.get('[data-testid="pm-sem-vinculo"]').text()).toContain('ainda não ligou');
  });

  it('a agenda, os pedidos com a retirada e o pedido com o paciente informado e o CSRF do portal', async () => {
    document.cookie = 'sgh_portal_csrf=csrf-sintetico';
    const chamadas = simular((url, init) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (url.includes('/agenda')) return AGENDA;
      if (url.endsWith('/opcoes'))
        return {
          salas: [{ codigo: 2, nome: 'SALA 2' }],
          convenios: [{ codigo: 10, nome: 'PARTICULAR' }],
          caracteres: [{ codigo: 2, nome: 'ELETIVA' }],
          anestesias: [],
          hoje: '2026-10-25',
        };
      if (url.includes('/procedimentos')) return [{ codigo: 30101271, nome: 'COLECISTECTOMIA' }];
      if (url.endsWith('/pedidos') && init?.method === 'POST')
        return { ok: true, id: 34, mensagem: 'Cirurgia pedida' };
      if (url.endsWith('/retirar')) return { ok: true, id: 33, mensagem: 'Pedido retirado.' };
      return {};
    });
    const w = montar(PortalMedicoAgendaTela);
    await flushPromises();
    expect(w.get('[data-testid="pm-agendamentos"]').text()).toContain('PACIENTE S. S. D.');
    expect(w.get('[data-testid="pm-pedido-situacao-33"]').text()).toBe('Solicitado');
    await w.get('[data-testid="pm-nome"]').setValue('Paciente Informado Sintetico');
    await w.get('[data-testid="pm-nascimento"]').setValue('1970-05-02');
    (w.vm as unknown as Record<string, unknown>)['fSala'] = '2';
    (w.vm as unknown as Record<string, unknown>)['fConvenio'] = '10';
    await w.get('[data-testid="pm-data"]').setValue('2026-11-10');
    await w.get('[data-testid="pm-hora"]').setValue('14:30');
    await w.get('[data-testid="pm-procedimento"]').setValue('cole');
    await w.get('form[role="search"]').trigger('submit');
    await flushPromises();
    await w.get('[data-testid="pm-proc-30101271"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="pm-pedir"]').trigger('click');
    await flushPromises();
    const pedido = chamadas.find((c) => c.url.endsWith('/pedidos') && c.metodo === 'POST');
    expect(pedido?.cabecalhos['x-csrf-portal']).toBe('csrf-sintetico');
    expect(pedido?.corpo).toMatchObject({
      sala: 2,
      data: '2026-11-10',
      hora: '14:30',
      convenio: 10,
      procedimento: 30101271,
      paciente: { nome: 'Paciente Informado Sintetico', nascimento: '1970-05-02' },
    });
    expect(w.get('[data-testid="pm-mensagem"]').text()).toContain('Cirurgia pedida');
    expect(chamadas.some((c) => c.url.includes('/procedimentos?q=cole'))).toBe(true);
  });
});

describe('W0-10: alteração do pedido não confirmado', () => {
  const OPCOES = {
    salas: [
      { codigo: 1, nome: 'SALA 1' },
      { codigo: 2, nome: 'SALA 2' },
    ],
    convenios: [{ codigo: 10, nome: 'PARTICULAR' }],
    caracteres: [{ codigo: 2, nome: 'ELETIVA' }],
    anestesias: [],
    hoje: '2026-10-25',
  };
  it('carrega o pedido no formulário, exige o motivo e o painel de confirmação, manda a versão vista', async () => {
    document.cookie = 'sgh_portal_csrf=csrf-sintetico';
    const chamadas = simular((url) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (url.includes('/agenda')) return AGENDA;
      if (url.endsWith('/opcoes')) return OPCOES;
      if (url.endsWith('/pedidos/33/alteracao'))
        return { ok: true, id: 33, mensagem: 'Pedido alterado (versão 2).' };
      return {};
    });
    const w = montar(PortalMedicoAgendaTela);
    await flushPromises();
    await w.get('[data-testid="pm-alterar-33"]').trigger('click');
    await flushPromises();
    expect(w.get('#pm-pedido-titulo').text()).toContain('PACIENTE INFORMADO (versão 1)');
    expect((w.get('[data-testid="pm-hora"]').element as HTMLInputElement).value).toBe('14:00');
    expect(w.get('[data-testid="pm-proc-escolhido"]').text()).toContain('COLECISTECTOMIA');
    // Sem o motivo, a revisão fica desabilitada.
    expect(w.get('[data-testid="pm-pedir"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="pm-hora"]').setValue('15:00');
    await w.get('[data-testid="pm-motivo"]').setValue('Paciente pediu a tarde');
    await w.get('[data-testid="pm-pedir"]').trigger('click');
    await flushPromises();
    expect(chamadas.some((c) => c.url.includes('/alteracao'))).toBe(false);
    expect(w.get('[data-testid="pm-alteracao-confirmar"]').text()).toContain('Paciente pediu a tarde');
    await w.get('[data-testid="pm-alteracao-sim"]').trigger('click');
    await flushPromises();
    const alt = chamadas.find((c) => c.url.endsWith('/pedidos/33/alteracao'));
    expect(alt?.metodo).toBe('POST');
    expect(alt?.cabecalhos['x-csrf-portal']).toBe('csrf-sintetico');
    expect(alt?.corpo).toMatchObject({
      sala: 2,
      data: '2026-11-03',
      hora: '15:00',
      duracaoMin: 90,
      procedimento: 30101271,
      convenio: 10,
      paciente: { nome: 'PACIENTE INFORMADO', nascimento: '1970-05-02' },
      observacao: 'Levar exames',
      versao: 1,
      motivo: 'Paciente pediu a tarde',
    });
    expect(w.get('[data-testid="pm-mensagem"]').text()).toContain('versão 2');
    expect(w.get('#pm-pedido-titulo').text()).toBe('Pedir cirurgia');
  });

  it('mostra as versões anteriores e a recusa do confirmado (409) com o texto do portal', async () => {
    const comVersao = {
      ...AGENDA,
      pedidos: [
        {
          ...AGENDA.pedidos[0]!,
          versao: 2,
          versoes: [
            {
              versao: 1,
              data: '2026-11-03',
              hora: '08:00',
              duracaoMin: 60,
              sala: 'SALA 1',
              procedimento: 'COLECISTECTOMIA',
              convenio: 'PARTICULAR',
              paciente: 'PACIENTE INFORMADO',
              observacao: null,
              motivo: 'Paciente pediu a tarde',
              substituidaEm: '2026-10-25 10:30',
            },
          ],
        },
      ],
    };
    simular((url) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (url.includes('/agenda')) return comVersao;
      if (url.endsWith('/opcoes')) return OPCOES;
      if (url.endsWith('/alteracao'))
        return new Response(
          JSON.stringify({ title: 'Operação recusada', status: 409, codigo: 'solicitacao-encerrada' }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        );
      return {};
    });
    const w = montar(PortalMedicoAgendaTela);
    await flushPromises();
    expect(w.get('[data-testid="pm-pedido-situacao-33"]').text()).toContain('Versão 2');
    expect(w.get('[data-testid="pm-versoes-33"]').text()).toContain(
      'Versão 1: 03/11/2026 08:00, 60 min, sala SALA 1',
    );
    expect(w.get('[data-testid="pm-versoes-33"]').text()).toContain('Paciente pediu a tarde');
    await w.get('[data-testid="pm-alterar-33"]').trigger('click');
    await w.get('[data-testid="pm-motivo"]').setValue('Mudar a sala');
    await w.get('[data-testid="pm-pedir"]').trigger('click');
    await w.get('[data-testid="pm-alteracao-sim"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('O pedido já foi confirmado, cancelado ou suspenso.');
    expect(w.find('[data-testid="pm-alteracao-confirmar"]').exists()).toBe(false);
  });
});

describe('tela interna das contas', () => {
  it('liga a conta ao profissional sugerido', async () => {
    definirSessaoDaTela({
      permissoes: ['portal.medicoExterno.ler', 'portal.medicoExterno.vincular'],
    } as never);
    const chamadas = simular((url) => {
      if (url.includes('/portal-medico/contas') && !url.includes('/vinculo'))
        return {
          liberado: true,
          total: 1,
          pagina: 1,
          porPagina: 25,
          contas: [
            {
              acesso: 15,
              situacao: 'ativo',
              nome: 'Cirurgiao externo sintetico',
              conselho: 'CRM',
              uf: 'SP',
              numero: '54321',
              profissional: null,
              vinculadoPor: null,
              vinculadoEm: null,
              sugestoes: [{ id: 6801, nome: 'CIRURGIAO SINTETICO A' }],
              pedidosAbertos: 1,
              pedidos: [
                {
                  id: 41,
                  data: '2026-11-10',
                  hora: '14:30',
                  sala: 'SALA 2',
                  procedimento: 'COLECISTECTOMIA',
                  paciente: 'PACIENTE I. S.',
                },
              ],
              codigosCompartilhados: [],
            },
          ],
        };
      if (url.endsWith('/vinculo')) return { ok: true, id: 15, mensagem: 'Conta ligada ao corpo clínico.' };
      return {};
    });
    const w = montar(MedicoExternoInternoTela);
    await flushPromises();
    expect(w.get('[data-testid="pmi-pedidos-54321"]').text()).toBe('1');
    // O pedido em aberto com a data, a sala, o procedimento e o paciente mascarado, e o atalho para o detalhe.
    const lista = w.get('[data-testid="pmi-lista-pedidos-54321"]').text();
    expect(lista).toContain('10/11/2026 14:30');
    expect(lista).toContain('COLECISTECTOMIA');
    expect(lista).toContain('PACIENTE I. S.');
    expect(w.get('[data-testid="pmi-pedido-41"]').attributes('href')).toContain('/cirurgia/solicitacoes/41');
    expect(w.get('[data-testid="pmi-total"]').text()).toContain('1 conta(s)');
    (w.vm as unknown as { escolhido: Record<number, string> }).escolhido[15] = '6801';
    await flushPromises();
    await w.get('[data-testid="pmi-ligar-54321"]').trigger('click');
    await flushPromises();
    const v = chamadas.find((c) => c.url.endsWith('/portal-medico/contas/15/vinculo'));
    expect(v?.corpo).toEqual({ profissional: 6801 });
    expect(w.get('[data-testid="pmi-mensagem"]').text()).toContain('ligada');
  });

  it('filtra pelo nome ou número e pela situação, pagina e avisa o número repetido em outro cadastro', async () => {
    definirSessaoDaTela({ permissoes: ['portal.medicoExterno.ler'] } as never);
    const chamadas = simular((url) =>
      url.includes('/portal-medico/contas')
        ? {
            liberado: true,
            total: 30,
            pagina: url.includes('pagina=2') ? 2 : 1,
            porPagina: 25,
            contas: [
              {
                acesso: 16,
                situacao: 'ativo',
                nome: 'Outra cirurgia sintetica',
                conselho: 'CRM',
                uf: 'SP',
                numero: '77777',
                profissional: { id: 6802, nome: 'OUTRA MEDICA SINTETICA B' },
                vinculadoPor: 'SINT.RECEPCAO.SADT',
                vinculadoEm: '2026-10-25T10:00:00',
                sugestoes: [],
                pedidosAbertos: 0,
                pedidos: [],
                codigosCompartilhados: [88888],
              },
            ],
          }
        : {},
    );
    const w = montar(MedicoExternoInternoTela);
    await flushPromises();
    expect(w.get('[data-testid="pmi-compartilhados-77777"]').text()).toContain('88888');
    expect(w.get('[data-testid="pmi-total"]').text()).toContain('página 1 de 2');
    await w.get('[data-testid="pmi-filtro-texto"]').setValue('777');
    (w.vm as unknown as Record<string, unknown>)['fSituacao'] = 'ligadas';
    await w.get('[data-testid="pmi-filtro"]').trigger('submit');
    await flushPromises();
    expect(chamadas.some((c) => c.url.includes('q=777') && c.url.includes('situacao=ligadas'))).toBe(true);
    const proxima = w
      .get('[data-testid="pmi-paginas"]')
      .findAll('button')
      .find((b) => b.text().includes('Próxima'));
    await proxima?.trigger('click');
    await flushPromises();
    expect(chamadas.some((c) => c.url.includes('pagina=2'))).toBe(true);
  });

  it('W0-10: encerra a conta com motivo, senha e confirmação; a contagem do servidor exige a decisão sobre os pedidos', async () => {
    definirSessaoDaTela({
      permissoes: ['portal.medicoExterno.ler', 'portal.medicoExterno.conta'],
    } as never);
    let tentativas = 0;
    const chamadas = simular((url, init) => {
      if (url.endsWith('/contas/15/ato') && init?.method === 'POST') {
        tentativas++;
        if (tentativas === 1)
          return new Response(
            JSON.stringify({
              type: 'about:blank',
              title: 'Pedidos aguardando o bloco',
              status: 409,
              codigo: 'pedidos-pendentes',
              dependentes: [
                {
                  rotulo: 'Pedidos',
                  quantidade: 2,
                  amostra: [
                    '10/11/2026 14:30 · SALA 2 · COLECISTECTOMIA',
                    '12/11/2026 08:00 · SALA 1 · HERNIORRAFIA',
                  ],
                  origem: 'logica',
                },
              ],
            }),
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          );
        return {
          ok: true,
          id: 15,
          situacao: 'encerrado',
          mensagem: 'Conta encerrada; 2 pedido(s) mantido(s).',
          pedidosRetirados: 0,
          pedidosNaoRetirados: 0,
        };
      }
      if (url.endsWith('/contas/15/atos'))
        return [
          {
            id: 1,
            ato: 'bloqueio',
            situacaoAnterior: 'ativo',
            motivo: 'Documentação vencida',
            pedidosPendentes: 0,
            decisaoPedidos: null,
            usuario: 'SINT.RECEPCAO',
            em: '2026-11-18T10:00:00',
          },
        ];
      if (url.includes('/portal-medico/contas'))
        return {
          liberado: true,
          total: 1,
          pagina: 1,
          porPagina: 25,
          contas: [
            {
              acesso: 15,
              situacao: 'ativo',
              nome: 'Cirurgiao externo sintetico',
              conselho: 'CRM',
              uf: 'SP',
              numero: '54321',
              profissional: null,
              vinculadoPor: null,
              vinculadoEm: null,
              sugestoes: [],
              pedidosAbertos: 0,
              pedidos: [],
              codigosCompartilhados: [],
            },
          ],
        };
      return {};
    });
    const w = montar(MedicoExternoInternoTela);
    await flushPromises();
    expect(w.get('[data-testid="pmc-situacao-54321"]').text()).toBe('Ativa');
    // O histórico da conta.
    await w.get('[data-testid="pmc-historico-54321"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="pmc-atos-54321"]').text()).toContain('Bloqueio por SINT.RECEPCAO');
    await w.get('[data-testid="pmc-encerrar-54321"]').trigger('click');
    await w.get('[data-testid="pmc-motivo-54321"]').setValue('Deixou o corpo clínico');
    await w.get('[data-testid="pmc-senha-54321"]').setValue('senha-da-pessoa');
    // Sem pedidos na lista lida: segue; o painel de confirmação pergunta antes de enviar.
    await w.get('[data-testid="pmc-seguir-54321"]').trigger('click');
    expect(w.get('[data-testid="pmc-pergunta-54321"]').text()).toContain('definitivo');
    await w.get('[data-testid="pmc-confirmar-54321"]').trigger('click');
    await flushPromises();
    // O servidor achou 2 pedidos aguardando o bloco: a contagem, a amostra e a decisão exigida (a senha é pedida de novo).
    const pend = w.get('[data-testid="pmc-pendentes-54321"]').text();
    expect(pend).toContain('2 pedido(s)');
    expect(pend).toContain('HERNIORRAFIA');
    expect(w.get('[data-testid="pmc-seguir-54321"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="pmc-decisao-manter-54321"]').setValue(true);
    await w.get('[data-testid="pmc-senha-54321"]').setValue('senha-da-pessoa');
    await w.get('[data-testid="pmc-seguir-54321"]').trigger('click');
    await w.get('[data-testid="pmc-confirmar-54321"]').trigger('click');
    await flushPromises();
    const atos = chamadas.filter((c) => c.url.endsWith('/contas/15/ato'));
    expect(atos.map((c) => c.corpo)).toEqual([
      { ato: 'encerramento', motivo: 'Deixou o corpo clínico', pedidos: null, senha: 'senha-da-pessoa' },
      { ato: 'encerramento', motivo: 'Deixou o corpo clínico', pedidos: 'manter', senha: 'senha-da-pessoa' },
    ]);
    expect(w.get('[data-testid="pmi-mensagem"]').text()).toContain('mantido');
  });
});

describe('W0-10: a conta do médico (senha e e-mail)', () => {
  it('troca a senha só depois do painel de confirmação, com o CSRF do portal', async () => {
    document.cookie = 'sgh_portal_csrf=csrf-sintetico';
    const chamadas = simular((url) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (url.endsWith('/conta/email')) return { pendente: null };
      if (url.endsWith('/conta/senha')) return { ok: true, id: 1, mensagem: 'Senha trocada.' };
      return {};
    });
    const w = montar(PortalMedicoContaTela);
    await flushPromises();
    await w.get('#pm-senha-atual').setValue('senha-atual-sint');
    await w.get('#pm-senha-nova').setValue('senha-nova-sint-1');
    await w.get('#pm-senha-nova2').setValue('senha-nova-sint-1');
    await w.get('#pm-senha-codigo').setValue('123456');
    await w.get('[data-testid="pm-senha-trocar"]').trigger('click');
    await flushPromises();
    // Nada enviado antes do "Confirmar".
    expect(chamadas.some((c) => c.url.endsWith('/conta/senha'))).toBe(false);
    expect(w.get('[data-testid="pm-conta-confirmacao"]').text()).toContain('outras sessões');
    await w.get('[data-testid="pm-conta-confirmar"]').trigger('click');
    await flushPromises();
    const c = chamadas.find((x) => x.url.endsWith('/conta/senha'))!;
    expect(c.corpo).toEqual({
      atual: 'senha-atual-sint',
      nova: 'senha-nova-sint-1',
      confirmacao: 'senha-nova-sint-1',
      codigo: '123456',
    });
    expect(c.cabecalhos['x-csrf-portal']).toBe('csrf-sintetico');
    expect(w.text()).toContain('Senha trocada');
  });

  it('pede a troca do e-mail (link ao e-mail novo), mostra o pendente e desiste com confirmação', async () => {
    document.cookie = 'sgh_portal_csrf=csrf-sintetico';
    let pendente: unknown = null;
    const PEDIDA = {
      envio: 'simulador',
      emailMascarado: 'no***@exemplo.invalid',
      validoAte: '2026-11-19T18:00:00.000Z',
    };
    const chamadas = simular((url, init) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (url.endsWith('/conta/email') && init?.method === 'POST') {
        pendente = PEDIDA;
        return PEDIDA;
      }
      if (url.endsWith('/conta/email')) return { pendente };
      if (url.endsWith('/conta/email/cancelar')) {
        pendente = null;
        return { ok: true, id: 1, mensagem: 'Troca do e-mail cancelada.' };
      }
      return {};
    });
    const w = montar(PortalMedicoContaTela);
    await flushPromises();
    await w.get('[data-testid="pm-email-novo"]').setValue('novo@exemplo.invalid');
    await w.get('#pm-email-senha').setValue('senha-atual-sint');
    await w.get('#pm-email-codigo').setValue('654321');
    await w.get('[data-testid="pm-troca-pedir"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="pm-conta-confirmacao"]').text()).toContain('novo@exemplo.invalid');
    await w.get('[data-testid="pm-conta-confirmar"]').trigger('click');
    await flushPromises();
    expect(chamadas.find((x) => x.url.endsWith('/conta/email') && x.metodo === 'POST')?.corpo).toEqual({
      email: 'novo@exemplo.invalid',
      senha: 'senha-atual-sint',
      codigo: '654321',
    });
    expect(w.get('[data-testid="pm-troca-pendente"]').text()).toContain('no***@exemplo.invalid');
    await w.get('[data-testid="pm-troca-cancelar"]').trigger('click');
    await flushPromises();
    expect(chamadas.some((x) => x.url.endsWith('/conta/email/cancelar'))).toBe(false);
    await w.get('[data-testid="pm-conta-confirmar"]').trigger('click');
    await flushPromises();
    expect(chamadas.some((x) => x.url.endsWith('/conta/email/cancelar'))).toBe(true);
    expect(w.find('[data-testid="pm-troca-pendente"]').exists()).toBe(false);
    expect(w.text()).toContain('Troca do e-mail cancelada');
  });

  it('a recusa das credenciais aparece com o texto da aplicação', async () => {
    document.cookie = 'sgh_portal_csrf=csrf-sintetico';
    simular((url) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (url.endsWith('/conta/senha'))
        return new Response(
          JSON.stringify({
            type: 'x',
            title: 'Dados não conferem',
            status: 401,
            codigo: 'dados-nao-conferem',
          }),
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        );
      if (url.endsWith('/conta/email')) return { pendente: null };
      return {};
    });
    const w = montar(PortalMedicoContaTela);
    await flushPromises();
    for (const [id, v] of [
      ['#pm-senha-atual', 'errada'],
      ['#pm-senha-nova', 'senha-nova-sint-1'],
      ['#pm-senha-nova2', 'senha-nova-sint-1'],
      ['#pm-senha-codigo', '000000'],
    ] as const)
      await w.get(id).setValue(v);
    await w.get('[data-testid="pm-senha-trocar"]').trigger('click');
    await w.get('[data-testid="pm-conta-confirmar"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="recusa-portal-medico"]').text()).toContain('não conferem');
  });

  it('o link do e-mail novo confirma com um botão (hospital e token da rota)', async () => {
    rotaMock.query = { h: 'aa', t: 'T'.repeat(43) };
    const chamadas = simular(() => ({ emailMascarado: 'no***@exemplo.invalid' }));
    const w = montar(PortalMedicoConfirmarEmailTela);
    await flushPromises();
    expect(chamadas).toEqual([]);
    await w.get('[data-testid="pm-confirmar-email"]').trigger('click');
    await flushPromises();
    expect(chamadas[0]).toMatchObject({
      url: '/api/portal/medico-externo/email/confirmacao?h=aa',
      metodo: 'POST',
      corpo: { token: 'T'.repeat(43) },
    });
    expect(w.text()).toContain('no***@exemplo.invalid');
    rotaMock.query = {};
  });
});

describe('W0-10 (M4): meus pacientes no portal do médico', () => {
  const PACIENTE = {
    paciente: 1001,
    nome: 'JOSE SINTETICO',
    idade: '68 anos',
    sexo: 'M',
    prontuario: '501001',
    tipo: 'internacao',
    unidade: 'POSTO 2',
    leito: '201-A',
    dias: 3,
    previsaoAlta: '2026-11-20',
    resultadosNovos: 2,
    criticos: 1,
    prioridade: 90,
  };
  const LISTA = {
    vinculado: true,
    profissional: 'CIRURGIAO SINTETICO A',
    pacientes: [PACIENTE],
    total: 1,
    teto: 100,
    limitado: false,
    geradaEm: '2026-11-18T10:00:00',
  };

  it('lista os pacientes com vínculo e abre o resumo do prontuário com o crítico marcado', async () => {
    const chamadas = simular((url) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (url.endsWith('/pacientes')) return LISTA;
      if (url.endsWith('/pacientes/1001'))
        return {
          paciente: PACIENTE,
          resultados: [
            {
              exame: 7001,
              nome: 'POTASSIO SINTETICO',
              liberadoEm: '2026-11-18T05:00:00',
              critico: true,
              valores: [{ elemento: 'K', valor: '6.8', unidade: 'mmol/L', referencia: '3.5 a 5.1' }],
              texto: null,
            },
          ],
        };
      return {};
    });
    const w = montar(PortalMedicoPacientesTela);
    await flushPromises();
    expect(w.get('[data-testid="pm-paciente-1001"]').text()).toContain('JOSE SINTETICO');
    expect(w.get('[data-testid="pm-criticos-1001"]').text()).toContain('1 crítico');
    await w.get('[data-testid="pm-abrir-1001"]').trigger('click');
    await flushPromises();
    expect(chamadas.map((c) => c.url)).toContain('/api/portal/medico-externo/pacientes/1001');
    expect(w.get('[data-testid="pm-resultado-7001"]').text()).toContain('Crítico');
    expect(w.find('[data-testid="pm-acesso-registrado"]').exists()).toBe(true);
    await w.get('[data-testid="pm-fechar"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="pm-prontuario"]').exists()).toBe(false);
  });

  it('o paciente fora da lista (403) mostra o texto do portal; sem o vínculo da conta, o aviso', async () => {
    simular((url) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (url.endsWith('/pacientes')) return LISTA;
      return new Response(
        JSON.stringify({
          type: 'sem-permissao',
          status: 403,
          title: 'x',
          codigo: 'sem-vinculo-assistencial',
        }),
        { status: 403, headers: { 'content-type': 'application/problem+json' } },
      );
    });
    const w = montar(PortalMedicoPacientesTela);
    await flushPromises();
    await w.get('[data-testid="pm-abrir-1001"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="recusa-portal-medico"]').text()).toContain('vínculo assistencial');
    w.unmount();
    simular((url) =>
      url.endsWith('/eu')
        ? SESSAO
        : { ...LISTA, vinculado: false, profissional: null, pacientes: [], total: 0 },
    );
    const w2 = montar(PortalMedicoPacientesTela);
    await flushPromises();
    expect(w2.find('[data-testid="pm-sem-vinculo"]').exists()).toBe(true);
  });
});

describe('W0-10 (M5): resultados críticos no portal do médico', () => {
  const AVISO = {
    aviso: 41,
    paciente: 1001,
    nome: 'JOSE SINTETICO',
    prontuario: '501001',
    exame: 7001,
    elemento: 'POTASSIO',
    valor: '6,8',
    liberadoEm: '2026-11-18T05:00:00',
    emitidoEm: '2026-11-18T05:00:04',
    prazoEm: '2026-11-18T05:30:04',
    nivel: 1,
    nivelRotulo: 'Plantonista',
    situacao: 'escalonado',
    ciencia: null,
    notificacao: { envio: 'simulador', em: '2026-11-18T05:01:00' },
  };
  const COM = {
    ...AVISO,
    aviso: 42,
    nivel: 0,
    situacao: 'comCiencia',
    ciencia: { usuario: 'X', em: '2026-11-18T06:00:00' },
  };

  it('lista os avisos, pede a conduta, confirma no painel e registra a ciência; o já com ciência não oferece o botão', async () => {
    let feita = false;
    const chamadas = simular((url, init) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (url.endsWith('/criticos/41/ciencia') && init?.method === 'POST') {
        feita = true;
        return { ok: true, id: 77, mensagem: 'Ciência registrada. O aviso não sobe mais ao plantonista.' };
      }
      if (url.endsWith('/criticos'))
        return {
          vinculado: true,
          avisos: feita
            ? [
                { ...AVISO, situacao: 'comCiencia', ciencia: { usuario: 'Y', em: '2026-11-18T07:00:00' } },
                COM,
              ]
            : [AVISO, COM],
          pendentes: feita ? 0 : 1,
        };
      return {};
    });
    const w = montar(PortalMedicoCriticosTela);
    await flushPromises();
    expect(w.get('[data-testid="pm-criticos-pendentes"]').text()).toContain('1 aviso');
    expect(w.get('[data-testid="pm-critico-situacao-41"]').text()).toContain('plantonista');
    expect(w.get('[data-testid="pm-critico-situacao-41"]').text()).toContain('Avisado em 18/11/2026 05:01');
    expect(w.find('[data-testid="pm-ciencia-42"]').exists()).toBe(false);
    await w.get('[data-testid="pm-ciencia-41"]').trigger('click');
    await flushPromises();
    // Sem a conduta (5+ letras), não revisa.
    await w.get('[data-testid="pm-conduta"]').setValue('ok');
    expect(w.get('[data-testid="pm-ciencia-revisar"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="pm-conduta"]').setValue('repetir o exame e ligar ao paciente');
    await w.get('[data-testid="pm-ciencia-revisar"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="pm-ciencia-confirmar"]').text()).toContain(
      'repetir o exame e ligar ao paciente',
    );
    expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false);
    await w.get('[data-testid="pm-ciencia-sim"]').trigger('click');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.url).toBe('/api/portal/medico-externo/criticos/41/ciencia');
    expect(post.corpo).toEqual({ conduta: 'repetir o exame e ligar ao paciente' });
    expect(post.cabecalhos['x-csrf-portal']).toBeDefined();
    expect(w.get('[data-testid="pm-ciencia-feita"]').text()).toContain('Ciência registrada');
    expect(w.find('[data-testid="pm-form-ciencia"]').exists()).toBe(false);
    expect(w.find('[data-testid="pm-ciencia-41"]').exists()).toBe(false);
  });

  it('a ciência já registrada (409) mostra o texto do portal; sem avisos, a mensagem de lista vazia', async () => {
    simular((url, init) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (init?.method === 'POST')
        return new Response(
          JSON.stringify({
            type: 'recusa-de-negocio',
            status: 409,
            title: 'x',
            codigo: 'ciencia-registrada',
          }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        );
      return { vinculado: true, avisos: [AVISO], pendentes: 1 };
    });
    const w = montar(PortalMedicoCriticosTela);
    await flushPromises();
    await w.get('[data-testid="pm-ciencia-41"]').trigger('click');
    await w.get('[data-testid="pm-conduta"]').setValue('repetir o exame');
    await w.get('[data-testid="pm-ciencia-revisar"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="pm-ciencia-sim"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="recusa-portal-medico"]').text()).toContain('já foi registrada');
    w.unmount();
    simular((url) => (url.endsWith('/eu') ? SESSAO : { vinculado: true, avisos: [], pendentes: 0 }));
    const w2 = montar(PortalMedicoCriticosTela);
    await flushPromises();
    expect(w2.find('[data-testid="pm-criticos-vazia"]').exists()).toBe(true);
  });
});

describe('W0-10 (M6): assinaturas pendentes no portal do médico', () => {
  const CERT = {
    id: 9,
    midia: 'nuvem',
    provedor: 'PSC SIMULADO',
    serie: 'AB12',
    tipo: 'A3',
    validoDe: '2026-01-01T00:00:00.000Z',
    validoAte: '2027-12-31T00:00:00.000Z',
    cpfMascarado: '***.456.789-**',
  };
  const doc = (documento: number, titulo: string) => ({
    documento,
    titulo,
    paciente: 1001,
    nome: 'JOSE SINTETICO',
    emitidoEm: '2026-11-18T08:30:00',
    exigencia: {
      nivel: 'qualificada',
      politicaIcp: 'AD-RB',
      formato: 'PAdES',
      carimboDoTempo: false,
      origem: 'piso-legal',
    },
    situacao: 'a-assinar',
  });
  const FILA = {
    vinculado: true,
    comLogin: true,
    ligada: true,
    motivoDesligada: null,
    certificado: CERT,
    documentos: [doc(51, 'Receita'), doc(52, 'Atestado')],
    limitado: false,
  };
  afterEach(() => {
    navegacao.provedor.length = 0;
    navegacao.replace.length = 0;
    rotaMock.query = {};
  });

  it('escolhe o lote, confirma no painel e vai ao provedor; os recusados aparecem com o motivo', async () => {
    const chamadas = simular((url, init) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (url.endsWith('/assinaturas') && init?.method === 'POST')
        return {
          endereco: 'https://psc.simulado/autorizar?x=1',
          expiraEm: '2026-11-18T09:00:00.000Z',
          recusados: [{ documento: 52, motivo: 'documento-suspenso' }],
        };
      if (url.endsWith('/assinaturas')) return FILA;
      return {};
    });
    const w = montar(PortalMedicoAssinaturasTela);
    await flushPromises();
    expect(w.get('[data-testid="pm-ass-certificado"]').text()).toContain('AB12');
    expect(w.get('[data-testid="pm-ass-certificado"]').text()).toContain('31/12/2027');
    expect(w.get('[data-testid="pm-ass-51"]').text()).toContain('Receita');
    expect(w.get('[data-testid="pm-ass-revisar"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="pm-ass-todos"]').setValue(true);
    expect(w.get('[data-testid="pm-ass-revisar"]').text()).toContain('2 documento');
    await w.get('[data-testid="pm-ass-escolher-52"]').setValue(false);
    await w.get('[data-testid="pm-ass-escolher-52"]').setValue(true);
    await w.get('[data-testid="pm-ass-revisar"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="pm-ass-confirmar"]').text()).toContain('série AB12');
    expect(w.get('[data-testid="pm-ass-confirmar"]').text()).toContain('Atestado');
    expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false);
    await w.get('[data-testid="pm-ass-sim"]').trigger('click');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.url).toBe('/api/portal/medico-externo/assinaturas');
    expect(post.corpo).toEqual({ documentos: [51, 52] });
    expect(post.cabecalhos['x-csrf-portal']).toBeDefined();
    expect(navegacao.provedor).toEqual(['https://psc.simulado/autorizar?x=1']);
    expect(w.get('[data-testid="pm-ass-recusados"]').text()).toContain('Atestado');
    expect(w.get('[data-testid="pm-ass-recusados"]').text()).toContain('suspenso');
  });

  it('desligada mostra o motivo; sem certificado em nuvem orienta vincular no hospital; sem certificado (409) o texto do portal', async () => {
    simular((url) =>
      url.endsWith('/eu')
        ? SESSAO
        : { ...FILA, ligada: false, motivoDesligada: 'A chave da assinatura ICP-Brasil está desligada.' },
    );
    const w = montar(PortalMedicoAssinaturasTela);
    await flushPromises();
    expect(w.get('[data-testid="pm-ass-desligada"]').text()).toContain('está desligada');
    expect(w.find('[data-testid="pm-ass-revisar"]').exists()).toBe(false);
    expect(w.get('[data-testid="pm-ass-escolher-51"]').attributes('disabled')).toBeDefined();
    w.unmount();
    simular((url) => (url.endsWith('/eu') ? SESSAO : { ...FILA, certificado: null }));
    const w2 = montar(PortalMedicoAssinaturasTela);
    await flushPromises();
    expect(w2.get('[data-testid="pm-ass-sem-certificado"]').text()).toContain('Vincule');
    expect(w2.find('[data-testid="pm-ass-revisar"]').exists()).toBe(false);
    w2.unmount();
    simular((url, init) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (init?.method === 'POST')
        return new Response(
          JSON.stringify({
            type: 'recusa-de-negocio',
            status: 409,
            title: 'x',
            codigo: 'sem-certificado-nuvem',
          }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        );
      return FILA;
    });
    const w3 = montar(PortalMedicoAssinaturasTela);
    await flushPromises();
    await w3.get('[data-testid="pm-ass-escolher-51"]').setValue(true);
    await w3.get('[data-testid="pm-ass-revisar"]').trigger('click');
    await w3.get('[data-testid="pm-ass-sim"]').trigger('click');
    await flushPromises();
    expect(w3.get('[data-testid="recusa-portal-medico"]').text()).toContain('certificado em nuvem');
    expect(navegacao.provedor).toEqual([]);
  });

  it('a volta do provedor manda state e código uma vez, limpa a URL e mostra a contagem', async () => {
    const state = 'S'.repeat(43);
    rotaMock.query = { state, code: 'cod-1' };
    const chamadas = simular((url, init) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (url.endsWith('/assinaturas/retorno') && init?.method === 'POST')
        return { ok: true, motivo: null, assinados: 2, pendentes: 1, recusados: 0 };
      return {};
    });
    const w = montar(PortalMedicoAssinaturaRetornoTela);
    await flushPromises();
    const posts = chamadas.filter((c) => c.metodo === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.corpo).toEqual({ state, code: 'cod-1', erro: null });
    expect(posts[0]!.cabecalhos['x-csrf-portal']).toBeDefined();
    expect(w.get('[data-testid="pm-ret-resultado"]').text()).toContain('Assinatura concluída');
    expect(w.get('[data-testid="pm-ret-contagem"]').text()).toContain('2 assinado(s), 1 pendente(s)');
    expect(navegacao.replace).toEqual([{ name: 'portal.medico.assinaturasRetorno' }]);
  });

  it('a volta recusada mostra o motivo; sem state válido não pede nada ao servidor', async () => {
    rotaMock.query = { state: 'T'.repeat(40), error: 'access_denied' };
    const chamadas = simular((url, init) => {
      if (url.endsWith('/eu')) return SESSAO;
      if (init?.method === 'POST')
        return { ok: false, motivo: 'autorizacao-expirada', assinados: 0, pendentes: 0, recusados: 0 };
      return {};
    });
    const w = montar(PortalMedicoAssinaturaRetornoTela);
    await flushPromises();
    expect(chamadas.find((c) => c.metodo === 'POST')!.corpo).toEqual({
      state: 'T'.repeat(40),
      code: null,
      erro: 'access_denied',
    });
    expect(w.get('[data-testid="pm-ret-resultado"]').text()).toContain('expirou');
    w.unmount();
    rotaMock.query = { state: 'curto', code: 'x' };
    const c2 = simular((url) => (url.endsWith('/eu') ? SESSAO : {}));
    const w2 = montar(PortalMedicoAssinaturaRetornoTela);
    await flushPromises();
    expect(w2.get('[data-testid="pm-ret-invalido"]').text()).toContain('não é válido');
    expect(c2.some((c) => c.metodo === 'POST')).toBe(false);
  });
});
