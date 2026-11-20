// @vitest-environment jsdom
// W0-04 (programa CRUD completo; dados SINTÉTICOS, fetch simulado): as telas da correção e do cancelamento da qualidade.
// - DialogoCorrecao: sem justificativa de 10 caracteres não confirma; a crítica pede a senha; a senha que não confere
//   fica DENTRO do diálogo; a recusa com os dependentes lista quantos e quais; o 409 da competência fechada oferece
//   "reabrir competência" a quem pode e emite a competência;
// - ficha do internado (CCIH): corrigir o dispositivo leva a versão e a justificativa; o cancelamento confere os
//   dependentes antes e fica impedido com a lista; o cancelado aparece como inativo;
// - sessões de higiene das mãos: o estorno leva a senha e a estornada aparece inativa;
// - histórico de versões: a versão anterior aparece inativa, com os campos com rótulo (a identificação interna não);
// - ouvidoria: corrigir a manifestação aberta leva tipo, área e relato com a versão; a cancelada aparece inativa e sem
//   encaminhar.
import { urnProblema } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, defineComponent, h, ref } from 'vue';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import FichaInternado from './ccih/componentes/FichaInternado.vue';
import SessoesMaos from './ccih/componentes/SessoesMaos.vue';
import DialogoCorrecao, { type PedidoCorrecao } from './componentes/DialogoCorrecao.vue';
import HistoricoVersoes from './componentes/HistoricoVersoes.vue';
import IndicadoresOuvidoria from './gestao/componentes/IndicadoresOuvidoria.vue';
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

describe('DialogoCorrecao', () => {
  function montarDialogo(pedido: PedidoCorrecao, podeReabrir = true) {
    const visivel = ref(true);
    const feito = vi.fn();
    const reabrir = vi.fn();
    const Pai = defineComponent({
      setup: () => () =>
        h(DialogoCorrecao, {
          visivel: visivel.value,
          'onUpdate:visivel': (v: boolean) => (visivel.value = v),
          pedido,
          podeReabrir,
          onFeito: feito,
          onReabrir: reabrir,
        }),
    });
    montar(Pai);
    return { visivel, feito, reabrir };
  }

  it('sem justificativa de 10 caracteres não confirma; com ela grava e fecha', async () => {
    const gravar = vi.fn(async () => ({ versao: 2 }));
    const { visivel, feito } = montarDialogo({ titulo: 'Corrigir', critica: false, confirmar: 'Ok', gravar });
    await flushPromises();
    await digitar('[data-testid="correcao-justificativa"]', 'curto');
    expect(desligado('[data-testid="correcao-confirmar"]')).toBe(true);
    await confirmar();
    expect(gravar).not.toHaveBeenCalled();
    expect(q('[data-testid="correcao-senha"]')).toBeNull();
    await digitar('[data-testid="correcao-justificativa"]', 'Data de inserção lançada errada');
    await confirmar();
    expect(gravar).toHaveBeenCalledWith({ justificativa: 'Data de inserção lançada errada', senha: '' });
    expect(visivel.value).toBe(false);
    expect(feito).toHaveBeenCalledTimes(1);
  });

  it('a crítica pede a senha; a que não confere fica dentro do diálogo, sem perder a justificativa', async () => {
    const gravar = vi.fn(async () => {
      throw new ErroApi(
        { type: urnProblema('reautenticacao-necessaria'), title: 'Confirme a senha', status: 401 } as never,
        401,
      );
    });
    const { visivel } = montarDialogo({ titulo: 'Cancelar', critica: true, confirmar: 'Cancelar', gravar });
    await flushPromises();
    await digitar('[data-testid="correcao-justificativa"]', 'Lançado no paciente errado');
    expect(desligado('[data-testid="correcao-confirmar"]')).toBe(true);
    await digitar('[data-testid="correcao-senha"]', 'errada');
    await confirmar();
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(visivel.value).toBe(true);
    expect(q('[data-testid="correcao-senha-erro"]')?.textContent).toMatch(/senha não confere/);
    expect(q<HTMLInputElement>('[data-testid="correcao-senha"]')!.value).toBe('');
    expect(q<HTMLTextAreaElement>('[data-testid="correcao-justificativa"]')!.value).toBe(
      'Lançado no paciente errado',
    );
  });

  it('a recusa de órfão mostra o texto e quantos e quais dependentes', async () => {
    const gravar = vi.fn(async () => {
      throw new ErroApi(
        {
          type: urnProblema('recusa-de-negocio'),
          status: 409,
          codigo: 'dispositivo-com-iras',
          avisos: ['Fichas de IRAS confirmadas (1): nº 3.'],
        } as never,
        409,
      );
    });
    const { visivel } = montarDialogo({ titulo: 'Cancelar', critica: true, confirmar: 'Cancelar', gravar });
    await flushPromises();
    await digitar('[data-testid="correcao-justificativa"]', 'Lançado no paciente errado');
    await digitar('[data-testid="correcao-senha"]', 'Sintetico#2026');
    await confirmar();
    expect(visivel.value).toBe(true);
    const recusa = q('[data-testid="correcao-recusa"]')!;
    expect(recusa.textContent).toMatch(/critério de ficha de IRAS confirmada/);
    expect(q('[data-testid="correcao-avisos"]')?.textContent).toContain('nº 3');
  });

  it('competência fechada: oferece reabrir a competência e emite qual', async () => {
    const gravar = vi.fn(async () => {
      throw new ErroApi(
        {
          type: urnProblema('recusa-de-negocio'),
          status: 409,
          codigo: 'competencia-fechada',
          avisos: ['Competência fechada: 2026-10.'],
        } as never,
        409,
      );
    });
    const { reabrir } = montarDialogo({ titulo: 'Corrigir', critica: false, confirmar: 'Ok', gravar });
    await flushPromises();
    await digitar('[data-testid="correcao-justificativa"]', 'Critério marcado errado');
    await confirmar();
    expect(q('[data-testid="correcao-recusa"]')?.textContent).toMatch(/reabra a competência com motivo/);
    expect(q('[data-testid="correcao-reabrir"]')?.textContent).toContain('2026-10');
    await clicar('[data-testid="correcao-reabrir"] button, button[data-testid="correcao-reabrir"]');
    expect(reabrir).toHaveBeenCalledWith(['2026-10']);
  });

  it('quem não pode reabrir não vê a oferta', async () => {
    const gravar = vi.fn(async () => {
      throw new ErroApi(
        {
          type: urnProblema('recusa-de-negocio'),
          status: 409,
          codigo: 'competencia-fechada',
          avisos: ['Competência fechada: 2026-10.'],
        } as never,
        409,
      );
    });
    montarDialogo({ titulo: 'Corrigir', critica: false, confirmar: 'Ok', gravar }, false);
    await flushPromises();
    await digitar('[data-testid="correcao-justificativa"]', 'Critério marcado errado');
    await confirmar();
    expect(q('[data-testid="correcao-recusa"]')).not.toBeNull();
    expect(q('[data-testid="correcao-reabrir"]')).toBeNull();
  });
});

const DISPOSITIVO = {
  id: 5,
  reg: 4801,
  setor: 'UTI',
  tipo: 'cvc',
  sitio: 'SUBCLAVIA',
  inseridoEm: '2026-10-19T10:00:00',
  itemPrescricao: null,
  observacao: null,
  retiradoEm: null,
  motivoRetirada: null,
  versao: 3,
  dias: 4,
};
const INTERNACAO = (dispositivos: unknown[]) => ({
  agora: '2026-10-22T13:00:00',
  internacao: {
    internacao: 4801,
    paciente: 48001,
    nome: 'PACIENTE SINTETICO CCIH',
    prontuario: 480001,
    setor: 'UTI',
    leito: 'UTI 01-A',
    chaveLeito: { bloco: 'UTI', acomodacao: '01', leito: 'A' },
    entrada: '2026-10-16',
    aberta: true,
  },
  dispositivos,
  iras: [],
  precaucoes: [],
  antimicrobianos: [],
  culturas: [],
  cirurgias: [],
  temperaturaMaxima48h: null,
  vizinhos: [],
});
const COMPETENCIAS = { itens: [], acoes: { fechar: true, reabrir: true }, agora: '2026-10-22T13:00:00' };
const ACOES = { registrar: true, iras: true, precaucao: true };

describe('ficha do internado: dispositivo', () => {
  it('corrigir leva a versão lida e a justificativa', async () => {
    const chamadas = simular((url, metodo) => {
      if (url.includes('/competencias')) return COMPETENCIAS;
      if (metodo === 'POST') return { versao: 4 };
      return INTERNACAO([DISPOSITIVO]);
    });
    montar(FichaInternado, { internacao: 4801, acoes: ACOES });
    await flushPromises();
    await clicar(
      '[data-testid="corrigir-dispositivo-5"] button, button[data-testid="corrigir-dispositivo-5"]',
    );
    expect(q('[data-testid="correcao-dispositivo"]')).not.toBeNull();
    await digitar('[data-testid="correcao-justificativa"]', 'Sítio de inserção lançado errado');
    await confirmar();
    const p = ultimoPost(chamadas)!;
    expect(p.url).toBe('/api/qualidade/ccih/dispositivos/5/correcao');
    expect(p.corpo).toMatchObject({
      versao: 3,
      tipo: 'cvc',
      sitio: 'SUBCLAVIA',
      inseridoEm: '2026-10-19T10:00',
      retiradoEm: null,
      justificativa: 'Sítio de inserção lançado errado',
    });
    expect(q('[data-testid="ficha-aviso"]')?.textContent).toMatch(/versão anterior fica no histórico/);
  });

  it('cancelar confere os dependentes antes: com ficha de IRAS confirmada fica impedido e lista quais', async () => {
    const chamadas = simular((url) => {
      if (url.includes('/competencias')) return COMPETENCIAS;
      if (url.includes('/dependentes'))
        return {
          itens: [{ grupo: 'Fichas de IRAS confirmadas', quantidade: 1, ids: [3] }],
          podeCancelar: false,
        };
      return INTERNACAO([DISPOSITIVO]);
    });
    montar(FichaInternado, { internacao: 4801, acoes: ACOES });
    await flushPromises();
    await clicar(
      '[data-testid="cancelar-dispositivo-5"] button, button[data-testid="cancelar-dispositivo-5"]',
    );
    await flushPromises();
    expect(q('[data-testid="correcao-alerta"]')?.textContent).toMatch(
      /Fichas de IRAS confirmadas \(1\): nº 3/,
    );
    await digitar('[data-testid="correcao-justificativa"]', 'Lançado no paciente errado');
    await digitar('[data-testid="correcao-senha"]', 'Sintetico#2026');
    expect(desligado('[data-testid="correcao-confirmar"]')).toBe(true);
    await confirmar();
    expect(chamadas.filter((c) => c.metodo === 'POST')).toEqual([]);
  });

  it('sem dependentes, cancela com a senha; o cancelado aparece inativo com o motivo', async () => {
    let cancelado = false;
    const chamadas = simular((url, metodo) => {
      if (url.includes('/competencias')) return COMPETENCIAS;
      if (url.includes('/dependentes')) return { itens: [], podeCancelar: true };
      if (metodo === 'POST') {
        cancelado = true;
        return { versao: 4 };
      }
      return INTERNACAO([
        cancelado
          ? {
              ...DISPOSITIVO,
              versao: 4,
              canceladoEm: '2026-10-22T13:05:00',
              motivoCancelamento: 'Lançado no paciente errado',
            }
          : DISPOSITIVO,
      ]);
    });
    montar(FichaInternado, { internacao: 4801, acoes: ACOES });
    await flushPromises();
    await clicar(
      '[data-testid="cancelar-dispositivo-5"] button, button[data-testid="cancelar-dispositivo-5"]',
    );
    await flushPromises();
    await digitar('[data-testid="correcao-justificativa"]', 'Lançado no paciente errado');
    await digitar('[data-testid="correcao-senha"]', 'Sintetico#2026');
    await confirmar();
    const p = ultimoPost(chamadas)!;
    expect(p.url).toBe('/api/qualidade/ccih/dispositivos/5/cancelamento');
    expect(p.corpo).toEqual({
      versao: 3,
      justificativa: 'Lançado no paciente errado',
      senha: 'Sintetico#2026',
    });
    await flushPromises();
    expect(q('[data-testid="dispositivo-inativo-5"]')).not.toBeNull();
    expect(q('[data-testid="dispositivo-5"]')?.textContent).toContain('Lançado no paciente errado');
  });
});

describe('sessões de higiene das mãos', () => {
  const SESSAO = {
    id: 77,
    unidade: 1,
    setor: 'UTI',
    observadoEm: '2026-10-20T09:00:00',
    categoria: 'enfermeiro',
    oportunidades: 2,
    conformes: 1,
    detalhe: [
      { momento: 'antesContato', acao: 'friccao', luvas: false },
      { momento: 'aposContato', acao: 'naoRealizada', luvas: false },
    ],
    registradoPor: 'SINT.CCIH',
    versao: 1,
    observacao: null,
    estornadoEm: null,
    motivoEstorno: null,
  };
  it('estornar leva a senha; a estornada aparece inativa', async () => {
    let estornada = false;
    const chamadas = simular((_url, metodo) => {
      if (metodo === 'POST') {
        estornada = true;
        return { versao: 2 };
      }
      return {
        competencia: '2026-10',
        cortada: false,
        itens: [
          estornada
            ? {
                ...SESSAO,
                versao: 2,
                estornadoEm: '2026-10-22T10:00:00',
                motivoEstorno: 'Sessão lançada em dobro',
              }
            : SESSAO,
        ],
      };
    });
    montar(SessoesMaos, { competencia: '2026-10', podeRegistrar: true });
    await flushPromises();
    await clicar('[data-testid="estornar-sessao-77"] button, button[data-testid="estornar-sessao-77"]');
    await digitar('[data-testid="correcao-justificativa"]', 'Sessão lançada em dobro');
    await digitar('[data-testid="correcao-senha"]', 'Sintetico#2026');
    await confirmar();
    const p = ultimoPost(chamadas)!;
    expect(p.url).toBe('/api/qualidade/ccih/maos/observacoes/77/estorno');
    expect(p.corpo).toEqual({ versao: 1, justificativa: 'Sessão lançada em dobro', senha: 'Sintetico#2026' });
    await flushPromises();
    expect(q('[data-testid="sessao-inativa-77"]')).not.toBeNull();
    expect(q('[data-testid="estornar-sessao-77"]')).toBeNull();
  });

  it('corrigir leva as oportunidades e a versão', async () => {
    const chamadas = simular((_url, metodo) =>
      metodo === 'POST' ? { versao: 2 } : { competencia: '2026-10', cortada: false, itens: [SESSAO] },
    );
    montar(SessoesMaos, { competencia: '2026-10', podeRegistrar: true });
    await flushPromises();
    await clicar('[data-testid="corrigir-sessao-77"] button, button[data-testid="corrigir-sessao-77"]');
    expect(q('[data-testid="correcao-sessao"]')).not.toBeNull();
    await digitar('[data-testid="correcao-justificativa"]', 'Categoria observada lançada errada');
    await confirmar();
    const p = ultimoPost(chamadas)!;
    expect(p.url).toBe('/api/qualidade/ccih/maos/observacoes/77/correcao');
    expect(p.corpo).toMatchObject({
      versao: 1,
      observadoEm: '2026-10-20T09:00',
      categoria: 'enfermeiro',
      oportunidades: SESSAO.detalhe,
      justificativa: 'Categoria observada lançada errada',
    });
  });
});

describe('histórico de versões', () => {
  it('mostra a versão anterior inativa, com os campos com rótulo e sem a identificação interna', async () => {
    simular(() => ({
      itens: [
        {
          versao: 1,
          acao: 'correcao',
          motivo: 'Sítio lançado errado',
          alteradoPor: 'SINT.CCIH',
          alteradoEm: '2026-10-22T13:05:00',
          dados: { ID: 5, HOSPITAL: 'pc', TIPO: 'cvc', SITIO: 'JUGULAR', INSERIDO_EM: '2026-10-19T10:00:00' },
        },
      ],
    }));
    montar(HistoricoVersoes, { registro: 'dispositivo', id: 5 });
    await flushPromises();
    await clicar(
      '[data-testid="historico-dispositivo-5"] button, button[data-testid="historico-dispositivo-5"]',
    );
    await flushPromises();
    const v = q('[data-testid="versao-1"]')!;
    expect(v.textContent).toContain('Inativo');
    expect(v.textContent).toContain('Correção');
    expect(v.textContent).toContain('Sítio lançado errado');
    expect(v.textContent).toContain('JUGULAR');
    expect(v.textContent).not.toContain('HOSPITAL');
    expect(v.textContent).not.toContain('pc');
  });

  it('o retrato com o nome do campo (porta em memória) dá o mesmo rótulo', async () => {
    simular(() => ({
      itens: [
        {
          versao: 2,
          acao: 'retificacao',
          motivo: 'Deliberação faltando',
          alteradoPor: 'SINT.QUALIDADE',
          alteradoEm: '2026-10-22T13:05:00',
          dados: { id: 8, ata: 'Texto anterior da ata', convidados: null },
        },
      ],
    }));
    montar(HistoricoVersoes, { registro: 'reuniao', id: 8 });
    await flushPromises();
    await clicar('[data-testid="historico-reuniao-8"] button, button[data-testid="historico-reuniao-8"]');
    await flushPromises();
    const v = q('[data-testid="versao-2"]')!;
    expect(v.textContent).toContain('Retificação');
    expect(v.textContent).toContain('Ata');
    expect(v.textContent).toContain('Texto anterior da ata');
  });
});

describe('ouvidoria: manifestação', () => {
  const MAN = {
    id: 9,
    versao: 2,
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
    situacao: 'aberta',
    encaminhadaA: null,
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
  };
  it('corrigir a aberta leva tipo, área e relato com a versão', async () => {
    const chamadas = simular(() => ({ versao: 3 }));
    montar(ManifestacaoDetalhe, { manifestacao: MAN, podeResponder: true, podeRegistrarNc: false });
    await flushPromises();
    await clicar('[data-testid="man-corrigir"] button, button[data-testid="man-corrigir"]');
    await digitar('[data-testid="correcao-man-area"] input', 'Faturamento');
    await digitar('[data-testid="correcao-justificativa"]', 'Área lançada errada no protocolo');
    await confirmar();
    const p = ultimoPost(chamadas)!;
    expect(p.url).toBe('/api/qualidade/ouvidoria/manifestacoes/9/correcao');
    expect(p.corpo).toEqual({
      versao: 2,
      tipo: 'reclamacao',
      area: 'Faturamento',
      relato: MAN.relato,
      justificativa: 'Área lançada errada no protocolo',
    });
  });

  it('a cancelada aparece inativa, com o motivo, sem encaminhar nem corrigir', async () => {
    simular(() => ({}));
    montar(ManifestacaoDetalhe, {
      manifestacao: {
        ...MAN,
        canceladaEm: '2026-10-21T08:00:00',
        motivoCancelamento: 'Registro em duplicidade',
      },
      podeResponder: true,
      podeRegistrarNc: false,
    });
    await flushPromises();
    expect(q('[data-testid="man-inativa"]')).not.toBeNull();
    expect(q('[data-testid="man-cancelada"]')?.textContent).toContain('Registro em duplicidade');
    expect(q('[data-testid="man-corrigir"]')).toBeNull();
    expect(q('[data-testid="man-encaminhar"]')).toBeNull();
  });
});

describe('ouvidoria (M4): indicadores', () => {
  it('mostra o prazo vigente, a taxa no prazo com a conta e os grupos por tipo, área e canal', async () => {
    const parcela = (n: number, d: number) => ({
      numerador: n,
      denominador: d,
      valor: d ? Math.round((n / d) * 1000) / 10 : null,
      conta: d ? `${n} ÷ ${d} × 100` : null,
    });
    const g = (chave: string, total: number) => ({
      chave,
      total,
      respondidas: 1,
      vencidas: 0,
      noPrazo: parcela(1, 1),
    });
    const chamadas = simular(() => ({
      competencia: '2026-10',
      prazoDiasUteis: 7,
      total: 3,
      canceladas: 1,
      respondidas: 2,
      vencidas: 1,
      noPrazo: parcela(1, 3),
      porTipo: [g('reclamacao', 2), g('elogio', 1)],
      porArea: [g('Recepção', 3)],
      porCanal: [g('portal', 1), g('telefone', 2)],
      cortada: false,
    }));
    montar(IndicadoresOuvidoria, { competencia: '2026-10' });
    await flushPromises();
    expect(chamadas[0]?.url).toBe('/api/qualidade/ouvidoria/indicadores?competencia=2026-10');
    expect(q('[data-testid="ouv-ind-prazo"]')?.textContent).toContain('7 dias úteis');
    expect(q('[data-testid="ouv-ind-no-prazo"]')?.textContent).toContain('1 ÷ 3 × 100');
    expect(q('[data-testid="ouv-ind-tipo-reclamacao"]')?.textContent).toContain('Reclamação');
    expect(q('[data-testid="ouv-ind-canal-portal"]')?.textContent).toContain('Portal do paciente');
    expect(q('[data-testid="ouv-ind-area-Recepção"]')).not.toBeNull();
  });
});
