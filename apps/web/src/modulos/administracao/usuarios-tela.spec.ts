// @vitest-environment jsdom
// Tela "Usuários" redesenhada (17/11/2026): as regras de apresentação (iniciais, datas, CPF formatado e mascarado,
// gravações desligadas agrupadas pelo motivo), a chave liga/desliga acessível e a ficha montada (CPF só para a
// plataforma, com o olho; aviso único das gravações desligadas; a senha pedida num diálogo na hora da gravação;
// as permissões complementares como chaves só de leitura). Dados SINTÉTICOS; o fetch é simulado.
import type { FichaUsuario, Sessao } from '@sgh/contratos';
import { SanteChave, criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import CpfUsuarios from './componentes/CpfUsuarios.vue';
import FichaUsuarioTela from './telas/FichaUsuarioTela.vue';
import {
  dataHora,
  desligadasPorMotivo,
  filtrosDaQuery,
  formatarCpf,
  iniciais,
  mascararCpf,
  queryDosFiltros,
  voltarParaLista,
} from './usuarios-tela.js';

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
  corpo: unknown;
}
function simular(responder: (p: Pedido) => { status: number; corpo: unknown } | undefined): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const p: Pedido = {
        metodo: init?.method ?? 'GET',
        url: String(url),
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
      };
      pedidos.push(p);
      const r = responder(p) ?? { status: 404, corpo: { type: 'nao-encontrado', title: 'x', status: 404 } };
      return new Response(JSON.stringify(r.corpo), {
        status: r.status,
        headers: { 'content-type': r.status >= 400 ? 'application/problem+json' : 'application/json' },
      });
    }),
  );
  return pedidos;
}
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
let cliente = new QueryClient();
async function montar(tela: Component, props: Record<string, unknown> = {}) {
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:caminho(.*)*', component: { template: '<div />' } }],
  });
  await roteador.push('/');
  const w = mount(tela as never, {
    attachTo: document.body,
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        roteador,
        [VueQueryPlugin, { queryClient: cliente }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a href="#"><slot /></a>' } },
    },
  });
  montados.push(w);
  return w;
}
const montados: { unmount: () => void }[] = [];
afterEach(async () => {
  for (const w of montados.splice(0)) {
    try {
      w.unmount();
    } catch {
      // já desmontado no próprio teste
    }
  }
  await flushPromises();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const MOTIVO = 'Motivo sintético da gravação desligada.';
const ESCOPOS_VAZIOS = {
  unidade: [],
  local: [],
  convenio: [],
  convenioFaturamento: [],
  tipoAgenda: [],
  tipoProntuario: [],
  procedimentoSus: [],
};
function ficha(
  m: {
    cpf?: string | null;
    nome?: string | null;
    desligar?: string[];
    profissional?: { id: number; nome: string } | null;
  } = {},
): FichaUsuario {
  const ops = [
    ['acesso.alterarUsuario', 'Alterar o nome completo'],
    ['acesso.bloquearUsuario', 'Bloquear usuário'],
    ['acesso.desbloquearUsuario', 'Desbloquear usuário'],
    ['acesso.trocarGrupoUsuario', 'Trocar o grupo do usuário'],
    ['acesso.alterarFlagsUsuario', 'Alterar permissões complementares'],
    ['acesso.redefinirSenha', 'Redefinir a senha (senha provisória)'],
  ] as const;
  const desligar = m.desligar ?? [];
  return {
    usuario: {
      login: 'SINT.ALVO',
      id: 7,
      nome: m.nome === undefined ? 'Pessoa Sintetica Alvo' : m.nome,
      grupo: 'SAME',
      ativo: true,
      bloqueado: false,
      cpfInformado: true,
      cpf: m.cpf ?? null,
      senhaDefinida: true,
      versao: '{"NOMEC":"x"}',
    },
    grupoAtivo: true,
    papeis: [],
    escopos: { ...ESCOPOS_VAZIOS, unidade: [{ valor: '1', rotulo: 'Unidade Sintética' }] },
    escoposConsulta: { centrosCusto: 0, locaisEstoque: 0, contasBancarias: 0 },
    setores: [],
    flags: [
      { coluna: 'FLAG_A', letra: 'T', ligado: true, aConfirmar: true, podeLigar: true, podeDesligar: true },
      // W1-01: FLAG_B nunca foi ligada no estabelecimento (só a letra F vista): a chave fica parada.
      { coluna: 'FLAG_B', letra: 'F', ligado: false, aConfirmar: true, podeLigar: false, podeDesligar: true },
      { coluna: 'FLAG_C', letra: null, ligado: null, aConfirmar: true },
    ],
    conexoes: [],
    sessoes: [],
    termo: { aceitouVigente: true, aceitoEm: '2026-11-01T10:20:00' },
    historicoSenha: null,
    profissionalVinculado: m.profissional ?? null,
    operacoes: ops.map(([operacao, rotulo]) => ({
      operacao,
      rotulo,
      ligada: !desligar.includes(operacao),
      motivo: !desligar.includes(operacao)
        ? null
        : operacao === 'acesso.alterarFlagsUsuario'
          ? 'Motivo fixo das permissões.'
          : MOTIVO,
    })),
    destino: 'memoria',
  } as FichaUsuario;
}
const OPCOES = { escopos: ESCOPOS_VAZIOS, grupos: [{ nome: 'SAME', ativo: true }], setores: [] };
/** Servidor simulado: a ficha (qualquer login), e o POST respondido por `post` (padrão: 200). */
function servidor(
  f: FichaUsuario | (() => FichaUsuario),
  post: (p: Pedido) => { status: number; corpo: unknown } = () => ({ status: 200, corpo: {} }),
) {
  return simular((p) => {
    if (p.url.endsWith('/usuarios-opcoes')) return { status: 200, corpo: OPCOES };
    if (/\/usuarios\/SINT\.[A-Z]+$/.test(p.url) && p.metodo === 'GET')
      return { status: 200, corpo: typeof f === 'function' ? f() : f };
    if (p.metodo === 'POST') return post(p);
    return undefined;
  });
}
const dialogo = () => document.querySelector<HTMLFormElement>('[data-testid="form-reautenticar"]');
const campoSenha = () => document.querySelector<HTMLInputElement>('[data-testid="ficha-senha"]');
async function digitarSenhaEConfirmar(valor: string): Promise<void> {
  const s = campoSenha()!;
  s.value = valor;
  s.dispatchEvent(new Event('input'));
  dialogo()!.dispatchEvent(new Event('submit'));
  await flushPromises();
}
const comPermissoes = (permissoes: string[]) => definirSessaoDaTela({ permissoes } as unknown as Sessao);

describe('usuários: regras de apresentação', () => {
  it('filtros da lista na query e o "Voltar à lista" que devolve a lista como estava', () => {
    expect(filtrosDaQuery({ busca: 'sandro', grupo: 'SAME', situacao: 'bloqueados', pagina: '3' })).toEqual({
      busca: 'sandro',
      grupo: 'SAME',
      situacao: 'bloqueados',
      pagina: 3,
    });
    expect(filtrosDaQuery({ situacao: 'qualquer', pagina: 'x' })).toEqual({
      busca: '',
      grupo: '',
      situacao: 'todos',
      pagina: 1,
    });
    expect(queryDosFiltros({ busca: '', grupo: '', situacao: 'todos', pagina: 1 })).toEqual({
      busca: undefined,
      grupo: undefined,
      situacao: undefined,
      pagina: undefined,
    });
    expect(voltarParaLista('/administracao/acesso/usuarios?busca=sandro&pagina=2')).toBe(
      '/administracao/acesso/usuarios?busca=sandro&pagina=2',
    );
    expect(voltarParaLista('/administracao/acesso/usuarios/OUTRO')).toBe('/administracao/acesso/usuarios');
    expect(voltarParaLista(null)).toBe('/administracao/acesso/usuarios');
  });

  it('iniciais, datas legíveis, CPF formatado e mascarado', () => {
    expect(iniciais('Maria da Silva Souza', 'X')).toBe('MS');
    expect(iniciais(null, 'sint.alvo')).toBe('SI');
    expect(iniciais('Usuário sintético (desenvolvimento)', 'X')).toBe('UD');
    expect(iniciais('  ', '..')).toBe('?');
    expect(dataHora('2026-11-01')).toBe('01/11/2026');
    expect(dataHora('2026-11-01T10:20:33Z')).toBe('01/11/2026 10:20');
    expect(dataHora(null)).toBe('');
    expect(dataHora('ontem')).toBe('ontem');
    expect(formatarCpf('191')).toBe('000.000.001-91');
    expect(mascararCpf('00000000191')).toBe('***.***.001-91');
  });

  it('desligadas agrupadas pelo motivo, sem as ignoradas', () => {
    const g = desligadasPorMotivo(
      [
        { operacao: 'a', rotulo: 'A', ligada: false, motivo: 'm1' },
        { operacao: 'b', rotulo: 'B', ligada: false, motivo: 'm1' },
        { operacao: 'c', rotulo: 'C', ligada: true, motivo: null },
        { operacao: 'd', rotulo: 'D', ligada: false, motivo: 'm2' },
        { operacao: 'e', rotulo: 'E', ligada: false, motivo: 'm1' },
      ],
      ['e'],
    );
    expect(g).toEqual([
      { motivo: 'm1', rotulos: ['A', 'B'] },
      { motivo: 'm2', rotulos: ['D'] },
    ]);
  });
});

describe('usuários: chave liga/desliga', () => {
  it('role=switch com aria-checked; emite o valor pedido; desligada não emite e mostra o motivo', async () => {
    const w = await montar(SanteChave, { ligada: true, rotulo: 'Acesso liberado' });
    const b = w.get('[role="switch"]');
    expect(b.attributes('aria-checked')).toBe('true');
    const rotulo = document.getElementById(b.attributes('aria-labelledby')!);
    expect(rotulo?.textContent).toBe('Acesso liberado');
    await b.trigger('click');
    expect(w.emitted('alternar')).toEqual([[false]]);
    await w.setProps({ desabilitada: true, motivo: 'Indisponível.' } as never);
    expect(b.attributes('disabled')).toBeDefined();
    expect(document.getElementById(b.attributes('aria-describedby')!)?.textContent).toBe('Indisponível.');
  });
});

describe('usuários: ficha redesenhada', () => {
  it('a plataforma vê o CPF mascarado e revela pelo olho; os outros veem só "Informado"', async () => {
    comPermissoes(['acesso.usuario.ler']);
    servidor(ficha({ cpf: '00000000191' }));
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    expect(w.get('[data-testid="ficha-cpf"]').text()).toContain('***.***.001-91');
    const olho = w.get('[data-testid="ficha-cpf-revelar"]');
    expect(olho.attributes('aria-pressed')).toBe('false');
    await olho.trigger('click');
    expect(w.get('[data-testid="ficha-cpf"]').text()).toContain('000.000.001-91');
    expect(olho.attributes('aria-pressed')).toBe('true');
    w.unmount();

    servidor(ficha({ cpf: null }));
    const w2 = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    expect(w2.get('[data-testid="ficha-cpf"]').text()).toBe('Informado');
    expect(w2.find('[data-testid="ficha-cpf-revelar"]').exists()).toBe(false);
  });

  it('sem nome: "Sem nome cadastrado"; nada desligado: nenhum aviso de gravação', async () => {
    comPermissoes(['acesso.usuario.ler']);
    servidor(ficha({ nome: null }));
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    expect(w.get('h1').text()).toBe('Sem nome cadastrado');
    expect(w.find('[data-testid="estados-gravacao"]').exists()).toBe(false);
    expect(w.get('[data-testid="ficha-situacao"]').text()).toMatch(/livre/i);
  });

  it('desligadas: um aviso só com o motivo uma vez; a chave do acesso fica desligada com o porquê', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.usuario.bloquear', 'acesso.usuario.editar']);
    servidor(ficha({ desligar: ['acesso.bloquearUsuario', 'acesso.alterarUsuario'] }));
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    const aviso = w.get('[data-testid="estados-gravacao"]');
    expect(aviso.text()).toContain('2 ações indisponíveis');
    expect(aviso.text().split(MOTIVO).length - 1).toBe(1);
    expect(aviso.text()).not.toContain('Motivo fixo das permissões.');
    const chave = w.get('[data-testid="bloquear-usuario"]');
    expect(chave.attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('Indisponível neste estabelecimento.');
  });

  it('bloquear: a chave pede a senha num diálogo e só então grava; cancelar não grava', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.usuario.bloquear']);
    const pedidos = servidor(ficha());
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    await w.get('[data-testid="bloquear-usuario"]').trigger('click');
    await flushPromises();
    expect(document.querySelector('[data-testid="ficha-senha"]')).not.toBeNull();
    // Cancelar: nada vai ao servidor.
    const cancelar = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-testid="form-reautenticar"] button'),
    ].find((b) => b.textContent?.includes('Cancelar'))!;
    cancelar.click();
    await flushPromises();
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
    // De novo, agora com a senha: grava o bloqueio com a senha digitada.
    await w.get('[data-testid="bloquear-usuario"]').trigger('click');
    await flushPromises();
    const s = document.querySelector<HTMLInputElement>('[data-testid="ficha-senha"]')!;
    s.value = 'senha-sintetica';
    s.dispatchEvent(new Event('input'));
    document
      .querySelector<HTMLFormElement>('[data-testid="form-reautenticar"]')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.url).toMatch(/\/usuarios\/SINT\.ALVO\/bloqueio$/);
    expect(post?.corpo).toEqual({ bloquear: true, senha: 'senha-sintetica' });
  });

  it('W1-01: redefinir a senha pede a senha do gestor, mostra a provisória uma vez e fechar a apaga', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.usuario.bloquear']);
    const pedidos = servidor(ficha(), (p) =>
      p.url.endsWith('/senha-provisoria')
        ? {
            status: 200,
            corpo: {
              operacao: 'acesso.redefinirSenha',
              destino: 'memoria',
              senhaProvisoria: 'Prov#Sint2026x',
              trocaObrigatoria: true,
            },
          }
        : { status: 200, corpo: {} },
    );
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    await w.get('[data-testid="redefinir-senha"]').trigger('click');
    await flushPromises();
    expect(dialogo()?.textContent).toContain('senha provisória');
    await digitarSenhaEConfirmar('senha-do-gestor');
    await flushPromises();
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.url).toMatch(/\/usuarios\/SINT\.ALVO\/senha-provisoria$/);
    expect(post?.corpo).toEqual({ senha: 'senha-do-gestor' });
    const valor = document.querySelector('[data-testid="senha-provisoria-valor"]');
    expect(valor?.textContent).toBe('Prov#Sint2026x');
    expect(document.querySelector('[data-testid="senha-provisoria-sem-troca"]')).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-testid="senha-provisoria-fechar"]')!.click();
    await flushPromises();
    expect(document.querySelector('[data-testid="senha-provisoria-valor"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Prov#Sint2026x');
  });

  it('W1-01: sem a permissão de bloquear, ou com a redefinição desligada, o botão não grava', async () => {
    comPermissoes(['acesso.usuario.ler']);
    servidor(ficha());
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    expect(w.find('[data-testid="redefinir-senha"]').exists()).toBe(false);
    comPermissoes(['acesso.usuario.ler', 'acesso.usuario.bloquear']);
    servidor(ficha({ desligar: ['acesso.redefinirSenha'] }));
    const w2 = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    expect(w2.get('[data-testid="redefinir-senha"]').attributes('disabled')).toBeDefined();
  });

  it('permissões complementares desligadas: agrupadas, chaves só de leitura, busca pelo código', async () => {
    comPermissoes(['acesso.usuario.ler']);
    servidor(ficha({ desligar: ['acesso.alterarFlagsUsuario'] }));
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    await w.get('[data-testid="ficha-aba-flags"]').trigger('click');
    const flags = w.get('[data-testid="ficha-flags"]');
    expect(flags.text()).toContain('Ligadas');
    expect(flags.text()).toContain('Desligadas');
    expect(flags.text()).toContain('Não definidas');
    expect(w.get('[data-testid="flag-FLAG_A"]').attributes('aria-checked')).toBe('true');
    expect(w.get('[data-testid="flag-FLAG_A"]').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('Motivo fixo das permissões.');
    await w.get('[data-testid="ficha-flags-busca"]').setValue('flag_b');
    expect(w.find('[data-testid="flag-FLAG_A"]').exists()).toBe(false);
    expect(w.find('[data-testid="flag-FLAG_B"]').exists()).toBe(true);
  });

  it('W1-01: permissões complementares mudam na tela e gravam juntas com a senha e a letra lida', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.usuario.editar']);
    const pedidos = servidor(() => ficha());
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    await w.get('[data-testid="ficha-aba-flags"]').trigger('click');
    expect(w.text()).not.toContain('Motivo fixo das permissões.');
    expect(w.get('[data-testid="flag-FLAG_B"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="flags-pendentes"]').exists()).toBe(false);
    await w.get('[data-testid="flag-FLAG_A"]').trigger('click');
    expect(w.get('[data-testid="flag-FLAG_A"]').attributes('aria-checked')).toBe('false');
    expect(w.get('[data-testid="flags-pendentes"]').text()).toContain('1 alteração');
    await w.get('[data-testid="flags-salvar"]').trigger('click');
    await flushPromises();
    expect(dialogo()).not.toBeNull();
    await digitarSenhaEConfirmar('senha-sintetica');
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.url).toMatch(/\/usuarios\/SINT\.ALVO\/flags$/);
    expect(post?.corpo).toMatchObject({
      entrada: { flags: [{ coluna: 'FLAG_A', ligado: false, antes: 'T' }] },
      senha: 'senha-sintetica',
    });
    expect(w.find('[data-testid="flags-pendentes"]').exists()).toBe(false);
  });

  it('fechar o diálogo pelo X (ou Esc, ou fora) limpa a senha e não grava', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.usuario.bloquear']);
    const pedidos = servidor(ficha());
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    await w.get('[data-testid="bloquear-usuario"]').trigger('click');
    await flushPromises();
    const s = campoSenha()!;
    s.value = 'senha-sintetica';
    s.dispatchEvent(new Event('input'));
    await flushPromises();
    // O X do diálogo (o mesmo caminho do Esc e do clique fora: só o v-model:visivel muda).
    const x = document.querySelector<HTMLButtonElement>(
      '.p-dialog-close-button, [data-pc-section="pcclosebutton"]',
    );
    expect(x).not.toBeNull();
    x!.click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 400));
    await flushPromises();
    expect(dialogo()).toBeNull();
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
    // Reaberto, o campo vem vazio (a senha não ficou guardada).
    await w.get('[data-testid="bloquear-usuario"]').trigger('click');
    await flushPromises();
    expect(campoSenha()!.value).toBe('');
  });

  it('senha que não confere: o diálogo fica aberto com o aviso, o campo limpa e a ação não se perde', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.usuario.bloquear']);
    let tentativas = 0;
    const pedidos = servidor(ficha(), () =>
      ++tentativas === 1
        ? {
            status: 401,
            corpo: {
              type: 'urn:sgh:problema:reautenticacao-necessaria',
              title: 'Confirme a senha para continuar',
              status: 401,
            },
          }
        : { status: 200, corpo: {} },
    );
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    await w.get('[data-testid="bloquear-usuario"]').trigger('click');
    await flushPromises();
    await digitarSenhaEConfirmar('errada');
    expect(dialogo()).not.toBeNull();
    expect(document.querySelector('[data-testid="reautenticar-erro"]')?.textContent).toContain(
      'A senha não confere',
    );
    expect(campoSenha()!.value).toBe('');
    expect(w.find('[data-testid="ficha-aviso"]').exists()).toBe(false);
    // De novo, no mesmo diálogo: grava e fecha.
    await digitarSenhaEConfirmar('certa');
    await new Promise((r) => setTimeout(r, 400));
    await flushPromises();
    expect(pedidos.filter((p) => p.metodo === 'POST').map((p) => p.corpo)).toEqual([
      { bloquear: true, senha: 'errada' },
      { bloquear: true, senha: 'certa' },
    ]);
    expect(dialogo()).toBeNull();
    expect(w.get('[data-testid="ficha-aviso"]').text()).toContain('bloqueado');
  });

  it('salvar o nome grava o valor e a versão de quando o diálogo abriu, mesmo se a ficha recarregar', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.usuario.editar']);
    let atual = ficha();
    const pedidos = servidor(() => atual);
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    await w.get('[data-testid="ficha-nome"] input').setValue('Nome Digitado Sintetico');
    await w.get('[data-testid="salvar-nome"]').trigger('click');
    await flushPromises();
    expect(dialogo()).not.toBeNull();
    // Outro administrador mudou o usuário e a ficha recarregou com o diálogo aberto.
    atual = {
      ...atual,
      usuario: { ...atual.usuario, nome: 'Nome do Servidor', versao: '{"NOMEC":"y"}' },
    } as FichaUsuario;
    await cliente.invalidateQueries({ queryKey: ['adm', 'ficha', 'SINT.ALVO'] });
    await flushPromises();
    await digitarSenhaEConfirmar('senha-sintetica');
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.corpo).toMatchObject({
      entrada: { nomeCompleto: 'Nome Digitado Sintetico', versao: '{"NOMEC":"x"}' },
    });
  });

  it('W1-01: trocar o CPF exige justificativa, pede a senha e grava CPF, motivo e versão', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.usuario.editar']);
    const pedidos = servidor(() => ficha());
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    const botao = () => w.get('[data-testid="trocar-cpf"]');
    await w.get('[data-testid="ficha-cpf-novo"] input').setValue('52998224725');
    expect(botao().attributes('disabled')).toBeDefined();
    await w.get('[data-testid="ficha-cpf-justificativa"] input').setValue('CPF digitado errado');
    expect(botao().attributes('disabled')).toBeUndefined();
    await botao().trigger('click');
    await flushPromises();
    expect(dialogo()).not.toBeNull();
    await digitarSenhaEConfirmar('senha-sintetica');
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.corpo).toMatchObject({
      entrada: { cpf: '52998224725', justificativa: 'CPF digitado errado', versao: '{"NOMEC":"x"}' },
    });
    expect((w.get('[data-testid="ficha-cpf-novo"] input').element as HTMLInputElement).value).toBe('');
  });
  it('trocar de usuário na mesma tela: o CPF volta mascarado e a aba volta ao início', async () => {
    comPermissoes(['acesso.usuario.ler']);
    servidor(ficha({ cpf: '00000000191' }));
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    await w.get('[data-testid="ficha-cpf-revelar"]').trigger('click');
    expect(w.get('[data-testid="ficha-cpf"]').text()).toContain('000.000.001-91');
    await w.setProps({ login: 'SINT.OUTRO' } as never);
    await flushPromises();
    expect(w.get('[data-testid="ficha-cpf"]').text()).toContain('***.***.001-91');
    await w.get('[data-testid="ficha-aba-flags"]').trigger('click');
    await w.setProps({ login: 'SINT.ALVO' } as never);
    await flushPromises();
    expect(w.get('[data-testid="ficha-aba-dados"]').attributes('aria-selected')).toBe('true');
  });

  it('permissões: a marca "a confirmar" em cada uma, o motivo uma vez só e a contagem "ligadas/total"', async () => {
    comPermissoes(['acesso.usuario.ler']);
    servidor(ficha({ desligar: ['acesso.alterarFlagsUsuario'] }));
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    expect(w.get('[data-testid="ficha-aba-flags"]').text()).toContain('1/3');
    expect(w.get('[data-testid="ficha-aba-flags"]').text()).toContain('1 ligadas de 3');
    await w.get('[data-testid="ficha-aba-flags"]').trigger('click');
    expect(w.get('[data-testid="ficha-flags"]').text().split('a confirmar').length - 1).toBe(3);
    expect(w.text()).not.toContain('Só consulta: o efeito');
    expect(w.get('[data-testid="ficha-flags-motivo"]').text()).toContain('Motivo fixo das permissões.');
  });

  it('W1-01: identidade única lista as contas sem CPF e os logins com o mesmo CPF, com link para a ficha', async () => {
    const pedidos = simular((p) =>
      p.url.endsWith('/usuarios-cpf')
        ? {
            status: 200,
            corpo: {
              semCpf: [{ login: 'ANA', nome: 'Ana', grupo: 'MEDICOS', ativo: true, bloqueado: false }],
              dispensadasSemCpf: 2,
              gruposDispensados: ['PAINEIS'],
              duplicados: [
                {
                  chave: '1',
                  contas: [
                    { login: 'B1', nome: null, grupo: 'X', ativo: true, bloqueado: false },
                    { login: 'B2', nome: 'Beto', grupo: 'X', ativo: true, bloqueado: true },
                  ],
                },
              ],
              destino: 'banco',
            },
          }
        : undefined,
    );
    const w = await montar(CpfUsuarios);
    await flushPromises();
    expect(pedidos.map((p) => p.metodo)).toEqual(['GET']);
    expect(w.get('[data-testid="sem-cpf-ANA"]').text()).toContain('MEDICOS');
    expect(w.get('[data-testid="usuarios-cpf-dispensadas"]').text()).toContain('2');
    const g = w.get('[data-testid="cpf-repetido-1"]').text();
    expect(g).toContain('Pessoa 1');
    expect(g).toContain('B1');
    expect(g).toContain('Bloqueado');
  });

  it('W1-01: identidade única sem pendência mostra as frases de "tudo certo"', async () => {
    simular((p) =>
      p.url.endsWith('/usuarios-cpf')
        ? {
            status: 200,
            corpo: {
              semCpf: [],
              dispensadasSemCpf: 0,
              gruposDispensados: ['PAINEIS'],
              duplicados: [],
              destino: 'memoria',
            },
          }
        : undefined,
    );
    const w = await montar(CpfUsuarios);
    await flushPromises();
    expect(w.text()).toContain('Todas as contas pessoais ativas têm CPF.');
    expect(w.text()).toContain('Nenhum CPF aparece em mais de um login.');
    expect(w.find('[data-testid="usuarios-cpf-dispensadas"]').exists()).toBe(false);
  });
});

describe('usuários: PIN da troca rápida na ficha (W1-01 parte 11b3c)', () => {
  const PIN = {
    ligada: true,
    digitosPin: 6,
    definido: true,
    bloqueado: true,
    criadoEm: '2026-11-19T10:00:00Z' as string | null,
  };
  function servidorPin(post: (p: Pedido) => { status: number; corpo: unknown }) {
    let situacao: typeof PIN = PIN;
    const pedidos = simular((p) => {
      if (p.url.endsWith('/usuarios-opcoes')) return { status: 200, corpo: OPCOES };
      if (/\/usuarios\/SINT\.[A-Z]+$/.test(p.url) && p.metodo === 'GET')
        return { status: 200, corpo: ficha() };
      if (p.url === '/api/acesso/gestao/usuarios/SINT.ALVO/pin' && p.metodo === 'GET')
        return { status: 200, corpo: situacao };
      if (p.metodo === 'POST') {
        const r = post(p);
        if (r.status === 200) situacao = { ...PIN, definido: false, bloqueado: false, criadoEm: null };
        return r;
      }
      return undefined;
    });
    return pedidos;
  }

  it('quem gere acessos vê a situação (nunca o PIN) e retira com motivo e senha; recusa do servidor vai ao aviso', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.perfil.gerir']);
    let n = 0;
    const pedidos = servidorPin(() =>
      ++n === 1
        ? {
            status: 409,
            corpo: {
              type: 'urn:sgh:problema:recusa-de-negocio',
              title: 'Operação recusada',
              status: 409,
              detail: 'O usuário não tem PIN definido.',
            },
          }
        : { status: 200, corpo: { anterior: 'bloqueado', situacao: {} } },
    );
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    await w.get('[data-testid="ficha-aba-sessoes"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="ficha-pin-situacao"]').text()).toContain('PIN definido desde');
    expect(w.find('[data-testid="ficha-pin-bloqueado"]').exists()).toBe(true);
    await w.get('[data-testid="ficha-pin-retirar"]').trigger('click');
    await flushPromises();
    expect(dialogo()).not.toBeNull();
    const motivo = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[data-testid="dialogo-motivo"] input, [data-testid="dialogo-motivo"] textarea, input[data-testid="dialogo-motivo"], textarea[data-testid="dialogo-motivo"]',
    )!;
    motivo.value = 'crachá extraviado na troca de plantão';
    motivo.dispatchEvent(new Event('input'));
    await digitarSenhaEConfirmar('senha-sintetica');
    const post = pedidos.filter((p) => p.metodo === 'POST').at(-1);
    expect(post?.url).toBe('/api/acesso/gestao/usuarios/SINT.ALVO/pin/retirar');
    expect(post?.corpo).toEqual({
      motivo: 'crachá extraviado na troca de plantão',
      senha: 'senha-sintetica',
    });
    await flushPromises();
    expect(document.body.textContent).toContain('O usuário não tem PIN definido.');
    // De novo: retirado, a situação recarrega.
    await w.get('[data-testid="ficha-pin-retirar"]').trigger('click');
    await flushPromises();
    const m2 = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[data-testid="dialogo-motivo"] input, [data-testid="dialogo-motivo"] textarea, input[data-testid="dialogo-motivo"], textarea[data-testid="dialogo-motivo"]',
    )!;
    m2.value = 'crachá extraviado na troca de plantão';
    m2.dispatchEvent(new Event('input'));
    await digitarSenhaEConfirmar('senha-sintetica');
    await flushPromises();
    expect(document.body.textContent).toContain('PIN de SINT.ALVO retirado.');
    expect(w.get('[data-testid="ficha-pin-situacao"]').text()).toContain('Sem PIN definido.');
    expect(w.find('[data-testid="ficha-pin-retirar"]').exists()).toBe(false);
    expect(JSON.stringify(pedidos)).not.toMatch(/\bpin"\s*:\s*"\d/);
  });

  it('sem acesso.perfil.gerir: o cartão do PIN não aparece nem é lido', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.usuario.editar']);
    const pedidos = servidorPin(() => ({ status: 200, corpo: {} }));
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    await w.get('[data-testid="ficha-aba-sessoes"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="ficha-pin"]').exists()).toBe(false);
    expect(pedidos.some((p) => p.url.endsWith('/pin'))).toBe(false);
  });
});

describe('usuários: atalho "Profissional vinculado" (X-01)', () => {
  const destino = (w: Awaited<ReturnType<typeof montar>>, testid: string) =>
    (w.getComponent(`[data-testid="${testid}"]`) as unknown as { props: (k: string) => unknown }).props('to');

  it('com vínculo: mostra o nome e leva à ficha do profissional', async () => {
    comPermissoes(['acesso.usuario.ler', 'cadastro.profissional.ler']);
    servidor(ficha({ profissional: { id: 3, nome: 'ANA MÉDICA SINTETICO' } }));
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    const bloco = w.get('[data-testid="ficha-profissional"]');
    expect(bloco.text()).toContain('Profissional vinculado');
    expect(bloco.text()).toContain('ANA MÉDICA SINTETICO');
    expect(destino(w, 'ficha-profissional-link')).toBe('/cadastros/profissionais/3');
    expect(w.find('[data-testid="ficha-profissional-vincular"]').exists()).toBe(false);
  });

  it('com vínculo e sem leitura do cadastro de profissionais: o nome sem link', async () => {
    comPermissoes(['acesso.usuario.ler']);
    servidor(ficha({ profissional: { id: 3, nome: 'ANA MÉDICA SINTETICO' } }));
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    expect(w.get('[data-testid="ficha-profissional"]').text()).toContain('ANA MÉDICA SINTETICO');
    expect(w.find('[data-testid="ficha-profissional-link"]').exists()).toBe(false);
  });

  it('sem vínculo e com acesso.perfil.gerir: diz que não há e leva à aba Login do sistema', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.perfil.gerir', 'cadastro.profissional.ler']);
    servidor(ficha());
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    expect(w.get('[data-testid="ficha-profissional"]').text()).toContain(
      'Nenhum profissional vinculado a este login.',
    );
    expect(destino(w, 'ficha-profissional-vincular')).toEqual({
      path: '/cadastros/profissionais',
      query: { aba: 'login', login: 'SINT.ALVO' },
    });
    expect(w.find('[data-testid="ficha-profissional-link"]').exists()).toBe(false);
  });

  it('sem vínculo e sem acesso.perfil.gerir: só o aviso, sem o atalho', async () => {
    comPermissoes(['acesso.usuario.ler', 'cadastro.profissional.ler']);
    servidor(ficha());
    const w = await montar(FichaUsuarioTela, { login: 'SINT.ALVO' });
    await flushPromises();
    expect(w.get('[data-testid="ficha-profissional"]').text()).toContain(
      'Nenhum profissional vinculado a este login.',
    );
    expect(w.find('[data-testid="ficha-profissional-vincular"]').exists()).toBe(false);
  });
});
