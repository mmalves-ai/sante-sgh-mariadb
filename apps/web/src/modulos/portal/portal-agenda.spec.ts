// @vitest-environment jsdom
// Telas internas da etapa 2 do portal (M50): a conferência do pré-check-in (a fila, os campos que mudam já marcados,
// "Conferir e gravar o marcado" manda só os marcados com as versões; a recusa com o motivo) e as agendas oferecidas no
// portal (a lista e a gravação com a versão lida). Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import AgendaOnlineTela from './telas/AgendaOnlineTela.vue';
import ConferenciaPreCheckinTela from './telas/ConferenciaPreCheckinTela.vue';

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
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

type Rota = (url: string, init?: RequestInit) => unknown;
function simular(rota: Rota) {
  const chamadas: { url: string; metodo: string; corpo: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({
        url: String(url),
        metodo: init?.method ?? 'GET',
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify(rota(String(url), init)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return chamadas;
}
afterEach(() => vi.unstubAllGlobals());

const item = (situacao = 'enviado', marcacaoCancelada = false) => ({
  id: '41',
  tipo: 'consulta',
  data: '2026-10-27',
  hora: '0815',
  agenda: 'CARDIOLOGIA - DRA SINTETICO B',
  paciente: { id: 1003, nome: 'PACIENTE SINTETICO', prontuario: 501003 },
  situacao,
  enviadoEm: '2026-10-25T10:00:00.000',
  campos: 2,
  documentos: 1,
  marcacaoCancelada,
});
const detalhe = (situacao = 'enviado', gravados: string[] = [], cancelada = false) => ({
  item: item(situacao, cancelada),
  campos: [
    { campo: 'celular', atual: '22988887777', proposto: '22999990000', muda: true },
    { campo: 'email', atual: 'a@portal.test', proposto: 'a@portal.test', muda: false },
  ],
  documentos: [{ tipo: 'identidade', indice: 0 }],
  carteirinha: { numero: 'SINT-1', validade: '2027-01-31' },
  termo: 'atendimento:2026.1',
  motivoRecusa: null,
  conferidoPor: situacao === 'conferido' ? 'SINT.PRECHECKIN' : null,
  reservadoPor: null,
  camposGravados: gravados,
  versao: 2,
  versaoCadastro: 'a'.repeat(64),
});

describe('conferência do pré-check-in', () => {
  it('abre com os campos que mudam já marcados e grava só os marcados, com as versões', async () => {
    const chamadas = simular((url, init) => {
      if (url.includes('/conferencia') && init?.method === 'POST') return detalhe('conferido', ['celular']);
      if (url.endsWith('/recepcao/pre-checkin/41')) return detalhe();
      return { itens: [item()], proximo: null, podeConferir: true, buscaTruncada: false };
    });
    const w = montar(ConferenciaPreCheckinTela);
    await flushPromises();
    expect(w.get('[data-testid="pre-fila"]').text()).toContain('PACIENTE SINTETICO');
    await w.get('[data-testid="pre-abrir-41"]').trigger('click');
    await flushPromises();
    const celular = w.get('[data-testid="pre-marcar-celular"]').element as HTMLInputElement;
    const email = w.get('[data-testid="pre-marcar-email"]').element as HTMLInputElement;
    expect(celular.checked).toBe(true);
    expect(email.disabled).toBe(true);
    expect(w.get('[data-testid="pre-carteirinha"]').text()).toContain('SINT-1');
    await w.get('[data-testid="pre-conferir"]').trigger('click');
    await flushPromises();
    const post = chamadas.find((c) => c.url.endsWith('/conferencia'));
    expect(post?.corpo).toEqual({ versao: 2, versaoCadastro: 'a'.repeat(64), campos: ['celular'] });
    expect(w.get('[data-testid="pre-feito"]').text()).toContain('Celular');
  });

  it('recusa com o motivo que o paciente vê', async () => {
    const chamadas = simular((url, init) => {
      if (url.includes('/recusa') && init?.method === 'POST')
        return { ...detalhe('recusado'), motivoRecusa: 'Foto ilegível' };
      if (url.endsWith('/recepcao/pre-checkin/41')) return detalhe();
      return { itens: [item()], proximo: null, podeConferir: true, buscaTruncada: false };
    });
    const w = montar(ConferenciaPreCheckinTela);
    await flushPromises();
    await w.get('[data-testid="pre-abrir-41"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="pre-detalhe"] textarea').setValue('Foto ilegível: envie outra.');
    await w.get('[data-testid="pre-recusar"]').trigger('click');
    await flushPromises();
    expect(chamadas.find((c) => c.url.endsWith('/recusa'))?.corpo).toEqual({
      versao: 2,
      motivo: 'Foto ilegível: envie outra.',
    });
    expect(w.get('[data-testid="pre-feito"]').text()).toContain('recusado');
  });

  it('busca o paciente pelo nome ou prontuário e mostra a marcação cancelada por fora sem a conferência', async () => {
    const chamadas = simular((url) => {
      if (url.endsWith('/recepcao/pre-checkin/41')) return detalhe('enviado', [], true);
      return {
        itens: [item('enviado', true)],
        proximo: null,
        podeConferir: true,
        buscaTruncada: url.includes('termo=SILVA'),
      };
    });
    const w = montar(ConferenciaPreCheckinTela);
    await flushPromises();
    expect(w.find('[data-testid="pre-cancelada-41"]').exists()).toBe(true);
    await w.get('[data-testid="pre-busca"] input').setValue('PACIENTE SINTETICO');
    await w.get('[data-testid="pre-buscar"]').trigger('click');
    await flushPromises();
    expect(chamadas.at(-1)?.url).toContain('termo=PACIENTE+SINTETICO');
    await w.get('[data-testid="pre-busca"] input').setValue('SILVA');
    await w.get('[data-testid="pre-buscar"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Muitos pacientes com esse nome');
    await w.get('[data-testid="pre-abrir-41"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="pre-detalhe-cancelada"]').exists()).toBe(true);
    expect(w.find('[data-testid="pre-conferir"]').exists()).toBe(false);
  });
});

describe('agendas oferecidas no portal', () => {
  it('lista e grava a configuração com a versão lida', async () => {
    const lista = (versao: number | null) => ({
      itens: [
        {
          tipo: 'consulta',
          agenda: 902,
          nomeAgenda: 'CARDIOLOGIA - DRA SINTETICO B',
          procedimento: 'CARDIOLOGIA',
          profissional: 'DRA SINTETICO B',
          agendaAtiva: true,
          config:
            versao === null
              ? null
              : {
                  ativa: true,
                  convenios: [10],
                  servicos: [],
                  antecedenciaHoras: 24,
                  horizonteDias: 30,
                  cancelaAteHoras: 12,
                  precheckin: true,
                  valorParticular: 150,
                  alteradoPor: 'SINT.AGENDA',
                  alteradoEm: '2026-10-25T10:00:00.000',
                  versao,
                },
        },
        {
          tipo: 'exame',
          agenda: 951,
          nomeAgenda: 'ECOCARDIOGRAMA - DR SINTETICO C',
          procedimento: 'ECOCARDIOGRAMA',
          profissional: 'DR SINTETICO C',
          agendaAtiva: true,
          config: null,
        },
      ],
      portalLigado: false,
      motivo: 'desligado',
      podeConfigurar: true,
    });
    const detalhe902 = () => ({
      ...lista(1).itens[0],
      conveniosDaAgenda: [
        { codigo: 10, nome: 'PARTICULAR' },
        { codigo: 306, nome: 'OPERADORA BETA' },
      ],
      servicosDaAgenda: [{ codigo: 3, nome: 'CARDIOLOGIA' }],
    });
    const chamadas = simular((url, init) =>
      init?.method === 'PUT'
        ? lista(2)
        : url.endsWith('/agenda/online/consulta/902')
          ? detalhe902()
          : lista(1),
    );
    const w = montar(AgendaOnlineTela);
    await flushPromises();
    expect(w.get('[data-testid="tela-agenda-online"]').text()).toContain('desligado neste estabelecimento');
    // A busca pelo procedimento ou pelo profissional (sem acento, por palavras).
    expect(w.get('[data-testid="online-lista"]').text()).toContain('ECOCARDIOGRAMA');
    await w.get('[data-testid="online-busca"] input').setValue('sintético b');
    expect(w.get('[data-testid="online-lista"]').text()).not.toContain('ECOCARDIOGRAMA');
    expect(w.get('[data-testid="online-lista"]').text()).toContain('CARDIOLOGIA');
    // Os convênios e os serviços só são lidos ao abrir a agenda.
    expect(chamadas.some((c) => c.url.includes('/agenda/online/'))).toBe(false);
    await w.get('[data-testid="online-abrir-consulta-902"]').trigger('click');
    await flushPromises();
    expect(chamadas.some((c) => c.url.endsWith('/agenda/online/consulta/902'))).toBe(true);
    await w.get('[data-testid="online-convenios"] input[data-valor="306"]').setValue(true);
    await w.get('[data-testid="online-valor"] input').setValue('180,50');
    await w.get('[data-testid="online-gravar"]').trigger('click');
    // W0-10: o submit do formulário (que o navegador dispara junto com o clique) não grava de novo.
    await w.get('[data-testid="online-detalhe"] form').trigger('submit');
    await flushPromises();
    expect(chamadas.filter((c) => c.metodo === 'PUT')).toHaveLength(1);
    const put = chamadas.find((c) => c.metodo === 'PUT');
    expect(put?.corpo).toMatchObject({
      tipo: 'consulta',
      agenda: 902,
      ativa: true,
      convenios: [10, 306],
      valorParticular: 180.5,
      cancelaAteHoras: 12,
      versao: 1,
    });
    expect(w.get('[data-testid="online-feito"]').text()).toContain('gravada');
  });
});
