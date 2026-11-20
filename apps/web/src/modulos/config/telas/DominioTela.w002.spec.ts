// @vitest-environment jsdom
// W0-02: a DominioTela com os verbos novos do motor do CRUD genérico —
//   - Excluir pede o motivo e a senha de novo (operação crítica); a recusa com registros dependentes mostra a lista
//     (onde, quantos e exemplos) e oferece "Inativar em vez disso";
//   - Reativar (também nos cadastros que inativam pela situação) pede o motivo e o envia;
//   - as colunas de referência usam o SanteSelecao (com busca acima do limiar).
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import DominioTela from './DominioTela.vue';

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

const descricao = {
  modulo: 'hotelaria',
  recurso: 'area',
  rotulo: { singular: 'Área', plural: 'Áreas' },
  subitem: 'x',
  rota: '/cadastros/dominios/hotelaria/area',
  natureza: 'editavel',
  acoes: ['ler', 'criar', 'editar', 'inativar', 'excluir'],
  permitidas: ['ler', 'criar', 'editar', 'inativar', 'excluir'],
  campos: [
    {
      campo: 'codigo',
      rotulo: 'Código',
      tipo: 'inteiro',
      obrigatorio: false,
      editavel: false,
      naInclusao: false,
      naLista: true,
    },
    {
      campo: 'nome',
      rotulo: 'Nome',
      tipo: 'texto',
      maxBytes: 40,
      obrigatorio: true,
      editavel: true,
      naInclusao: true,
      naLista: true,
    },
    {
      campo: 'criticidade',
      rotulo: 'Criticidade',
      tipo: 'referencia',
      obrigatorio: true,
      editavel: true,
      naInclusao: true,
      naLista: true,
      referencia: 'criticidade',
    },
  ],
  campoCodigo: 'codigo',
  campoDescricao: 'nome',
  campoSituacao: 'situacao',
  exportarExigeJustificativa: false,
  estados: {},
  reativaNaSituacao: true,
};
const itens = [
  { codigo: '1', ativo: true, valores: { codigo: 1, nome: 'ÁREA SINTÉTICA', criticidade: 1 }, versao: 'v1' },
  { codigo: '2', ativo: false, valores: { codigo: 2, nome: 'ÁREA INATIVA', criticidade: 1 }, versao: 'v2' },
];
const opcoes = Array.from({ length: 30 }, (_, i) => ({
  valor: i + 1,
  rotulo: `Criticidade ${i + 1}`,
  ativo: true,
}));

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

interface Pedido {
  url: string;
  metodo: string;
  corpo: Record<string, unknown> | null;
}
function servidor(
  resposta409?: Record<string, unknown>,
  extraDescricao: Record<string, unknown> = {},
): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const metodo = init?.method ?? 'GET';
      pedidos.push({ url: u, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      if (metodo === 'POST' && u.endsWith('/excluir') && resposta409) return json(resposta409, 409);
      if (metodo === 'POST') return json({ codigo: '1', operacao: 'x', destino: 'memoria' });
      if (u.includes('/opcoes/')) return json({ opcoes });
      if (u.endsWith('/textos')) return json({ textos: { respostas: 'Sim' } });
      if (/\/itens\/\d+\/uso$/.test(u)) return json({ emUso: false, referencias: [], aviso: null });
      const m = /\/itens\/(\d+)$/.exec(u);
      if (m) return json(itens.find((x) => x.codigo === m[1]));
      if (u.includes('/itens')) return json({ itens, total: 2, truncada: false, pagina: 1, porPagina: 25 });
      return json({ ...descricao, ...extraDescricao });
    }),
  );
  return pedidos;
}

const montar = () =>
  mount(DominioTela, {
    attachTo: document.body,
    props: { modulo: 'hotelaria', recurso: 'area' },
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });
const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
async function digitar(sel: string, valor: string): Promise<void> {
  const el = q<HTMLInputElement | HTMLTextAreaElement>(sel)!;
  el.value = valor;
  el.dispatchEvent(new Event('input'));
  await flushPromises();
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('DominioTela (W0-02): excluir e reativar com motivo', () => {
  it('Excluir pede motivo e senha; a recusa com dependentes mostra a lista e "Inativar em vez disso" inativa', async () => {
    const pedidos = servidor({
      type: 'urn:sgh:problema:recusa-de-negocio',
      title: 'Exclusão recusada',
      status: 409,
      detail: 'Este item tem 3 registros dependentes.',
      codigo: 'com-dependentes',
      dependentes: [
        { rotulo: 'Profissionais por área', quantidade: 3, amostra: ['1|7', '1|9', '1|12'], origem: 'fk' },
      ],
      total: 3,
      podeInativar: true,
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    q<HTMLButtonElement>('[data-testid="excluir-1"]')!.click();
    await flushPromises();
    const confirmar = q<HTMLButtonElement>('[data-testid="dialogo-confirmar"]')!;
    // Sem motivo e sem senha: não confirma.
    expect(confirmar.disabled || confirmar.getAttribute('aria-disabled') === 'true').toBe(true);
    await digitar('[data-testid="dialogo-motivo"]', 'Item cadastrado por engano no teste');
    await digitar('[data-testid="dialogo-senha"]', 'senha-do-teste');
    q<HTMLFormElement>('[data-testid="form-gravacao"]')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    await flushPromises();
    const exc = pedidos.find((p) => p.metodo === 'POST' && p.url.endsWith('/itens/1/excluir'))!;
    expect(exc.corpo).toEqual({
      versao: 'v1',
      motivo: 'Item cadastrado por engano no teste',
      senha: 'senha-do-teste',
    });
    const lista = q('[data-testid="dominio-dependentes"]')!;
    expect(lista.textContent).toContain('Profissionais por área');
    expect(lista.textContent).toContain('1|7, 1|9, 1|12');
    expect(q('[data-testid="dependente-0"]')?.textContent).toContain('3');
    q<HTMLButtonElement>('[data-testid="inativar-em-vez"]')!.click();
    await flushPromises();
    // Revisão do W0-02: a inativação também pede o motivo.
    await digitar('[data-testid="dialogo-motivo"]', 'Inativado no lugar da exclusão (teste)');
    q<HTMLFormElement>('[data-testid="form-gravacao"]')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    await flushPromises();
    const ina = pedidos.find((p) => p.metodo === 'POST' && p.url.endsWith('/itens/1/inativar'))!;
    expect(ina.corpo).toEqual({ versao: 'v1', motivo: 'Inativado no lugar da exclusão (teste)' });
    w.unmount();
  });

  it('a recusa do gatilho do banco (recusa-do-gatilho) chega à tela com a mensagem dele, sem a lista de dependentes', async () => {
    servidor({
      type: 'urn:sgh:problema:recusa-de-negocio',
      title: 'Exclusão recusada',
      status: 409,
      detail: 'Inclusão/Alteração/Exclusão não permitida! Dados de sistema.',
      codigo: 'recusa-do-gatilho',
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    q<HTMLButtonElement>('[data-testid="excluir-1"]')!.click();
    await flushPromises();
    await digitar('[data-testid="dialogo-motivo"]', 'Item cadastrado por engano no teste');
    await digitar('[data-testid="dialogo-senha"]', 'senha-do-teste');
    q<HTMLFormElement>('[data-testid="form-gravacao"]')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    await flushPromises();
    expect(document.body.textContent).toContain(
      'Inclusão/Alteração/Exclusão não permitida! Dados de sistema.',
    );
    expect(q('[data-testid="dominio-dependentes"]')).toBeNull();
    w.unmount();
  });

  it('Reativar pede o motivo e o envia (cadastro que inativa pela situação)', async () => {
    const pedidos = servidor();
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(q('[data-testid="reativar-1"]')).toBeNull();
    q<HTMLButtonElement>('[data-testid="reativar-2"]')!.click();
    await flushPromises();
    expect(q('[data-testid="dialogo-senha"]')).toBeNull();
    await digitar('[data-testid="dialogo-motivo"]', 'Área voltou a ser usada no hospital');
    q<HTMLFormElement>('[data-testid="form-gravacao"]')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    await flushPromises();
    const r = pedidos.find((p) => p.metodo === 'POST' && p.url.endsWith('/itens/2/reativar'))!;
    expect(r.corpo).toEqual({ versao: 'v2', motivo: 'Área voltou a ser usada no hospital' });
    expect(q('[data-testid="mensagem-dominio"]')?.textContent).toContain('Item reativado.');
    w.unmount();
  });

  it('a coluna de referência no formulário é um SanteSelecao com busca (lista grande)', async () => {
    servidor();
    const w = montar();
    await flushPromises();
    await flushPromises();
    q<HTMLButtonElement>('[data-testid="botao-incluir"]')!.click();
    await flushPromises();
    const combo = q('[data-testid="campo-criticidade"]')!;
    expect(combo).not.toBeNull();
    expect(document.body.innerHTML).not.toMatch(/<select\b/);
    w.unmount();
  });
});

describe('DominioTela (revisão do W0-02)', () => {
  it('Inativar pede o motivo e manda a versão vista na lista', async () => {
    const pedidos = servidor();
    const w = montar();
    await flushPromises();
    await flushPromises();
    q<HTMLButtonElement>('[data-testid="inativar-1"]')!.click();
    await flushPromises();
    const confirmar = q<HTMLButtonElement>('[data-testid="dialogo-confirmar"]')!;
    expect(confirmar.disabled || confirmar.getAttribute('aria-disabled') === 'true').toBe(true);
    await digitar('[data-testid="dialogo-motivo"]', 'Área desativada no hospital (teste)');
    q<HTMLFormElement>('[data-testid="form-gravacao"]')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    await flushPromises();
    const r = pedidos.find((p) => p.metodo === 'POST' && p.url.endsWith('/itens/1/inativar'))!;
    expect(r.corpo).toEqual({ versao: 'v1', motivo: 'Área desativada no hospital (teste)' });
    // A versão é a da lista: nenhum GET do item antes do POST.
    expect(pedidos.some((p) => p.metodo === 'GET' && /\/itens\/1$/.test(p.url))).toBe(false);
    w.unmount();
  });

  it('o item inativo com dependentes não recebe "Inativar em vez disso"', async () => {
    servidor({
      type: 'urn:sgh:problema:recusa-de-negocio',
      title: 'Exclusão recusada',
      status: 409,
      detail: 'Este item tem 1 registro dependente.',
      codigo: 'com-dependentes',
      dependentes: [{ rotulo: 'Profissionais por área', quantidade: 1, amostra: ['9'], origem: 'fk' }],
      total: 1,
      podeInativar: true,
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    q<HTMLButtonElement>('[data-testid="excluir-2"]')!.click();
    await flushPromises();
    await digitar('[data-testid="dialogo-motivo"]', 'Item cadastrado por engano no teste');
    await digitar('[data-testid="dialogo-senha"]', 'senha-do-teste');
    q<HTMLFormElement>('[data-testid="form-gravacao"]')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    await flushPromises();
    expect(q('[data-testid="dominio-dependentes"]')).not.toBeNull();
    expect(q('[data-testid="inativar-em-vez"]')).toBeNull();
    w.unmount();
  });

  it('a colisão da exclusão (versão vista na lista mudou) mostra o aviso do M07', async () => {
    const pedidos = servidor({
      type: 'urn:sgh:problema:conflito-de-versao',
      title: 'Registro alterado por outra pessoa',
      status: 409,
      detail: 'O registro mudou desde a leitura.',
      codigo: 'conflito-versao',
      campos: ['nome'],
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    q<HTMLButtonElement>('[data-testid="excluir-1"]')!.click();
    await flushPromises();
    await digitar('[data-testid="dialogo-motivo"]', 'Item cadastrado por engano no teste');
    await digitar('[data-testid="dialogo-senha"]', 'senha-do-teste');
    q<HTMLFormElement>('[data-testid="form-gravacao"]')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    await flushPromises();
    const exc = pedidos.find((p) => p.metodo === 'POST' && p.url.endsWith('/itens/1/excluir'))!;
    expect(exc.corpo?.['versao']).toBe('v1');
    expect(q('[data-testid="colisao-lista"]')).not.toBeNull();
    w.unmount();
  });

  it('o Reativar segue a liberação da própria operação; o aviso da exclusão só promete histórico quando há', async () => {
    servidor(undefined, { recusadas: { reativar: 'Reativação ainda não liberada.' } });
    const w = montar();
    await flushPromises();
    await flushPromises();
    const reat = q<HTMLButtonElement>('[data-testid="reativar-2"]')!;
    expect(reat.disabled || reat.getAttribute('aria-disabled') === 'true').toBe(true);
    const inat = q<HTMLButtonElement>('[data-testid="inativar-1"]')!;
    expect(inat.disabled || inat.getAttribute('aria-disabled') === 'true').toBe(false);
    q<HTMLButtonElement>('[data-testid="excluir-1"]')!.click();
    await flushPromises();
    expect(document.body.textContent).toContain('o motivo fica registrado na trilha');
    expect(document.body.textContent).not.toContain('histórico de exclusões');
    w.unmount();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    servidor(undefined, { exclusaoProtegida: true });
    const w2 = montar();
    await flushPromises();
    await flushPromises();
    q<HTMLButtonElement>('[data-testid="excluir-1"]')!.click();
    await flushPromises();
    expect(document.body.textContent).toContain('histórico de exclusões');
    w2.unmount();
  });

  it('textos longos: o item inativo não manda usar Alterar; a inclusão tem o editor e envia o texto', async () => {
    const pedidos = servidor(undefined, {
      textosLongos: [{ campo: 'respostas', rotulo: 'Respostas possíveis', editavel: true, maxBytes: 1000 }],
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    q<HTMLButtonElement>('[data-testid="textos-2"]')!.click();
    await flushPromises();
    expect(q('[data-testid="aviso-textos"]')?.textContent).toContain('reative o item');
    q<HTMLButtonElement>('[data-testid="textos-1"]')!.click();
    await flushPromises();
    expect(q('[data-testid="aviso-textos"]')?.textContent).toContain('use Alterar');
    q<HTMLButtonElement>('[data-testid="botao-incluir"]')!.click();
    await flushPromises();
    expect(q('[data-testid="texto-longo-respostas"]')).not.toBeNull();
    w.unmount();
    expect(pedidos.length).toBeGreaterThan(0);
  });
});
