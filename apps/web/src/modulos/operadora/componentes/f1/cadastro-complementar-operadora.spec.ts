// @vitest-environment jsdom
// C1-071 (08-SGO L93): a aba dos responsáveis, setores e parâmetros da operadora. A troca do representante legal mostra,
// antes de gravar, qual período se encerra na véspera; o responsável é achado pelo CPF exato; o setor recusa na hora o
// ciclo na hierarquia; o parâmetro mostra a faixa e manda o número; sem a permissão de editar a empresa, só consulta.
// Dados SINTÉTICOS; a API é simulada.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../../i18n/pt-BR.js';
import CadastroComplementarOperadora from './CadastroComplementarOperadora.vue';

const api = vi.hoisted(() => ({
  lerResponsaveisOperadora: vi.fn(),
  lerDepartamentosOperadora: vi.fn(),
  lerParametrosOperadora: vi.fn(),
  buscarPessoaResponsavel: vi.fn(),
  incluirResponsavelOperadora: vi.fn(),
  gravarDepartamentoOperadora: vi.fn(),
  definirParametroOperadora: vi.fn(),
}));
vi.mock('../../api-cadastro-complementar.js', () => api);

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
const montadas: { unmount: () => void }[] = [];
async function montar(podeEditar = true) {
  const w = mount(CadastroComplementarOperadora, {
    attachTo: document.body,
    props: { operadora: 7, podeEditar, hoje: '2026-11-18' },
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
const el = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const clicar = async (id: string) => {
  const b = el(id);
  expect(b, id).not.toBeNull();
  (b!.tagName === 'BUTTON' ? b! : b!.querySelector('button')!).click();
  await flushPromises();
};
const escrever = async (id: string, v: string) => {
  const e = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  expect(e, id).not.toBeNull();
  e.value = v;
  e.dispatchEvent(new Event('input'));
  await flushPromises();
};
const desabilitado = (id: string) => {
  const b = el(id)!;
  return (b.tagName === 'BUTTON' ? (b as HTMLButtonElement) : b.querySelector('button')!).disabled;
};

const representante = {
  id: 31,
  sequencia: 1,
  tipo: 'representante_legal',
  natureza: 'fisica',
  pessoa: 501,
  nome: 'Representante Sintética',
  numeroRegistro: null,
  inicio: '2026-01-01',
  fim: null,
  vigente: true,
};
const setores = [
  {
    id: 1,
    versao: 1,
    codigo: 'AUT',
    descricao: 'Autorização',
    tipo: 'autorizacao',
    email: null,
    emailsCopia: [],
    superior: null,
    visivelPortal: true,
    ativo: true,
  },
  {
    id: 2,
    versao: 3,
    codigo: 'REG',
    descricao: 'Regulação',
    tipo: 'regulacao',
    email: 'reg@exemplo.test',
    emailsCopia: [],
    superior: 1,
    visivelPortal: false,
    ativo: true,
  },
];
const parametros = [
  { chave: 'prazo_cpt_meses', descricao: 'Prazo da CPT', valor: 24, padrao: true, desde: null },
  {
    chave: 'cobra_segunda_via_cartao',
    descricao: 'Cobra a segunda via',
    valor: false,
    padrao: true,
    desde: null,
  },
];

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.lerResponsaveisOperadora.mockResolvedValue([representante]);
  api.lerDepartamentosOperadora.mockResolvedValue(setores);
  api.lerParametrosOperadora.mockResolvedValue(parametros);
});
afterEach(() => {
  for (const w of montadas.splice(0)) w.unmount();
  document.body.innerHTML = '';
});

describe('C1-071: responsáveis, setores e parâmetros da operadora', () => {
  it('lista os responsáveis com o nome e avisa os papéis únicos sem titular vigente', async () => {
    await montar();
    expect(el('responsavel-31')?.textContent).toContain('Representante Sintética');
    expect(el('responsavel-31')?.textContent).toContain('Vigente');
    const aviso = el('compl-papeis-sem-titular')?.textContent ?? '';
    expect(aviso).toContain('Responsável técnico');
    expect(aviso).toContain('Ouvidor');
    expect(aviso).not.toContain('Representante legal');
  });

  it('troca do representante: acha a pessoa pelo CPF, mostra o encerramento na véspera e grava o corpo certo', async () => {
    api.buscarPessoaResponsavel.mockResolvedValue({
      id: 777,
      natureza: 'fisica',
      nome: 'Novo Representante',
    });
    api.incluirResponsavelOperadora.mockResolvedValue({ id: 32 });
    await montar();
    await clicar('compl-resp-novo');
    expect(desabilitado('compl-resp-gravar')).toBe(true);
    await escrever('compl-resp-documento', '529.982.247-25');
    await clicar('compl-resp-buscar');
    expect(api.buscarPessoaResponsavel).toHaveBeenCalledWith('529.982.247-25');
    expect(el('compl-resp-pessoa')?.textContent).toContain('Novo Representante');
    expect(el('compl-resp-encerra')?.textContent).toContain('Representante Sintética');
    expect(el('compl-resp-encerra')?.textContent).toContain('17/11/2026');
    expect(desabilitado('compl-resp-gravar')).toBe(false);
    await clicar('compl-resp-gravar');
    expect(api.incluirResponsavelOperadora).toHaveBeenCalledWith(7, {
      tipo: 'representante_legal',
      natureza: 'fisica',
      pessoa: 777,
      numeroRegistro: null,
      inicio: '2026-11-18',
      fim: null,
    });
    expect(el('compl-mensagem')?.textContent).toContain('Responsável registrado');
    expect(api.lerResponsaveisOperadora).toHaveBeenCalledTimes(2);
  });

  it('documento sem cadastro: avisa e não deixa gravar', async () => {
    api.buscarPessoaResponsavel.mockResolvedValue(null);
    await montar();
    await clicar('compl-resp-novo');
    await escrever('compl-resp-documento', '52998224725');
    await clicar('compl-resp-buscar');
    expect(document.body.textContent).toContain('Nenhuma pessoa com este documento');
    expect(desabilitado('compl-resp-gravar')).toBe(true);
  });

  it('setor: recusa na hora o ciclo na hierarquia e grava a alteração com a versão vista', async () => {
    api.gravarDepartamentoOperadora.mockResolvedValue({ id: 1 });
    await montar();
    await clicar('compl-dep-editar-AUT');
    expect(desabilitado('compl-dep-gravar')).toBe(false);
    await escrever('compl-dep-email', 'sem-arroba');
    expect(el('compl-dep-problemas')?.textContent).toContain('E-mail do setor inválido');
    expect(desabilitado('compl-dep-gravar')).toBe(true);
    await escrever('compl-dep-email', 'aut@exemplo.test');
    await escrever('compl-dep-copia', 'a@exemplo.test, b@exemplo.test');
    expect(el('compl-dep-problemas')).toBeNull();
    await clicar('compl-dep-gravar');
    expect(api.gravarDepartamentoOperadora).toHaveBeenCalledWith(7, {
      id: 1,
      versao: 1,
      codigo: 'AUT',
      descricao: 'Autorização',
      tipo: 'autorizacao',
      email: 'aut@exemplo.test',
      emailsCopia: ['a@exemplo.test', 'b@exemplo.test'],
      superior: null,
      visivelPortal: true,
      ativo: true,
    });
    expect(el('compl-mensagem')?.textContent).toContain('Setor gravado');
  });

  it('parâmetro: fora da faixa mostra a faixa e não grava; dentro dela manda o número', async () => {
    api.definirParametroOperadora.mockResolvedValue({ id: 9 });
    await montar();
    expect(el('parametro-prazo_cpt_meses')?.textContent).toContain('padrão');
    await clicar('compl-par-alterar-prazo_cpt_meses');
    await escrever('compl-par-valor', '30');
    expect(el('compl-par-problema')?.textContent).toContain('de 1 a 24');
    expect(desabilitado('compl-par-gravar')).toBe(true);
    await escrever('compl-par-valor', '18');
    await escrever('compl-par-justificativa', 'Revisão sintética do contrato');
    await clicar('compl-par-gravar');
    expect(api.definirParametroOperadora).toHaveBeenCalledWith(7, {
      chave: 'prazo_cpt_meses',
      valor: 18,
      inicio: null,
      justificativa: 'Revisão sintética do contrato',
    });
  });

  it('sem a permissão de editar a empresa: só consulta, sem botões de gravar', async () => {
    await montar(false);
    expect(el('compl-so-consulta')).not.toBeNull();
    expect(el('compl-resp-novo')).toBeNull();
    expect(el('compl-dep-novo')).toBeNull();
    expect(el('compl-dep-editar-AUT')).toBeNull();
    expect(el('compl-par-alterar-prazo_cpt_meses')).toBeNull();
  });
});
