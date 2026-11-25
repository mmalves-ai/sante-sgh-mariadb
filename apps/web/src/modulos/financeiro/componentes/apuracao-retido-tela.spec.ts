// @vitest-environment jsdom
// F7, 07-FIN linha 110 (tela, dados sintéticos, API simulada no fetch): a apuração da competência mostra as parcelas por
// código de receita com a soma, o DARF abre na tela com os campos 01 a 10 e o batimento com a Reinf aponta a diferença.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import ApuracaoRetidoPainel from './ApuracaoRetidoPainel.vue';

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const json = (c: unknown) =>
  new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });

const APURACAO = {
  id: 7,
  numero: 'RT-2026-10-5-1',
  sigla: 'IRRF',
  codigoReceita: '1708',
  situacao: 'fechada',
  vencimento: '2026-11-20',
  base: 3000,
  total: 45,
  parcelas: [{ codigoReceita: '1708', retencoes: 2, base: 3000, valor: 45 }],
  somaParcelas: 45,
  guia: 31,
  guiaNumero: 12,
  guiaSituacao: 'emitida',
  tipoGuia: 'darf',
  titulo: 'TP-88',
};
const ISS = {
  ...APURACAO,
  id: 8,
  sigla: 'ISS',
  codigoReceita: '1401',
  situacao: 'recolhida',
  parcelas: [{ codigoReceita: '1401', retencoes: 1, base: 1000, valor: 20 }],
  total: 20,
  somaParcelas: 20,
  guia: 32,
  guiaSituacao: 'paga',
  tipoGuia: 'guia_municipal',
};
const CAMPOS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((n) => ({
  numero: n,
  rotulo: `Campo ${n}`,
  valor: n === '04' ? '1708' : n === '10' ? '45,00' : 'x',
}));

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('apuração do retido e DARF na tela', () => {
  it('parcelas com a soma, DARF com os campos 01 a 10 e batimento com a diferença', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        urls.push(u);
        if (u.includes('/retencao/apuracoes')) return json([APURACAO, ISS]);
        if (u.includes('/retencao/darf'))
          return json({
            guia: 31,
            numero: 12,
            competencia: '2026-10',
            situacao: 'emitida',
            campos: CAMPOS,
            total: 45,
          });
        return json({
          competencia: '2026-10',
          porTributo: [{ sigla: 'IRRF', valor: 45 }],
          eventosReinf: 1,
          linhas: [{ grupo: 'irrf', apurado: 45, reinf: 40, diferenca: 5, confere: false }],
          foraDaReinf: ['ISS'],
          confere: false,
        });
      }),
    );
    const w = mount(ApuracaoRetidoPainel, {
      props: { competencia: '2026-10' },
      global: {
        plugins: [
          criarI18n(mensagensWeb as unknown as Record<string, unknown>),
          ui,
          [
            VueQueryPlugin,
            { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          ],
        ],
      },
      attachTo: document.body,
    });
    await flushPromises();
    const linha = w.get('[data-testid="ar-apuracao-7"]').text();
    expect(linha).toContain('1708: 45,00 (2)');
    expect(linha).toContain('soma 45,00');
    // Situação da apuração e da guia pelo título; o ISS (guia do município) não oferece DARF.
    expect(w.get('[data-testid="ar-situacao-7"]').text()).toContain('Apurada, a pagar');
    expect(w.get('[data-testid="ar-situacao-8"]').text()).toContain('Recolhida');
    expect(w.get('[data-testid="ar-situacao-8"]').text()).toContain('Paga');
    expect(w.get('[data-testid="ar-apuracao-8"]').text()).toContain('Guia do município');
    expect(w.find('[data-testid="ar-darf-8"]').exists()).toBe(false);
    expect(w.get('[data-testid="ar-batimento-irrf"]').text()).toContain('5,00');
    expect(w.get('[data-testid="ar-batimento-irrf"]').text()).toContain('Não confere');
    expect(w.text()).toContain('Fora da Reinf: ISS.');
    await w.get('[data-testid="ar-darf-7"]').trigger('click');
    await flushPromises();
    expect(urls.some((u) => u.includes('/retencao/darf?guia=31'))).toBe(true);
    expect(w.findAll('[data-testid="ar-darf-campos"] tr')).toHaveLength(10);
    expect(w.get('[data-testid="ar-darf-04"]').text()).toContain('1708');
    await w.get('[data-testid="ar-fechar"]').trigger('click');
    expect(w.find('[data-testid="ar-darf"]').exists()).toBe(false);
  });

  it('competência sem recolhimento: aviso, sem tabela', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        json(
          String(url).includes('apuracoes')
            ? []
            : { linhas: [], foraDaReinf: [], eventosReinf: 0, porTributo: [], confere: true },
        ),
      ),
    );
    const w = mount(ApuracaoRetidoPainel, {
      props: { competencia: '2026-10' },
      global: {
        plugins: [
          criarI18n(mensagensWeb as unknown as Record<string, unknown>),
          ui,
          [VueQueryPlugin, { queryClient: new QueryClient() }],
        ],
      },
    });
    await flushPromises();
    expect(w.find('[data-testid="ar-nada"]').exists()).toBe(true);
    expect(w.find('[data-testid="ar-apuracoes"]').exists()).toBe(false);
  });
});
