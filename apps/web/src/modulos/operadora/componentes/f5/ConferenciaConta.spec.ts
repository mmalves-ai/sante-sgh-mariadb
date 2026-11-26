// @vitest-environment jsdom
// C1-100 (08-SGO L105): a conferência na ficha da conta mostra as críticas gravadas no recebimento, os pareceres e os
// demonstrativos entregues; o parecer novo passa pela validação do domínio na hora (texto mínimo, motivo na glosa,
// categoria do auditor designado) e só vai ao servidor completo. Dados SINTÉTICOS; a API é simulada.
import type { ContaMedicaDetalhe } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../../i18n/pt-BR.js';
import ConferenciaConta from './ConferenciaConta.vue';

const api = vi.hoisted(() => ({
  lerConferencia: vi.fn(),
  lerApoioRegras: vi.fn(),
  registrarParecer: vi.fn(),
}));
vi.mock('../../api-conferencia-conta.js', () => api);
const permissoes = vi.hoisted(() => ({ lista: ['operadora.conta.analisar'] as string[] }));
vi.mock('../../../../casca/sessao/pode.js', () => ({ pode: (c: string) => permissoes.lista.includes(c) }));

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

const conta = (situacao: string) =>
  ({
    id: 40,
    operadora: 3,
    situacao,
    guiasDetalhe: [
      {
        id: 401,
        ordem: 1,
        numeroGuiaPrestador: 'G-SINT-1',
        beneficiario: null,
        itens: [{ id: 4011, sequencial: 1, codigo: '40301010', descricao: 'Exame sintético' }],
      },
    ],
  }) as unknown as ContaMedicaDetalhe;

const CONFERENCIA = {
  criticas: [
    {
      id: 1,
      guia: 401,
      numeroGuia: 'G-SINT-1',
      item: 4011,
      itemCodigo: '40301010',
      regra: { id: 7, codigo: 'AUTO-1' },
      motivoGlosa: '1801',
      descricao: 'Procedimentos que não se cobram juntos',
      tipo: 'glosa',
      ocorridaEm: '2026-11-20T10:00:00',
    },
  ],
  auditorias: [],
  demonstrativos: [
    {
      id: 5,
      versao: 1,
      numero: 'D-SINT-1',
      emitidoEm: '2026-11-21T09:00:00',
      informado: 100,
      liberado: 70,
      glosa: 30,
      situacao: 'emitido',
      emissoes: 2,
    },
  ],
};

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montadas: { unmount: () => void }[] = [];
async function montar(situacao = 'recebida', categoria: string | null = 'MEDICO') {
  const w = mount(ConferenciaConta, {
    attachTo: document.body,
    props: { conta: conta(situacao), categoriaAuditor: categoria },
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
    },
  });
  montadas.push(w);
  await flushPromises();
  return w;
}
const por = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(() => {
  permissoes.lista = ['operadora.conta.analisar'];
  api.lerConferencia.mockResolvedValue(CONFERENCIA);
  api.lerApoioRegras.mockResolvedValue({
    procedimentos: [],
    motivos: [{ id: 9, codigo: '1801', descricao: 'Motivo sintético' }],
    prestadores: [],
  });
  api.registrarParecer.mockResolvedValue({ id: 11, versao: 1 });
});
afterEach(() => {
  montadas.splice(0).forEach((w) => w.unmount());
  vi.clearAllMocks();
});

describe('ConferenciaConta (C1-100)', () => {
  it('lista as críticas gravadas e os demonstrativos entregues', async () => {
    await montar();
    expect(api.lerConferencia).toHaveBeenCalledWith(40);
    expect(por('conferencia-critica-1')?.textContent).toContain('AUTO-1');
    expect(por('conferencia-critica-1')?.textContent).toContain('Glosa automática');
    expect(por('conferencia-sem-auditorias')).not.toBeNull();
    expect(por('conferencia-demonstrativo-5')?.textContent).toContain('D-SINT-1');
  });

  it('valida o parecer na hora: guia, resultado, texto mínimo e categoria do auditor', async () => {
    const w = await montar('recebida', null);
    expect(por('conferencia-falta')?.textContent).toContain('a guia');
    const vm = w.vm as unknown as {
      $: { setupState: Record<string, unknown> };
    };
    const s = vm.$.setupState;
    s['guia'] = 401;
    s['tipo'] = 'medica';
    s['resultado'] = 'glosa_parcial';
    s['parecer'] = 'curto';
    await flushPromises();
    const falta = por('conferencia-falta')?.textContent ?? '';
    expect(falta).toContain('o parecer com ao menos 10 caracteres');
    expect(falta).toContain('o motivo de glosa');
    expect(falta).toContain('auditor designado da categoria');
    expect(por('conferencia-registrar')?.querySelector('button')?.disabled ?? true).toBe(true);
  });

  it('registra o parecer completo e recarrega a conferência', async () => {
    const w = await montar();
    const s = (w.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    s['guia'] = 401;
    s['item'] = 4011;
    s['tipo'] = 'medica';
    s['resultado'] = 'glosa_parcial';
    s['motivo'] = 9;
    s['parecer'] = '  Procedimento sem indicação clínica registrada.  ';
    await flushPromises();
    expect(por('conferencia-falta')).toBeNull();
    await w.find('form[data-testid="conferencia-parecer"]').trigger('submit');
    await flushPromises();
    expect(api.registrarParecer).toHaveBeenCalledWith(40, {
      guia: 401,
      item: 4011,
      tipo: 'medica',
      resultado: 'glosa_parcial',
      parecer: 'Procedimento sem indicação clínica registrada.',
      motivoGlosa: 9,
    });
    expect(por('conferencia-aviso')?.textContent).toContain('Parecer registrado');
    expect(api.lerConferencia).toHaveBeenCalledTimes(2);
  });

  it('sem operadora.conta.analisar ou fora da análise, só a leitura', async () => {
    permissoes.lista = [];
    await montar();
    expect(por('conferencia-parecer')).toBeNull();
    expect(api.lerApoioRegras).not.toHaveBeenCalled();
    montadas.splice(0).forEach((w) => w.unmount());
    permissoes.lista = ['operadora.conta.analisar'];
    await montar('analisada');
    expect(por('conferencia-parecer')).toBeNull();
    expect(por('conferencia-critica-1')).not.toBeNull();
  });
});
