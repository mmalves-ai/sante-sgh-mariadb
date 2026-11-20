// @vitest-environment jsdom
// W1-01 (parte 4b): o CRUD do grupo na tela "Grupos de usuários e perfis": quem só lê não vê ação; quem gere inclui,
// renomeia, inativa/reativa e exclui com a senha num diálogo (senha errada fica no diálogo); a recusa da exclusão do
// grupo usado mostra quantos e quais e oferece inativar. Dados SINTÉTICOS; o fetch é simulado.
import type { Sessao } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import GruposTela from './telas/GruposTela.vue';

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
  metodo: string;
  url: string;
  corpo: Record<string, unknown> | null;
}
type Responder = (p: Pedido) => { status: number; corpo: unknown } | undefined;

const grupo = (nome: string, ativo = true) => ({
  grupo: nome,
  ativo,
  usuariosAtivos: 0,
  opcoesLegado: 0,
  permissoesNovo: 0,
  destino: 'caso-a-caso',
  perfil: null,
  nivel: null,
  motivo: null,
});

function simular(responder: Responder): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const p: Pedido = {
        metodo: init?.method ?? 'GET',
        url: String(url),
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      pedidos.push(p);
      const r =
        responder(p) ??
        (p.url === '/api/acesso/grupos'
          ? {
              status: 200,
              corpo: { grupos: [grupo('SINT_USADO'), grupo('SINT_VAZIO'), grupo('SINT_OFF', false)] },
            }
          : p.url.startsWith('/api/administracao')
            ? { status: 200, corpo: { propostas: [] } }
            : { status: 404, corpo: { type: 'nao-encontrado', title: 'x', status: 404 } });
      return new Response(JSON.stringify(r.corpo), {
        status: r.status,
        headers: { 'content-type': r.status >= 400 ? 'application/problem+json' : 'application/json' },
      });
    }),
  );
  return pedidos;
}

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montadas: { unmount: () => void }[] = [];
async function montar() {
  const w = mount(GruposTela as never, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }, PropostasGrupos: true },
    },
  });
  montadas.push(w);
  await flushPromises();
  return w;
}
const ultimoPost = (ps: Pedido[]) => ps.filter((p) => p.metodo === 'POST').at(-1);
const comPermissoes = (permissoes: string[]) => definirSessaoDaTela({ permissoes } as unknown as Sessao);
const $ = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
async function digitar(id: string, valor: string) {
  const el = $(id);
  const input = (
    el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' ? el : el?.querySelector('input,textarea')
  ) as HTMLInputElement | null;
  if (!input) throw new Error(`campo ${id} ausente`);
  input.value = valor;
  input.dispatchEvent(new Event('input'));
  await flushPromises();
}
async function clicar(id: string) {
  const el = $(id);
  const b = (el?.tagName === 'BUTTON' ? el : el?.querySelector('button')) as HTMLButtonElement | null;
  if (!b) throw new Error(`botão ${id} ausente`);
  b.click();
  await flushPromises();
}
async function confirmar() {
  $('grupos-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
}

afterEach(async () => {
  await flushPromises();
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  definirSessaoDaTela(null);
});

describe('GruposTela (W1-01 parte 4b): CRUD do grupo', () => {
  it('só leitura: sem acesso.perfil.gerir não há inclusão nem ações', async () => {
    comPermissoes(['acesso.grupo.ler']);
    simular(() => undefined);
    await montar();
    expect($('tabela-grupos')?.textContent).toContain('SINT_USADO');
    expect($('grupos-novo')).toBeNull();
    expect($('grupo-excluir-SINT_VAZIO')).toBeNull();
  });

  it('inclui, renomeia (senha errada fica no diálogo), inativa e reativa pela receita, com a senha', async () => {
    comPermissoes(['acesso.grupo.ler', 'acesso.perfil.gerir']);
    let tentativa = 0;
    const pedidos = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      if (p.url.endsWith('acesso.renomearGrupo') && tentativa++ === 0)
        return { status: 401, corpo: { type: 'reautenticacao-necessaria', title: 'Senha', status: 401 } };
      return { status: 200, corpo: { ok: true } };
    });
    await montar();
    await digitar('grupos-novo-nome', 'SINT_NOVO');
    $('grupos-novo')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    await digitar('grupos-senha', 'segredo');
    await confirmar();
    expect(ultimoPost(pedidos)).toMatchObject({
      url: '/api/acesso/gestao/legado/acesso.criarGrupo',
      corpo: { entrada: { nome: 'SINT_NOVO' }, senha: 'segredo' },
    });
    expect($('grupos-aviso')?.textContent).toContain('Grupo SINT_NOVO incluído.');

    await clicar('grupo-renomear-SINT_VAZIO');
    await digitar('grupos-renomear-nome', 'SINT_RENOMEADO');
    await digitar('grupos-senha', 'errada');
    await confirmar();
    expect($('grupos-senha-erro')?.textContent).toContain('A senha não confere');
    expect($('grupos-form')).not.toBeNull();
    await digitar('grupos-senha', 'segredo');
    await confirmar();
    expect(ultimoPost(pedidos)).toMatchObject({
      url: '/api/acesso/gestao/legado/acesso.renomearGrupo',
      corpo: { entrada: { nome: 'SINT_VAZIO', novoNome: 'SINT_RENOMEADO' } },
    });
    expect($('grupos-aviso')?.textContent).toContain('SINT_RENOMEADO');

    await clicar('grupo-desativar-SINT_VAZIO');
    await digitar('grupos-senha', 'segredo');
    await confirmar();
    expect(ultimoPost(pedidos)?.url).toBe('/api/acesso/gestao/legado/acesso.desativarGrupo');
    await clicar('grupo-reativar-SINT_OFF');
    await digitar('grupos-senha', 'segredo');
    await confirmar();
    expect(ultimoPost(pedidos)).toMatchObject({
      url: '/api/acesso/gestao/legado/acesso.reativarGrupo',
      corpo: { entrada: { nome: 'SINT_OFF' } },
    });
  });

  it('exclui o grupo nunca usado com motivo; o usado é recusado com quantos e quais e oferece inativar', async () => {
    comPermissoes(['acesso.grupo.ler', 'acesso.perfil.gerir']);
    const pedidos = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      const e = p.corpo?.['entrada'] as { nome: string };
      if (p.url.endsWith('acesso.excluirGrupo') && e.nome === 'SINT_USADO')
        return {
          status: 409,
          corpo: {
            type: 'recusa-de-negocio',
            title: 'Operação recusada',
            status: 409,
            detail:
              'Este grupo tem 3 registros dependentes: 3 registros em Logins do sistema. Inative o grupo em vez de excluir.',
            codigo: 'com-dependentes',
            podeInativar: true,
          },
        };
      return { status: 200, corpo: { ok: true } };
    });
    await montar();
    await clicar('grupo-excluir-SINT_VAZIO');
    await digitar('grupos-senha', 'segredo');
    // Sem motivo o botão não grava.
    expect(
      ($('grupos-confirmar')?.querySelector('button') ?? $('grupos-confirmar')) as HTMLButtonElement,
    ).toHaveProperty('disabled', true);
    await digitar('grupos-motivo', 'criado por engano');
    await confirmar();
    expect(ultimoPost(pedidos)).toMatchObject({
      url: '/api/acesso/gestao/legado/acesso.excluirGrupo',
      corpo: { entrada: { nome: 'SINT_VAZIO', motivo: 'criado por engano' } },
    });

    await clicar('grupo-excluir-SINT_USADO');
    await digitar('grupos-motivo', 'engano');
    await digitar('grupos-senha', 'segredo');
    await confirmar();
    expect($('grupos-recusa')?.textContent).toContain('3 registros em Logins do sistema');
    await clicar('grupos-inativar-oferecido');
    await digitar('grupos-senha', 'segredo');
    await confirmar();
    expect(ultimoPost(pedidos)).toMatchObject({
      url: '/api/acesso/gestao/legado/acesso.desativarGrupo',
      corpo: { entrada: { nome: 'SINT_USADO' } },
    });
  });

  it('parte 4c: a descrição na coluna; a ação grava versão nova com motivo e senha e mostra as anteriores', async () => {
    comPermissoes(['acesso.grupo.ler', 'acesso.perfil.gerir']);
    const pedidos = simular((p) => {
      if (p.url === '/api/acesso/grupos')
        return {
          status: 200,
          corpo: {
            grupos: [
              { ...grupo('SINT_VAZIO'), descricao: 'Texto atual', descricaoVersao: 1 },
              grupo('SINT_USADO'),
            ],
          },
        };
      if (p.url === '/api/acesso/gestao/grupos/SINT_VAZIO/descricoes')
        return {
          status: 200,
          corpo: [
            {
              versao: 1,
              descricao: 'Texto atual',
              motivo: 'criação',
              criadoPor: 'SINT.GESTOR',
              criadoEm: '2026-11-18T12:00:00.000Z',
              situacao: 'vigente',
              encerradaEm: null,
            },
          ],
        };
      if (p.metodo === 'POST') return { status: 200, corpo: { id: '1', versao: 2, anterior: 1 } };
      return undefined;
    });
    await montar();
    expect($('grupo-descricao-SINT_VAZIO')?.textContent).toContain('Texto atual');
    expect($('grupo-descricao-SINT_USADO')?.textContent).toContain('Sem descrição');
    await clicar('grupo-descrever-SINT_VAZIO');
    expect($('grupos-versoes')?.textContent).toContain('Versão 1');
    expect($('grupos-versoes')?.textContent).toContain('vigente');
    // Texto igual ao vigente ou sem motivo: o botão não grava.
    await digitar('grupos-senha', 'segredo');
    await confirmar();
    expect(pedidos.filter((p) => p.metodo === 'POST')).toEqual([]);
    await digitar('grupos-descricao', 'Recepção e triagem');
    await digitar('grupos-descricao-motivo', 'reorganização');
    await confirmar();
    expect(ultimoPost(pedidos)).toMatchObject({
      url: '/api/acesso/gestao/grupos/descricao',
      corpo: {
        grupo: 'SINT_VAZIO',
        descricao: 'Recepção e triagem',
        motivo: 'reorganização',
        senha: 'segredo',
      },
    });
    expect($('grupos-aviso')?.textContent).toContain('Descrição do grupo SINT_VAZIO gravada.');
  });
});
