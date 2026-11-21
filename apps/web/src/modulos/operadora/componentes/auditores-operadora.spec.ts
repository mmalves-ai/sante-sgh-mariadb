// @vitest-environment jsdom
// W0-10: a seção dos auditores designados da operadora: alterar a designação com o motivo e o painel de confirmação; trocar
// (encerrar) o auditor com pedidos em análise só com a redistribuição a outro auditor ativo da mesma operadora; a recusa
// do servidor (auditor-com-autorizacoes) mostra a contagem e os protocolos e pede a escolha. Dados SINTÉTICOS; a API é
// simulada.
import type { AuditorOperadora } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import AuditoresOperadora from './AuditoresOperadora.vue';

const api = vi.hoisted(() => ({
  lerAuditores: vi.fn(),
  designarAuditor: vi.fn(),
  encerrarAuditor: vi.fn(),
  alterarAuditor: vi.fn(),
}));
vi.mock('../api-autorizacao.js', () => api);

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

const auditor = (x: Partial<AuditorOperadora>): AuditorOperadora => ({
  id: 4,
  operadora: 7,
  login: 'SINT.AUD',
  nome: 'Auditora Sintética',
  categoria: 'medico',
  conselho: 'CRM',
  numero: '900011',
  uf: 'SC',
  inicio: '2026-10-23',
  fim: null,
  situacao: 'ativo',
  motivoEncerramento: null,
  versao: 2,
  emAnalise: 0,
  ...x,
});
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montadas: { unmount: () => void }[] = [];
async function montar() {
  const w = mount(AuditoresOperadora, {
    attachTo: document.body,
    props: {
      operadoras: [{ id: 7, nome: 'Operadora Sintética', registroAns: '900005' }],
      hoje: '2026-11-18',
    },
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
const clicar = async (id: string) => {
  const b = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  expect(b, id).not.toBeNull();
  (b!.tagName === 'BUTTON' ? b! : b!.querySelector('button')!).click();
  await flushPromises();
};
const escrever = async (id: string, v: string) => {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  el.value = v;
  el.dispatchEvent(new Event('input'));
  await flushPromises();
};
const desabilitado = (id: string) => {
  const b = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  return (b.tagName === 'BUTTON' ? (b as HTMLButtonElement) : b.querySelector('button')!).disabled;
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
});
afterEach(() => {
  for (const w of montadas.splice(0)) w.unmount();
  document.body.innerHTML = '';
});

describe('W0-10: auditores da operadora', () => {
  it('alterar a designação: motivo obrigatório, painel de confirmação e o corpo com a versão vista', async () => {
    api.lerAuditores.mockResolvedValue({ itens: [auditor({})] });
    api.alterarAuditor.mockResolvedValue({ ok: true, id: 4, mensagem: 'Designação de Auditora alterada.' });
    await montar();
    await clicar('aut-alterar-4');
    await escrever('aut-alt-numero', '900012');
    expect(desabilitado('aut-alt-revisar')).toBe(true);
    await escrever('aut-alt-motivo', 'Transferência sintética de conselho');
    await clicar('aut-alt-revisar');
    expect(document.querySelector('[data-testid="aut-alt-confirmacao"]')?.textContent).toContain(
      'CRM 900011/SC',
    );
    expect(document.querySelector('[data-testid="aut-alt-confirmacao"]')?.textContent).toContain(
      'CRM 900012/SC',
    );
    expect(api.alterarAuditor).not.toHaveBeenCalled();
    await clicar('aut-alt-gravar');
    expect(api.alterarAuditor).toHaveBeenCalledWith(4, {
      versao: 2,
      categoria: 'medico',
      numero: '900012',
      uf: 'SC',
      motivo: 'Transferência sintética de conselho',
    });
    expect(document.querySelector('[data-testid="aut-auditores-mensagem"]')?.textContent).toContain(
      'alterada',
    );
  });

  it('encerrar com pedidos em análise exige o auditor que assume; a recusa do servidor mostra os protocolos', async () => {
    api.lerAuditores.mockResolvedValue({
      itens: [
        auditor({ emAnalise: 0 }),
        auditor({ id: 6, login: 'SINT.AUD2', nome: 'Auditor Dois', numero: '900013' }),
        auditor({ id: 9, operadora: 8, login: 'SINT.AUD3', nome: 'De outra operadora' }),
      ],
    });
    // A lista lida dizia 0, mas outro auditor pediu complemento antes: o servidor recusa com a contagem.
    api.encerrarAuditor.mockRejectedValueOnce(
      new ErroApi(
        {
          type: 'about:blank',
          title: 'Operação recusada',
          status: 409,
          detail: 'Este auditor é o responsável por 1 pedido(s) de autorização em análise.',
          codigo: 'auditor-com-autorizacoes',
          dependentes: [
            {
              rotulo: 'Pedidos de autorização em análise',
              quantidade: 1,
              amostra: ['90000520261023000001'],
              origem: 'logica',
            },
          ],
        } as never,
        409,
      ),
    );
    api.encerrarAuditor.mockResolvedValueOnce({
      ok: true,
      id: 4,
      mensagem: 'Designação encerrada. 1 pedido(s)',
    });
    const w = await montar();
    await clicar('aut-encerrar-4');
    await escrever('aut-enc-motivo', 'Troca sintética do auditor');
    await clicar('aut-enc-revisar');
    await clicar('aut-enc-gravar');
    expect(api.encerrarAuditor).toHaveBeenCalledWith(4, { versao: 2, motivo: 'Troca sintética do auditor' });
    expect(document.querySelector('[data-testid="aut-enc-protocolos"]')?.textContent).toContain(
      '90000520261023000001',
    );
    expect(document.querySelector('[data-testid="aut-enc-pedidos"]')?.textContent).toContain('1 pedido(s)');
    expect(document.querySelector('[data-testid="aut-enc-recusa"]')).not.toBeNull();
    // Sem a escolha, não segue; só o auditor ativo da mesma operadora (não ele, nem o de outra operadora) é opção.
    expect(desabilitado('aut-enc-revisar')).toBe(true);
    const sel = w
      .findAllComponents({ name: 'SanteSelecao' })
      .find((c) => c.props('rotulo') === 'Auditor que assume os pedidos');
    expect(sel).toBeTruthy();
    expect((sel!.props('opcoes') as { valor: number; rotulo: string }[]).map((o) => o.valor)).toEqual([6]);
    sel!.vm.$emit('update:modelValue', 6);
    await flushPromises();
    await clicar('aut-enc-revisar');
    expect(document.querySelector('[data-testid="aut-enc-confirmacao"]')?.textContent).toContain(
      'Auditor Dois',
    );
    await clicar('aut-enc-gravar');
    expect(api.encerrarAuditor).toHaveBeenLastCalledWith(4, {
      versao: 2,
      motivo: 'Troca sintética do auditor',
      redistribuirPara: 6,
    });
  });
});
