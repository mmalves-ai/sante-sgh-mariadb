// @vitest-environment jsdom
// W0-09: o ciclo de vida dos registros da implantação na tela. Voltar o item do critério a pendente (motivo
// obrigatório), voltar o item do desligamento (motivo e senha, reautenticação), estornar a conclusão e retirar a versão
// da trilha: a exclusão recusada (409) mostra quantos registros dependem e oferece inativar com o mesmo motivo.
// Dados SINTÉTICOS.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { estornarConclusao, retirarVersaoTrilha, voltarDesligamentoPendente } from './api.js';
import AcaoCicloDialogo from './componentes/AcaoCicloDialogo.vue';
import VoltarCriterioPendente from './componentes/VoltarCriterioPendente.vue';

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

interface Pedido {
  url: string;
  corpo: Record<string, unknown> | null;
}
function simular(responder: (p: Pedido) => { status?: number; corpo: unknown }): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const p: Pedido = {
        url: String(url),
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      pedidos.push(p);
      const r = responder(p);
      return Response.json(r.corpo, {
        status: r.status ?? 200,
        headers: r.status && r.status >= 400 ? { 'content-type': 'application/problem+json' } : {},
      });
    }),
  );
  return pedidos;
}

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
function montar(c: Component, props: Record<string, unknown>) {
  return mount(c as never, {
    attachTo: document.body,
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
    },
  });
}
const preencher = (testid: string, valor: string) => {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-testid="${testid}"]`)!;
  el.value = valor;
  el.dispatchEvent(new Event('input'));
};
const enviar = async () => {
  document
    .querySelector<HTMLFormElement>('[data-testid="ciclo-dialogo"]')!
    .dispatchEvent(new Event('submit'));
  await flushPromises();
};
const texto = (testid: string) => document.querySelector(`[data-testid="${testid}"]`)?.textContent ?? '';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('ciclo de vida da coexistência na tela (W0-09)', () => {
  it('voltar o item do critério a pendente exige o motivo e manda só o motivo', async () => {
    const pedidos = simular(() => ({ corpo: { setor: 'recepcao', item: 'treino', situacao: 'pendente' } }));
    const w = montar(VoltarCriterioPendente, {
      setor: 'recepcao',
      item: 'treino',
      rotulo: 'Treinamento',
      situacao: 'cumprido',
      onda: 'onda1',
    });
    await w.get('[data-testid="voltar-pendente-recepcao-treino"]').trigger('click');
    await flushPromises();
    await enviar();
    expect(texto('ciclo-falta')).toContain('motivo');
    expect(pedidos).toHaveLength(0);
    preencher('ciclo-motivo', 'evidência vencida');
    await enviar();
    expect(pedidos[0]?.url).toBe(
      '/api/administracao/coexistencia/migracao/criterio/recepcao/itens/treino/pendente',
    );
    expect(pedidos[0]?.corpo).toEqual({ motivo: 'evidência vencida' });
  });

  it('o item pendente e o item calculado não oferecem voltar a pendente', () => {
    const a = montar(VoltarCriterioPendente, {
      setor: 's',
      item: 'treino',
      rotulo: 'r',
      situacao: 'pendente',
      onda: 'onda1',
    });
    expect(a.find('[data-testid="voltar-pendente-s-treino"]').exists()).toBe(false);
    const b = montar(VoltarCriterioPendente, {
      setor: 's',
      item: 'operacoes-conferidas',
      rotulo: 'r',
      situacao: 'cumprido',
      onda: 'onda1',
    });
    expect(b.find('[data-testid="voltar-pendente-s-operacoes-conferidas"]').exists()).toBe(false);
  });

  it('voltar o item do desligamento pede a senha no diálogo (reautenticação)', async () => {
    const pedidos = simular(() => ({ corpo: { item: 'agenda', situacao: 'pendente' } }));
    const w = montar(AcaoCicloDialogo, {
      visivel: true,
      titulo: 'Voltar',
      texto: 'x',
      rotulo: 'Voltar a pendente',
      comSenha: true,
      executar: (m: string, s: string) => voltarDesligamentoPendente('agenda', m, s),
    });
    await flushPromises();
    preencher('ciclo-motivo', 'contingência revista');
    await enviar();
    expect(texto('ciclo-falta')).toContain('senha');
    expect(pedidos).toHaveLength(0);
    preencher('ciclo-senha', 'senha-sintetica');
    await enviar();
    expect(pedidos[0]?.url).toBe('/api/administracao/coexistencia/desligamento/itens/agenda/pendente');
    expect(pedidos[0]?.corpo).toEqual({ motivo: 'contingência revista', senha: 'senha-sintetica' });
    expect(w.emitted('feito')).toEqual([[false]]);
  });

  it('retirar a versão com vínculos mostra a contagem (409) e oferece inativar com o mesmo motivo', async () => {
    const pedidos = simular((p) =>
      p.corpo?.inativar
        ? { corpo: { papel: 'recepcao', onda: 1, versao: 2, situacao: 'retirada' } }
        : {
            status: 409,
            corpo: {
              type: 'about:blank',
              title: 'Versão com vínculos',
              status: 409,
              detail: 'A versão tem 3 conclusões: não pode ser excluída.',
              codigo: 'trilha-com-vinculos',
              dependentes: [{ rotulo: 'conclusões', quantidade: 3, amostra: [], origem: 'fk' }],
              total: 3,
              podeInativar: true,
            },
          },
    );
    const w = montar(AcaoCicloDialogo, {
      visivel: true,
      titulo: 'Retirar',
      texto: 'x',
      rotulo: 'Retirar a versão',
      oferta: 'Inativar a versão',
      executar: (m: string, _s: string, inativar: boolean) =>
        retirarVersaoTrilha('recepcao', 1, 2, m, inativar),
    });
    await flushPromises();
    preencher('ciclo-motivo', 'versão publicada por engano');
    await enviar();
    expect(pedidos[0]?.url).toBe(
      '/api/administracao/coexistencia/migracao/treinamento/trilhas/recepcao/1/versoes/2/retirada',
    );
    expect(pedidos[0]?.corpo).toEqual({ motivo: 'versão publicada por engano' });
    expect(texto('ciclo-recusa')).toContain('3 registro(s)');
    expect(texto('ciclo-recusa')).toContain('conclusões: 3');
    expect(w.emitted('feito')).toBeUndefined();
    document.querySelector<HTMLButtonElement>('[data-testid="ciclo-oferta"]')!.click();
    await flushPromises();
    expect(pedidos[1]?.corpo).toEqual({ motivo: 'versão publicada por engano', inativar: true });
    expect(w.emitted('feito')).toEqual([[true]]);
  });

  it('estornar a conclusão manda o motivo; a recusa conhecida aparece explicada', async () => {
    const pedidos = simular(() => ({
      status: 409,
      corpo: { title: 'x', status: 409, detail: 'x', codigo: 'a-si-mesmo' },
    }));
    montar(AcaoCicloDialogo, {
      visivel: true,
      titulo: 'Estornar',
      texto: 'x',
      rotulo: 'Estornar',
      executar: (m: string) => estornarConclusao('17', m),
    });
    await flushPromises();
    preencher('ciclo-motivo', 'turma registrada errada');
    await enviar();
    expect(pedidos[0]?.url).toBe(
      '/api/administracao/coexistencia/migracao/treinamento/conclusoes/17/estorno',
    );
    expect(pedidos[0]?.corpo).toEqual({ motivo: 'turma registrada errada' });
    expect(texto('ciclo-erro')).toContain('Ninguém estorna a própria conclusão');
  });
});
