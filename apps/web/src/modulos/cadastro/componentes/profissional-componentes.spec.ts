// @vitest-environment jsdom
// Revisão da D-PROF-39 (testes de componente da ficha do profissional; dados SINTÉTICOS, fetch simulado):
// - o diálogo de gravação (motivo curto, senha que não confere) é o SanteDialogoGravacao, testado em @sgh/ui (X-01);
// - VinculoLoginProfissional: só quem gere os acessos liga o login (os outros veem só a consulta); a condição do combo
//   (papel Operador de sistema ativo) aparece; a lista de logins mostra o carregamento; toda mudança pede a
//   justificativa (também a primeira ligação);
// - login único (pergunta do dono, 18/11/2026: "por que tem 3 logins?"): um seletor de login só; ligar usa a ocupação
//   padrão (a de médico ativa mais recente); trocar a ocupação manda o MESMO login ao outro registro; o dado herdado
//   com dois logins aparece todo, com o aviso e o Desligar de cada um, sem Ligar nem Trocar;
// - EdicaoProfissional: encerrar o registro só aparece para quem pode inativar (as horas da lotação "1,5" recusadas
//   estão em profissional-tela.spec e no E2E).
import type { FichaProfissional } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca, SanteSelecao } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { definirSessaoDaTela } from '../../../casca/sessao/pode.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import EdicaoProfissional from './EdicaoProfissional.vue';
import VinculoLoginProfissional from './VinculoLoginProfissional.vue';

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
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const plugins = () =>
  [
    criarI18n(mensagensWeb as unknown as Record<string, unknown>),
    ui,
    [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
  ] as never;

afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
  document.body.innerHTML = '';
});

const FICHA: FichaProfissional = {
  id: 4,
  nome: 'BRUNO DOIS CONSELHOS SINTETICO',
  categoria: 'medico',
  registros: [
    {
      id: 11,
      conselho: 'CRM',
      sigla: null,
      numero: 22222,
      uf: 'MG',
      cbo: '225250',
      cboDescricao: 'MÉDICO GINECOLOGISTA',
      categoria: 'medico',
      ativo: true,
      siglaId: null,
      versao: '{"ATIVO":"T","CONS_PROF":"CRM","ID_TBSIGLACONSPROF":null}',
    },
  ],
  situacaoLegado: { codigo: 'O', aConfirmar: true },
  ativo: true,
  nomeSocial: null,
  especialidades: [],
  lotacao: [],
  credenciamentos: [],
  logins: [],
  loginsRegistro: [],
} as unknown as FichaProfissional;

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

describe('VinculoLoginProfissional', () => {
  const montar = (ficha: FichaProfissional) =>
    mount(VinculoLoginProfissional as never, {
      props: { ficha } as never,
      global: { plugins: plugins() },
      attachTo: document.body,
    });

  it('sem a gestão de acessos: só consulta (sem combo nem botões) e nenhuma leitura dos logins', async () => {
    const buscar = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', buscar);
    definirSessaoDaTela({
      permissoes: ['cadastro.profissional.ler', 'cadastro.profissional.editar'],
    } as never);
    const w = montar(FICHA);
    await flushPromises();
    expect(w.find('[data-testid="login-so-consulta"]').exists()).toBe(true);
    expect(w.find('[data-testid="login-gravar"]').exists()).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
    w.unmount();
  });

  it('com a gestão de acessos: a condição do combo, o carregamento e a justificativa já na primeira ligação', async () => {
    let soltar: (r: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (soltar = r))),
    );
    definirSessaoDaTela({ permissoes: ['cadastro.profissional.ler', 'acesso.perfil.gerir'] } as never);
    const w = montar(FICHA);
    await flushPromises();
    expect(w.find('[data-testid="login-condicao"]').text()).toMatch(/papel Operador de sistema ativo/);
    expect(w.find('[data-testid="logins-carregando"]').exists()).toBe(true);
    soltar(json([{ login: 'SINT.LIVRE1', nome: 'LIVRE SINTETICO', profissional: null }]));
    await flushPromises();
    expect(w.find('[data-testid="logins-carregando"]').exists()).toBe(false);
    expect(w.find('[data-testid="login-gravar"]').exists()).toBe(true);
    w.unmount();
  });

  it('com a gravação recusada pelo executor (operacoes da ficha): só consulta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([])),
    );
    definirSessaoDaTela({ permissoes: ['cadastro.profissional.ler', 'acesso.perfil.gerir'] } as never);
    const w = montar({
      ...FICHA,
      operacoes: [{ operacao: 'cadastro.vincularLoginProfissional', ligada: false }],
    } as FichaProfissional);
    await flushPromises();
    expect(w.find('[data-testid="login-so-consulta"]').exists()).toBe(true);
    expect(w.find('[data-testid="login-gravar"]').exists()).toBe(false);
    w.unmount();
  });

  // O médico com o mesmo CRM em três ocupações (o caso do dono), a de 225170 inativa.
  const ocup = (id: number, cbo: string, descricao: string, ativo = true) => ({
    ...FICHA.registros[0]!,
    id,
    numero: 66666,
    cbo,
    cboDescricao: descricao,
    ativo,
  });
  const TRES = {
    ...FICHA,
    id: 7,
    nome: 'EDUARDO TRÊS OCUPAÇÕES SINTETICO',
    registros: [
      ocup(15, '225125', 'MÉDICO CLÍNICO'),
      ocup(16, '225250', 'MÉDICO GINECOLOGISTA'),
      ocup(17, '225170', 'MÉDICO GENERALISTA', false),
    ],
  } as FichaProfissional;
  const LOGINS = [
    { login: 'SINT.PROF6', nome: 'EDUARDO SINTETICO', profissional: 7 },
    { login: 'SINT.LIVRE1', nome: 'LIVRE SINTETICO', profissional: null },
  ];
  async function escolherCombo(w: VueWrapper, testid: string, valor: unknown): Promise<void> {
    const c = w.findAllComponents(SanteSelecao).find((x) => x.attributes('data-testid') === testid);
    if (!c) throw new Error(`combo ${testid} não achado`);
    c.vm.$emit('update:modelValue', valor);
    await flushPromises();
  }
  async function confirmar(motivo: string): Promise<void> {
    const m = document.querySelector<HTMLTextAreaElement>('[data-testid="dialogo-motivo"]')!;
    m.value = motivo;
    m.dispatchEvent(new Event('input'));
    const s = document.querySelector<HTMLInputElement>('[data-testid="dialogo-senha"]')!;
    s.value = 'Sintetico#2026';
    s.dispatchEvent(new Event('input'));
    await flushPromises();
    document
      .querySelector<HTMLFormElement>('[data-testid="form-gravacao"]')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
  }
  /** fetch simulado: a lista de logins e o PUT do vínculo (guarda o corpo). */
  function servidor() {
    const corpos: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/login') && init?.method === 'PUT') {
          corpos.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return json({ registro: 16, semRegistroAtivo: false });
        }
        return json(LOGINS);
      }),
    );
    return corpos;
  }

  it('sem login: um seletor de login só e a ocupação padrão é a de médico ativa mais recente', async () => {
    const corpos = servidor();
    definirSessaoDaTela({ permissoes: ['cadastro.profissional.ler', 'acesso.perfil.gerir'] } as never);
    const w = montar({ ...TRES, loginsRegistro: [] } as FichaProfissional);
    await flushPromises();
    expect(w.findAll('[data-testid="login-escolha"]')).toHaveLength(1);
    expect(w.find('[data-testid="login-nenhum"]').exists()).toBe(true);
    const ocupacao = w.find('[data-testid="login-ocupacao-escolha"]');
    expect(ocupacao.attributes('data-valor')).toBe('16');
    await escolherCombo(w, 'login-escolha', 'SINT.LIVRE1');
    await w.find('[data-testid="login-gravar"] button, button[data-testid="login-gravar"]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toMatch(
      /SINT\.LIVRE1 passa a ser o deste profissional, na ocupação 225250/,
    );
    await confirmar('Médico admitido no corpo clínico');
    expect(corpos).toEqual([expect.objectContaining({ registro: 16, login: 'SINT.LIVRE1', versao: '' })]);
    w.unmount();
  });

  it('X-01: o login do atalho da ficha do usuário vem pré-escolhido no combo (só se for uma das opções)', async () => {
    servidor();
    definirSessaoDaTela({ permissoes: ['cadastro.profissional.ler', 'acesso.perfil.gerir'] } as never);
    const com = (loginSugerido: string) =>
      mount(VinculoLoginProfissional as never, {
        props: { ficha: { ...TRES, loginsRegistro: [] }, loginSugerido } as never,
        global: { plugins: plugins() },
        attachTo: document.body,
      });
    const w = com('SINT.LIVRE1');
    await flushPromises();
    expect(w.get('[data-testid="login-escolha"]').attributes('data-valor')).toBe('SINT.LIVRE1');
    w.unmount();
    // Um login fora das opções (de outro profissional ou inexistente) não é escolhido.
    const fora = com('SINT.OUTRO');
    await flushPromises();
    expect(fora.get('[data-testid="login-escolha"]').attributes('data-valor') ?? '').toBe('');
    fora.unmount();
  });

  it('com um login: mostra o login e a ocupação; trocar a ocupação manda o MESMO login ao outro registro', async () => {
    const corpos = servidor();
    definirSessaoDaTela({ permissoes: ['cadastro.profissional.ler', 'acesso.perfil.gerir'] } as never);
    const w = montar({
      ...TRES,
      loginsRegistro: [{ registro: 15, login: 'SINT.PROF6' }],
    } as FichaProfissional);
    await flushPromises();
    expect(w.findAll('[data-testid="login-escolha"]')).toHaveLength(1);
    expect(w.findAll('[data-testid="login-atual"]').map((x) => x.text())).toEqual(['SINT.PROF6']);
    expect(w.find('[data-testid="login-ocupacao-atual"]').text()).toMatch(
      /225125 · MÉDICO CLÍNICO — CRM 66666\/MG/,
    );
    expect(w.find('[data-testid="login-gravar"]').text()).toMatch(/Trocar o login/);
    // As outras ocupações ativas (a 225170 está inativa e a 225125 é a atual): só a 225250.
    const combo = w
      .findAllComponents(SanteSelecao)
      .find((x) => x.attributes('data-testid') === 'login-ocupacao-escolha')!;
    expect(
      ((combo.props() as Record<string, unknown>)['opcoes'] as { valor: string }[]).map((o) => o.valor),
    ).toEqual(['', '16']);
    await escolherCombo(w, 'login-ocupacao-escolha', '16');
    await w
      .find('[data-testid="login-trocar-ocupacao"] button, button[data-testid="login-trocar-ocupacao"]')
      .trigger('click');
    await flushPromises();
    expect(document.body.textContent).toMatch(
      /SINT\.PROF6 continua o deste profissional e passa a usar a ocupação 225250/,
    );
    await confirmar('Passa a atender como ginecologista');
    expect(corpos).toEqual([
      expect.objectContaining({
        registro: 16,
        login: 'SINT.PROF6',
        versao: '',
        justificativa: 'Passa a atender como ginecologista',
      }),
    ]);
    w.unmount();
  });

  it('revisão: com uma ocupação só, ligar não mostra o combo de ocupação (ela aparece escrita, entra direto e o diálogo a cita)', async () => {
    const corpos = servidor();
    definirSessaoDaTela({ permissoes: ['cadastro.profissional.ler', 'acesso.perfil.gerir'] } as never);
    const w = montar({ ...FICHA, loginsRegistro: [] } as FichaProfissional);
    await flushPromises();
    expect(w.findAll('[data-testid="login-escolha"]')).toHaveLength(1);
    expect(w.find('[data-testid="login-ocupacao-escolha"]').exists()).toBe(false);
    // A ocupação única aparece escrita (não some da tela).
    expect(w.find('[data-testid="login-ocupacao-unica"]').text()).toMatch(/225250/);
    await escolherCombo(w, 'login-escolha', 'SINT.LIVRE1');
    await w.find('[data-testid="login-gravar"] button, button[data-testid="login-gravar"]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toMatch(
      /SINT\.LIVRE1 passa a ser o deste profissional, na ocupação 225250/,
    );
    await confirmar('Médico admitido no corpo clínico');
    expect(corpos).toEqual([expect.objectContaining({ registro: 11, login: 'SINT.LIVRE1', versao: '' })]);
    w.unmount();
  });

  it('revisão: dois logins herdados no MESMO registro aparecem os dois; desligar o segundo manda a versão dele', async () => {
    const corpos = servidor();
    definirSessaoDaTela({ permissoes: ['cadastro.profissional.ler', 'acesso.perfil.gerir'] } as never);
    const w = montar({
      ...TRES,
      loginsRegistro: [
        { registro: 15, login: 'SINT.PROF7' },
        { registro: 15, login: 'SINT.PROF8' },
      ],
    } as FichaProfissional);
    await flushPromises();
    expect(w.find('[data-testid="login-conflito"]').exists()).toBe(true);
    expect(w.findAll('[data-testid="login-atual"]').map((x) => x.text())).toEqual([
      'SINT.PROF7',
      'SINT.PROF8',
    ]);
    expect(w.find('[data-testid="login-escolha"]').exists()).toBe(false);
    await w
      .findAll('[data-testid="login-desligar"] button, button[data-testid="login-desligar"]')[1]!
      .trigger('click');
    await flushPromises();
    await confirmar('Login extra herdado desligado');
    expect(corpos).toEqual([expect.objectContaining({ registro: 15, login: null, versao: 'SINT.PROF8' })]);
    w.unmount();
  });

  it('dado herdado com dois logins: aparecem os dois, com o aviso e o Desligar de cada um; sem Ligar nem Trocar', async () => {
    servidor();
    definirSessaoDaTela({ permissoes: ['cadastro.profissional.ler', 'acesso.perfil.gerir'] } as never);
    const w = montar({
      ...TRES,
      loginsRegistro: [
        { registro: 15, login: 'SINT.PROF7' },
        { registro: 16, login: 'SINT.PROF8' },
      ],
    } as FichaProfissional);
    await flushPromises();
    expect(w.find('[data-testid="login-conflito"]').text()).toMatch(/2 logins ligados \(dado herdado\)/);
    expect(w.findAll('[data-testid="login-atual"]').map((x) => x.text())).toEqual([
      'SINT.PROF7',
      'SINT.PROF8',
    ]);
    expect(w.findAll('[data-testid="login-desligar"]')).toHaveLength(2);
    expect(w.find('[data-testid="login-escolha"]').exists()).toBe(false);
    expect(w.find('[data-testid="login-trocar-ocupacao"]').exists()).toBe(false);
    w.unmount();
  });
});

describe('EdicaoProfissional', () => {
  const OPCOES = {
    conselhos: [{ valor: 'CRM', rotulo: 'CRM' }],
    siglas: [],
    cbos: [],
    especialidades: [],
    unidades: [{ valor: 1, rotulo: 'UNIDADE SINTETICO' }],
    convenios: [],
    ufs: ['MG'],
  };
  const montar = (secao: string) =>
    mount(EdicaoProfissional as never, {
      props: { ficha: FICHA, secao } as never,
      global: { plugins: plugins() },
      attachTo: document.body,
    });

  it('encerrar o registro só para quem pode inativar; sem a opção, o botão não aparece', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(OPCOES)),
    );
    definirSessaoDaTela({ permissoes: ['cadastro.profissional.editar'] } as never);
    const so = montar('registros');
    await flushPromises();
    expect(so.find('[data-testid="inativar-registro"]').exists()).toBe(false);
    so.unmount();
    definirSessaoDaTela({
      permissoes: ['cadastro.profissional.editar', 'cadastro.profissional.excluir'],
    } as never);
    const com = montar('registros');
    await flushPromises();
    expect(com.find('[data-testid="inativar-registro"]').exists()).toBe(true);
    com.unmount();
  });
});
