// @vitest-environment jsdom
// Revisão do W0-04 (corretor, 18/11/2026; dados SINTÉTICOS, fetch simulado): as telas corrigidas.
// - DialogoCorrecao: o bloqueio por excesso de tentativas tem texto próprio (não é "senha errada"); a correção que o
//   servidor passa a exigir com a senha (registro de outro autor, ata assinada) pede a senha sem perder o que foi escrito;
// - manifestação encaminhada: o cancelamento continua disponível (a correção, não);
// - aba de dispositivos: o autor corrige e cancela o próprio dispositivo e corrige e estorna o próprio checklist; o
//   estornado fica inativo; o responsável pela inserção aparece; o registro de outro autor não mostra as ações.
import { urnProblema } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, defineComponent, h, ref } from 'vue';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import AbaDispositivos from './ccih/componentes/AbaDispositivos.vue';
import DialogoCorrecao, { type PedidoCorrecao } from './componentes/DialogoCorrecao.vue';
import ManifestacaoDetalhe from './gestao/componentes/ManifestacaoDetalhe.vue';

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
const plugins = () =>
  [
    criarI18n(mensagensWeb as unknown as Record<string, unknown>),
    ui,
    [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
  ] as never;
const montados: { unmount: () => void }[] = [];
const montar = (c: unknown, props: Record<string, unknown> = {}) => {
  const w = mount(c as never, {
    props: props as never,
    attachTo: document.body,
    global: { plugins: plugins(), stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  montados.push(w);
  return w;
};
afterEach(() => {
  for (const w of montados.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
  document.body.innerHTML = '';
});

type Resposta = { status?: number; corpo: unknown };
function simular(rota: (url: string, metodo: string) => Resposta | unknown) {
  const chamadas: { url: string; metodo: string; corpo: Record<string, unknown> | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      chamadas.push({
        url: String(url),
        metodo,
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      const r = rota(String(url), metodo);
      const c = r && typeof r === 'object' && 'corpo' in r ? (r as Resposta) : { corpo: r };
      const status = c.status ?? 200;
      return new Response(JSON.stringify(c.corpo), {
        status,
        headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
      });
    }),
  );
  return chamadas;
}
const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
async function digitar(sel: string, valor: string): Promise<void> {
  const e = q<HTMLInputElement | HTMLTextAreaElement>(sel);
  expect(e, sel).not.toBeNull();
  e!.value = valor;
  e!.dispatchEvent(new Event('input'));
  await flushPromises();
}
async function clicar(sel: string): Promise<void> {
  const e = q<HTMLElement>(sel);
  expect(e, sel).not.toBeNull();
  e!.click();
  await flushPromises();
}
const desligado = (sel: string) => {
  const b = q<HTMLButtonElement>(sel)!;
  return b.disabled || b.getAttribute('aria-disabled') === 'true';
};
async function confirmar(): Promise<void> {
  q<HTMLFormElement>('[data-testid="dialogo-correcao"]')!.dispatchEvent(new Event('submit'));
  await flushPromises();
}
const ultimoPost = (c: ReturnType<typeof simular>) => c.filter((x) => x.metodo === 'POST').at(-1);

describe('revisão do W0-04: DialogoCorrecao', () => {
  function montarDialogo(pedido: PedidoCorrecao) {
    const visivel = ref(true);
    const Pai = defineComponent({
      setup: () => () =>
        h(DialogoCorrecao, {
          visivel: visivel.value,
          'onUpdate:visivel': (v: boolean) => (visivel.value = v),
          pedido,
        }),
    });
    montar(Pai);
    return { visivel };
  }
  it('o bloqueio por excesso de tentativas tem texto próprio, não "senha errada"', async () => {
    const gravar = vi.fn(async () => {
      throw new ErroApi(
        { type: urnProblema('muitas-tentativas'), title: 'Muitas tentativas', status: 429 } as never,
        429,
      );
    });
    montarDialogo({ titulo: 'Cancelar', critica: true, confirmar: 'Cancelar', gravar });
    await flushPromises();
    await digitar('[data-testid="correcao-justificativa"]', 'Lançado no paciente errado');
    await digitar('[data-testid="correcao-senha"]', 'certa');
    await confirmar();
    const texto = q('[data-testid="correcao-senha-erro"]')?.textContent ?? '';
    expect(texto).toMatch(/Muitas tentativas/);
    expect(texto).not.toMatch(/não confere/);
  });
  it('a correção que o servidor passa a exigir com a senha pede a senha, sem perder a justificativa', async () => {
    let n = 0;
    const gravar = vi.fn(async (m: { justificativa: string; senha: string }) => {
      if (n++ === 0)
        throw new ErroApi(
          { type: urnProblema('reautenticacao-necessaria'), title: 'Confirme a senha', status: 401 } as never,
          401,
        );
      return { versao: 2, m };
    });
    const { visivel } = montarDialogo({ titulo: 'Corrigir', critica: false, confirmar: 'Ok', gravar });
    await flushPromises();
    expect(q('[data-testid="correcao-senha"]')).toBeNull();
    await digitar('[data-testid="correcao-justificativa"]', 'Sítio esquecido no registro');
    await confirmar();
    expect(q('[data-testid="correcao-senha"]')).not.toBeNull();
    expect(q('[data-testid="correcao-senha-erro"]')?.textContent).toMatch(/pede a sua senha/);
    expect(desligado('[data-testid="correcao-confirmar"]')).toBe(true);
    await digitar('[data-testid="correcao-senha"]', 'minha-senha');
    await confirmar();
    expect(gravar).toHaveBeenLastCalledWith({
      justificativa: 'Sítio esquecido no registro',
      senha: 'minha-senha',
    });
    expect(visivel.value).toBe(false);
  });
});

describe('revisão do W0-04: manifestação encaminhada', () => {
  it('o cancelamento continua disponível depois do encaminhamento; a correção, não', async () => {
    simular(() => ({}));
    montar(ManifestacaoDetalhe, {
      manifestacao: {
        id: 9,
        versao: 3,
        protocolo: 'OUV-2026-000009',
        canal: 'telefone',
        tipo: 'reclamacao',
        identificada: false,
        paciente: null,
        manifestante: null,
        contato: null,
        area: 'Recepção',
        relato: 'Demora no atendimento (texto sintético).',
        recebidaEm: '2026-10-20T10:00:00',
        prazoEm: '2026-11-03',
        situacao: 'encaminhada',
        encaminhadaA: 'Coordenação da recepção',
        observacao: null,
        resposta: null,
        procedente: null,
        respondidaEm: null,
        respondidaPor: null,
        pesquisa: null,
        estadoPrazo: 'noPrazo',
        registradaPor: 'SINT.OUVIDORIA',
        registradaEm: '2026-10-20T10:00:00',
        canceladaEm: null,
        motivoCancelamento: null,
      },
      podeResponder: true,
      podeRegistrarNc: false,
    });
    await flushPromises();
    expect(q('[data-testid="man-cancelar"]')).not.toBeNull();
    expect(q('[data-testid="man-corrigir"]')).toBeNull();
  });
});

describe('revisão do W0-04: aba de dispositivos', () => {
  const bundle = (o: Record<string, unknown>) => ({
    id: 71,
    dispositivo: 41,
    data: '2026-11-03',
    turno: 'manha',
    itens: { indicacao: false, sistemaFechado: true },
    conforme: false,
    indicacaoRevisada: false,
    observacao: null,
    registradoPor: 'SINT.ENF.PLANTAO',
    registradoEm: '2026-11-03T09:00:00',
    versao: 1,
    estornadoEm: null,
    estornadoPor: null,
    motivoEstorno: null,
    ...o,
  });
  const disp = (o: Record<string, unknown>) => ({
    id: 41,
    reg: 4802,
    setor: 'UTI',
    tipo: 'sondaVesical',
    sitio: null,
    inseridoEm: '2026-11-01T08:00:00',
    itemPrescricao: null,
    observacao: null,
    retiradoEm: null,
    motivoRetirada: null,
    versao: 2,
    dias: 3,
    canceladoEm: null,
    motivoCancelamento: null,
    registradoPor: 'SINT.ENF.PLANTAO',
    responsavel: { registro: 9103, nome: 'SINT MEDICO INTENSIVISTA' },
    dispositivosDiaCompetencia: 3,
    itensBundle: ['indicacao', 'sistemaFechado'],
    bundles: [
      bundle({}),
      bundle({ id: 70, estornadoEm: '2026-11-03T08:30:00', motivoEstorno: 'Dispositivo errado' }),
    ],
    bundleDoTurno: true,
    alerta: null,
    ...o,
  });
  const aba = (o: Record<string, unknown> = {}, itens = [disp({})]) => ({
    agora: '2026-11-03T12:00:00',
    ligada: true,
    turnoAtual: { data: '2026-11-03', turno: 'manha' },
    podeRegistrar: true,
    login: 'SINT.ENF.PLANTAO',
    podeCorrigirDeOutro: false,
    internacao: { internacao: 4802, setor: 'UTI', leito: 'UTI 01 C', entrada: '2026-11-01' },
    itens,
    ...o,
  });
  it('o autor vê corrigir e cancelar; o responsável aparece; o estornado fica inativo; estornar leva a senha', async () => {
    const chamadas = simular((url) =>
      url.includes('/enfermagem/paciente/') ? aba() : url.includes('/estorno') ? { versao: 2 } : {},
    );
    montar(AbaDispositivos, { paciente: 48002 });
    await flushPromises();
    expect(q('[data-testid="aba-responsavel-41"]')?.textContent).toContain('SINT MEDICO INTENSIVISTA');
    expect(q('[data-testid="aba-corrigir-41"]')).not.toBeNull();
    expect(q('[data-testid="aba-cancelar-41"]')).not.toBeNull();
    expect(q('[data-testid="aba-checklist-70"]')?.textContent).toContain('Dispositivo errado');
    expect(q('[data-testid="aba-estornar-checklist-70"]')).toBeNull();
    await clicar(
      '[data-testid="aba-estornar-checklist-71"] button, button[data-testid="aba-estornar-checklist-71"]',
    );
    await digitar('[data-testid="correcao-justificativa"]', 'Checklist lançado no dispositivo errado');
    await digitar('[data-testid="correcao-senha"]', 'senha-sintetica');
    await confirmar();
    const p = ultimoPost(chamadas)!;
    expect(p.url).toBe('/api/qualidade/ccih/enfermagem/bundles/71/estorno');
    expect(p.corpo).toEqual({
      versao: 1,
      justificativa: 'Checklist lançado no dispositivo errado',
      senha: 'senha-sintetica',
    });
  });
  it('corrigir o checklist leva os itens, a versão e a justificativa', async () => {
    const chamadas = simular((url) => (url.includes('/enfermagem/paciente/') ? aba() : { versao: 2 }));
    montar(AbaDispositivos, { paciente: 48002 });
    await flushPromises();
    await clicar(
      '[data-testid="aba-corrigir-checklist-71"] button, button[data-testid="aba-corrigir-checklist-71"]',
    );
    const marca = q<HTMLInputElement>('[data-testid="aba-bundle-item-indicacao"]')!;
    marca.click();
    await flushPromises();
    await digitar('[data-testid="correcao-justificativa"]', 'Indicação revisada esquecida no turno');
    await confirmar();
    const p = ultimoPost(chamadas)!;
    expect(p.url).toBe('/api/qualidade/ccih/enfermagem/bundles/71/correcao');
    expect(p.corpo).toEqual({
      versao: 1,
      itens: { indicacao: true, sistemaFechado: true },
      observacao: null,
      justificativa: 'Indicação revisada esquecida no turno',
    });
  });
  it('o registro de outro autor não mostra corrigir, cancelar nem estornar (sem a permissão própria)', async () => {
    simular((url) => (url.includes('/enfermagem/paciente/') ? aba({ login: 'SINT.ENF.UTI' }) : {}));
    montar(AbaDispositivos, { paciente: 48002 });
    await flushPromises();
    expect(q('[data-testid="aba-dispositivo-41"]')).not.toBeNull();
    expect(q('[data-testid="aba-corrigir-41"]')).toBeNull();
    expect(q('[data-testid="aba-cancelar-41"]')).toBeNull();
    expect(q('[data-testid="aba-estornar-checklist-71"]')).toBeNull();
  });
});
