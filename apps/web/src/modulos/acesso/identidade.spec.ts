// @vitest-environment jsdom
// Telas do M59-F2 (senhas, segundo fator e identidade): as regras de tela (destino depois do login, texto da recusa
// do segundo fator, chave do URI, fim da adesão), as rotas com as permissões do catálogo, a segurança da conta
// (cadastro em dois passos, recusa do código, remoção só quando opcional), a política (lista, onda 1, voltar a
// opcional, sem edição para quem só lê) e a vista "Senhas e segundo fator" da tela de usuários (resumo em faixa,
// retirada só depois da contingência, revogação). Dados SINTÉTICOS; o fetch é simulado.
import {
  CATALOGO_DECLARADO,
  type MeuSegundoFator,
  PERFIS_COMPLEMENTARES,
  type PaginaUsuariosIdentidade,
  type Politica2fa,
  type ResumoIdentidade,
  type Sessao,
  urnProblema,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { criarRoteador } from '../../roteador.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import IdentidadeUsuarios from '../administracao/componentes/IdentidadeUsuarios.vue';
import { codigoDoErro } from './api-identidade.js';
import {
  chaveDoUri,
  codigoValido,
  dataBr,
  destinoDepoisDoLogin,
  fimDaAdesao,
  perfisDoCatalogo,
  textoRecusaSegundoFator,
} from './identidade-tela.js';
import PoliticaSegundoFatorTela from './telas/PoliticaSegundoFatorTela.vue';
import SegurancaTela from './telas/SegurancaTela.vue';

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
type Responder = (p: Pedido) => { status: number; corpo: unknown } | undefined;

function simular(responder: Responder): Pedido[] {
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
async function montar(tela: Component, rota = '/') {
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:caminho(.*)*', component: { template: '<div />' } }],
  });
  await roteador.push(rota);
  return mount(tela as never, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        roteador,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
}

function comPermissoes(permissoes: string[]): void {
  definirSessaoDaTela({ permissoes } as unknown as Sessao);
}

const problema = (status: number, codigo?: string) => ({
  status,
  corpo: {
    type: 'recusa-de-negocio',
    title: 'Não foi possível concluir',
    status,
    ...(codigo ? { codigo } : {}),
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  definirSessaoDaTela(null);
});

describe('regras de tela', () => {
  it('destino depois do login: troca de senha, depois a adesão, senão o início', () => {
    const f = {
      cadastrado: false,
      disponivel: true,
      exigencia: 'adesao' as const,
      prazoAdesaoAte: '2026-12-14',
    };
    expect(destinoDepoisDoLogin({ trocaSenha: 'senha-expirada', segundoFator: f })).toBe('/senha');
    expect(destinoDepoisDoLogin({ trocaSenha: null, segundoFator: f })).toBe(
      '/preferencias/seguranca?adesao=1',
    );
    expect(destinoDepoisDoLogin({ trocaSenha: null, segundoFator: { ...f, cadastrado: true } })).toBe(
      '/inicio',
    );
    expect(destinoDepoisDoLogin({ trocaSenha: null, segundoFator: { ...f, disponivel: false } })).toBe(
      '/inicio',
    );
    expect(destinoDepoisDoLogin({ trocaSenha: null, segundoFator: { ...f, exigencia: 'opcional' } })).toBe(
      '/inicio',
    );
    expect(destinoDepoisDoLogin({ trocaSenha: null })).toBe('/inicio');
  });

  it('recusa do segundo fator no login, chave do URI, código, fim da adesão e perfis', () => {
    expect(textoRecusaSegundoFator('segundo-fator-codigo')).toBe('entrar.segundoFatorPedido');
    expect(textoRecusaSegundoFator('segundo-fator-invalido')).toBe('entrar.segundoFatorInvalido');
    expect(textoRecusaSegundoFator('segundo-fator-cadastro')).toBe('entrar.segundoFatorCadastro');
    expect(textoRecusaSegundoFator(null)).toBeNull();
    expect(textoRecusaSegundoFator('outro')).toBeNull();
    expect(chaveDoUri('otpauth://totp/Sante:SINT.A?secret=ABCDEFGHIJ234567&issuer=Sante')).toBe(
      'ABCD EFGH IJ23 4567',
    );
    expect(chaveDoUri('não é URI')).toBe('');
    expect(codigoValido('123 456')).toBe(true);
    expect(codigoValido('12345')).toBe(false);
    expect(codigoValido('12a456')).toBe(false);
    expect(fimDaAdesao('2026-12-01', 14)).toBe('2026-12-14');
    expect(fimDaAdesao('2026-12-31', 1)).toBe('2026-12-31');
    expect(fimDaAdesao('2026-12-31', 0)).toBe('2026-12-31');
    expect(fimDaAdesao('2026-12-25', 10)).toBe('2027-01-03');
    expect(dataBr('2026-12-01T10:00:00Z')).toBe('01/12/2026');
    expect(dataBr(null)).toBe('');
    const perfis = perfisDoCatalogo(CATALOGO_DECLARADO, PERFIS_COMPLEMENTARES);
    expect(perfis).toContain('gestor-acessos');
    expect(perfis).toContain('auditor');
    expect(new Set(perfis).size).toBe(perfis.length);
    expect(perfisDoCatalogo([{ perfis: ['b', 'a'] }, {}], ['a'])).toEqual(['a', 'b']);
    expect(codigoDoErro({ problema: { codigo: 'x' } })).toBe('x');
    expect(codigoDoErro(new Error('y'))).toBeNull();
  });
});

describe('rotas', () => {
  const sessao = (permissoes: string[]) => async () => ({
    usuario: { id: 's', nome: 'S' },
    rede: null,
    estabelecimentos: [],
    estabelecimentoAtivo: null,
    permissoes,
    sintetica: true,
    bloqueioInatividadeSegundos: 0,
  });
  it('segurança da conta com acesso.segundofator.gerir; política com acesso.politica2fa.ler', async () => {
    const sem = criarRoteador(sessao(['acesso.inicio.ler']), {
      historico: createMemoryHistory(),
      desenvolvimento: true,
    });
    await sem.push('/preferencias/seguranca');
    expect(sem.currentRoute.value.name).toBe('sem-permissao');
    await sem.push('/administracao/acesso/2fa');
    expect(sem.currentRoute.value.name).toBe('sem-permissao');
    const com = criarRoteador(
      sessao(['acesso.inicio.ler', 'acesso.segundofator.gerir', 'acesso.politica2fa.ler']),
      { historico: createMemoryHistory(), desenvolvimento: true },
    );
    await com.push('/preferencias/segundo-fator');
    expect(com.currentRoute.value.name).toBe('seguranca');
    await com.push('/administracao/acesso/2fa');
    expect(com.currentRoute.value.name).toBe('acesso.politica2fa');
  });
});

const meu = (sobre: Partial<MeuSegundoFator> = {}): MeuSegundoFator => ({
  situacao: 'ausente',
  exigencia: 'adesao',
  prazoAdesaoAte: '2026-12-14',
  confirmadoEm: null,
  disponivel: true,
  ...sobre,
});

describe('segurança da conta', () => {
  it('cadastro em dois passos: QR e chave, código recusado, código certo ativa', async () => {
    let atual = meu();
    let tentativas = 0;
    const pedidos = simular((p) => {
      if (p.url === '/api/sessao/segundo-fator' && p.metodo === 'GET') return { status: 200, corpo: atual };
      if (p.url === '/api/sessao/segundo-fator' && p.metodo === 'POST') {
        const c = (p.corpo as { codigo?: string }).codigo;
        if (!c)
          return {
            status: 200,
            corpo: {
              segredo: 'ABCDEFGHIJ234567',
              uri: 'otpauth://totp/Sante:SINT.A?secret=ABCDEFGHIJ234567&issuer=Sante',
              expiraEm: '2026-12-01T10:10:00.000Z',
            },
          };
        tentativas++;
        if (tentativas === 1) return problema(422, 'codigo-invalido');
        atual = meu({ situacao: 'ativo', confirmadoEm: '2026-12-01T10:05:00.000Z' });
        return { status: 200, corpo: { confirmado: true } };
      }
      return undefined;
    });
    const w = await montar(SegurancaTela, '/preferencias/seguranca?adesao=1');
    await flushPromises();
    expect(w.get('[data-testid="seguranca-adesao"]').text()).toContain('14/12/2026');
    expect(w.get('[data-testid="seguranca-exigencia"]').text()).toBe('Obrigatório (prazo de adesão)');
    await w.get('[data-testid="seguranca-cadastrar"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="seguranca-qr"]').exists()).toBe(true);
    expect(w.get('[data-testid="seguranca-chave"]').text()).toBe('ABCD EFGH IJ23 4567');
    await w.get('[data-testid="seguranca-codigo"]').setValue('12');
    await w.get('[data-testid="seguranca-cadastro"]').trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="seguranca-recusa"]').text()).toBe('Informe os 6 dígitos do aplicativo.');
    expect(pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);
    await w.get('[data-testid="seguranca-codigo"]').setValue('111 111');
    await w.get('[data-testid="seguranca-cadastro"]').trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="seguranca-recusa"]').text()).toContain('não conferiu');
    await w.get('[data-testid="seguranca-codigo"]').setValue('222222');
    await w.get('[data-testid="seguranca-cadastro"]').trigger('submit');
    await flushPromises();
    expect(pedidos.filter((p) => p.metodo === 'POST').map((p) => p.corpo)).toEqual([
      {},
      { codigo: '111111' },
      { codigo: '222222' },
    ]);
    expect(w.get('[data-testid="seguranca-aviso"]').text()).toContain('Segundo fator ativo');
    expect(w.find('[data-testid="seguranca-qr"]').exists()).toBe(false);
    expect(w.get('[data-testid="seguranca-situacao-fator"]').text()).toContain('01/12/2026');
    // Obrigatório para o perfil: não remove, e diz a quem procurar.
    expect(w.find('[data-testid="seguranca-remover"]').exists()).toBe(false);
    expect(w.get('[data-testid="seguranca-nao-remove"]').text()).toContain('gestor de acessos');
    expect(w.find('[data-testid="seguranca-ir-inicio"]').exists()).toBe(true);
  });

  it('fora da janela de reautenticação: iniciar pede a senha e tenta de novo com ela', async () => {
    const pedidos = simular((p) => {
      if (p.metodo === 'GET') return { status: 200, corpo: meu() };
      if (p.metodo === 'POST') {
        if (!(p.corpo as { senha?: string }).senha)
          return {
            status: 401,
            corpo: { type: urnProblema('reautenticacao-necessaria'), title: 'Confirme a senha', status: 401 },
          };
        return {
          status: 200,
          corpo: {
            segredo: 'ABCDEFGHIJ234567',
            uri: 'otpauth://totp/Sante:SINT.A?secret=ABCDEFGHIJ234567&issuer=Sante',
            expiraEm: '2026-12-01T10:10:00.000Z',
          },
        };
      }
      return undefined;
    });
    const w = await montar(SegurancaTela, '/preferencias/seguranca');
    await flushPromises();
    await w.get('[data-testid="seguranca-cadastrar"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="seguranca-qr"]').exists()).toBe(false);
    const senha = document.querySelector<HTMLInputElement>('[data-testid="seguranca-senha-cadastro"]');
    expect(senha).not.toBeNull();
    senha!.value = 'senha-sintetica';
    senha!.dispatchEvent(new Event('input'));
    document
      .querySelector<HTMLFormElement>('[data-testid="form-senha-cadastro"]')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(pedidos.filter((p) => p.metodo === 'POST').map((p) => p.corpo)).toEqual([
      {},
      { senha: 'senha-sintetica' },
    ]);
    expect(w.find('[data-testid="seguranca-qr"]').exists()).toBe(true);
    w.unmount();
  });

  it('opcional e ativo: remove com a senha; indisponível: só o aviso', async () => {
    let atual = meu({ situacao: 'ativo', exigencia: 'opcional', prazoAdesaoAte: null });
    const pedidos = simular((p) => {
      if (p.metodo === 'GET') return { status: 200, corpo: atual };
      if (p.metodo === 'DELETE') {
        atual = meu({ situacao: 'ausente', exigencia: 'opcional', prazoAdesaoAte: null });
        return { status: 200, corpo: { removido: true } };
      }
      return undefined;
    });
    const w = await montar(SegurancaTela, '/preferencias/seguranca');
    await flushPromises();
    await w.get('[data-testid="seguranca-remover"]').trigger('click');
    await flushPromises();
    const senha = document.querySelector<HTMLInputElement>('[data-testid="seguranca-senha-remover"]');
    expect(senha).not.toBeNull();
    senha!.value = 'senha-sintetica';
    senha!.dispatchEvent(new Event('input'));
    document
      .querySelector<HTMLFormElement>('[data-testid="form-remover-fator"]')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    const del = pedidos.find((p) => p.metodo === 'DELETE');
    expect(del?.corpo).toEqual({ senha: 'senha-sintetica' });
    expect(w.get('[data-testid="seguranca-aviso"]').text()).toBe('Segundo fator removido.');
    expect(w.find('[data-testid="seguranca-cadastrar"]').exists()).toBe(true);
    w.unmount();

    simular(() => ({ status: 200, corpo: meu({ disponivel: false }) }));
    const x = await montar(SegurancaTela, '/preferencias/seguranca');
    await flushPromises();
    expect(x.find('[data-testid="segundo-fator-indisponivel"]').exists()).toBe(true);
    expect(x.find('[data-testid="seguranca-cadastrar"]').exists()).toBe(false);
  });
});

const linha = (sobre: Partial<Politica2fa> = {}): Politica2fa => ({
  id: '1',
  estabelecimento: 'pc',
  alvo: 'perfil',
  valor: 'auditor',
  onda: 1,
  inicio: '2026-12-01',
  prazoAdesaoDias: 14,
  ativa: true,
  criadaPor: 'SINT.GESTOR',
  criadaEm: '2026-11-20T10:00:00.000Z',
  encerradaEm: null,
  ...sobre,
});

describe('política do segundo fator', () => {
  it('quem só lê vê as linhas, sem os botões', async () => {
    comPermissoes(['acesso.politica2fa.ler']);
    simular((p) =>
      p.url.endsWith('/politica-2fa')
        ? {
            status: 200,
            corpo: [linha({ id: '2', ativa: false, encerradaEm: '2026-11-25T10:00:00.000Z' }), linha()],
          }
        : undefined,
    );
    const w = await montar(PoliticaSegundoFatorTela);
    await flushPromises();
    expect(w.find('[data-testid="politica-sem-edicao"]').exists()).toBe(true);
    expect(w.find('[data-testid="politica-abrir-onda1"]').exists()).toBe(false);
    const linhas = w.findAll('[data-testid="tabela-politica-2fa"] tbody tr');
    expect(linhas.map((l) => l.attributes('data-testid'))).toEqual(['politica-linha-1', 'politica-linha-2']);
    expect(linhas[0]!.text()).toContain('Perfil: auditor');
    expect(linhas[0]!.text()).toContain('14/12/2026');
    expect(linhas[1]!.text()).toContain('Encerrada em 25/11/2026');
  });

  it('o gestor abre a onda 1 e volta uma linha a opcional, com motivo e senha', async () => {
    comPermissoes(['acesso.politica2fa.ler', 'acesso.politica2fa.editar']);
    let lista: Politica2fa[] = [];
    const pedidos = simular((p) => {
      if (p.url.endsWith('/politica-2fa') && p.metodo === 'GET') return { status: 200, corpo: lista };
      if (p.url.endsWith('/usuarios-opcoes'))
        return { status: 200, corpo: { grupos: [{ nome: 'MASTER', ativo: true }], destino: 'memoria' } };
      if (p.url.endsWith('/politica-2fa/onda-1')) {
        lista = [linha()];
        return { status: 200, corpo: { incluidas: 14, jaExistiam: 1 } };
      }
      if (p.url.endsWith('/politica-2fa/1/encerrar')) {
        lista = [linha({ ativa: false, encerradaEm: '2026-11-28T10:00:00.000Z' })];
        return { status: 200, corpo: { encerrada: true } };
      }
      return undefined;
    });
    const w = await montar(PoliticaSegundoFatorTela);
    await flushPromises();
    expect(w.find('[data-testid="politica-vazia"]').exists()).toBe(true);
    await w.get('[data-testid="politica-abrir-onda1"]').trigger('click');
    await flushPromises();
    const preencher = (testid: string, valor: string) => {
      const el = document.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!;
      el.value = valor;
      el.dispatchEvent(new Event('input'));
    };
    preencher('onda1-motivo', 'abrir a onda 1 do hospital');
    preencher('onda1-senha', 'senha-sintetica');
    document
      .querySelector<HTMLFormElement>('[data-testid="form-politica-onda1"]')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    const onda = pedidos.find((p) => p.url.endsWith('/onda-1'));
    expect(onda?.metodo).toBe('POST');
    expect(onda?.corpo).toMatchObject({
      senha: 'senha-sintetica',
      dados: { prazoAdesaoDias: 14, motivo: 'abrir a onda 1 do hospital' },
    });
    expect((onda?.corpo as { dados: { inicio: string } }).dados.inicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.get('[data-testid="politica-aviso"]').text()).toBe(
      'Onda 1 aberta: 14 linha(s) incluída(s); 1 já estava(m) em vigor.',
    );
    await w.get('[data-testid="politica-encerrar-1"]').trigger('click');
    await flushPromises();
    preencher('encerrar-motivo', 'recolher a onda');
    preencher('encerrar-senha', 'senha-sintetica');
    document
      .querySelector<HTMLFormElement>('[data-testid="form-politica-encerrar"]')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(pedidos.find((p) => p.url.endsWith('/encerrar'))?.corpo).toEqual({
      dados: { motivo: 'recolher a onda' },
      senha: 'senha-sintetica',
    });
    expect(w.get('[data-testid="politica-linha-1"]').text()).toContain('Encerrada em 28/11/2026');
    expect(w.find('[data-testid="politica-encerrar-1"]').exists()).toBe(false);
  });
});

const resumo = (sobre: Partial<ResumoIdentidade> = {}): ResumoIdentidade => ({
  estabelecimento: 'pc',
  ativos: 120,
  porSenha: {
    forte: 40,
    'legado-cifrada': 70,
    'legado-sem-salt': '<5',
    'legado-texto-puro': 6,
    'sem-senha': 0,
  },
  porSegundoFator: { ativo: 12, pendente: '<5', ausente: 105, revogado: 0 },
  contingencia: true,
  tabelasProntas: true,
  ...sobre,
});
const pagina: PaginaUsuariosIdentidade = {
  itens: [
    {
      login: 'SINT.FORTE',
      nome: 'Usuária Sintética Forte',
      grupo: 'ENFERMAGEM',
      ativo: true,
      bloqueado: false,
      senha: 'forte',
      senhaLegadoPresente: true,
      credencialEm: '2026-11-02T10:00:00.000Z',
      segundoFator: 'ativo',
    },
    {
      login: 'SINT.ANTIGA',
      nome: 'Usuário Sintético Antigo',
      grupo: null,
      ativo: true,
      bloqueado: false,
      senha: 'legado-texto-puro',
      senhaLegadoPresente: true,
      credencialEm: null,
      segundoFator: 'ausente',
    },
  ],
  pagina: 1,
  temMais: false,
};

describe('usuários: senhas e segundo fator', () => {
  it('contingência ligada: resumo em faixa, sem retirada; o gestor revoga o segundo fator', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.senhaLegado.retirar', 'acesso.politica2fa.editar']);
    const pedidos = simular((p) => {
      if (p.url.endsWith('/identidade/resumo')) return { status: 200, corpo: resumo() };
      if (p.url.includes('/identidade/usuarios?') || p.url.endsWith('/identidade/usuarios'))
        return { status: 200, corpo: pagina };
      if (p.url.endsWith('/SINT.FORTE/segundo-fator/revogar'))
        return { status: 200, corpo: { revogado: true } };
      if (p.url.endsWith('/SINT.FORTE/dispositivos/revogar')) return { status: 200, corpo: { revogados: 1 } };
      return undefined;
    });
    const w = await montar(IdentidadeUsuarios);
    await flushPromises();
    expect(w.get('[data-testid="identidade-ativos"]').text()).toBe('120');
    expect(w.get('[data-testid="identidade-senha-legado-sem-salt"]').text()).toContain('<5');
    expect(w.get('[data-testid="identidade-contingencia"]').text()).toContain('contingência ligado');
    expect(w.get('[data-testid="identidade-senha-de-SINT.ANTIGA"]').text()).toBe('Senha antiga sem cifra');
    expect(w.find('[data-testid="identidade-retirar-SINT.FORTE"]').exists()).toBe(false);
    expect(w.find('[data-testid="identidade-revogar-SINT.ANTIGA"]').exists()).toBe(false);
    await w.get('[data-testid="identidade-revogar-SINT.FORTE"]').trigger('click');
    await flushPromises();
    const s = document.querySelector<HTMLInputElement>('[data-testid="identidade-acao-senha"]')!;
    s.value = 'senha-sintetica';
    s.dispatchEvent(new Event('input'));
    document
      .querySelector<HTMLFormElement>('[data-testid="form-identidade-acao"]')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(pedidos.find((p) => p.url.endsWith('/revogar'))?.corpo).toEqual({ senha: 'senha-sintetica' });
    // 01-ADM L62: a revogação do gestor também tira as chaves do dispositivo da conta.
    expect(pedidos.find((p) => p.url.endsWith('/dispositivos/revogar'))?.corpo).toEqual({
      senha: 'senha-sintetica',
    });
    expect(w.get('[data-testid="identidade-aviso"]').text()).toBe('Segundo fator de SINT.FORTE revogado.');
  });

  it('contingência encerrada: retira a senha antiga de quem tem a forte; operação desligada mostra o erro', async () => {
    comPermissoes(['acesso.usuario.ler', 'acesso.senhaLegado.retirar']);
    const pedidos = simular((p) => {
      if (p.url.endsWith('/identidade/resumo'))
        return { status: 200, corpo: resumo({ contingencia: false }) };
      if (p.url.includes('/identidade/usuarios')) {
        if (p.url.includes('/retirar-senha-antiga')) return problema(409, 'operacao-desligada');
        return { status: 200, corpo: pagina };
      }
      return undefined;
    });
    const w = await montar(IdentidadeUsuarios);
    await flushPromises();
    expect(w.find('[data-testid="identidade-revogar-SINT.FORTE"]').exists()).toBe(false);
    expect(w.find('[data-testid="identidade-retirar-SINT.ANTIGA"]').exists()).toBe(false);
    await w.get('[data-testid="identidade-retirar-SINT.FORTE"]').trigger('click');
    await flushPromises();
    const s = document.querySelector<HTMLInputElement>('[data-testid="identidade-acao-senha"]')!;
    s.value = 'senha-sintetica';
    s.dispatchEvent(new Event('input'));
    document
      .querySelector<HTMLFormElement>('[data-testid="form-identidade-acao"]')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    const r = pedidos.find((p) => p.url.endsWith('/retirar-senha-antiga'));
    expect(r?.metodo).toBe('POST');
    expect(r?.corpo).toEqual({ senha: 'senha-sintetica' });
    expect(w.find('[data-testid="identidade-aviso"]').exists()).toBe(false);
    expect(document.querySelector('[data-testid="form-identidade-acao"]')).not.toBeNull();
    expect(w.find('[data-testid="identidade-filtro-senha"]').exists()).toBe(true);
  });
});
