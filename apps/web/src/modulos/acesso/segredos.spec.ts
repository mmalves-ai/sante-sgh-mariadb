// @vitest-environment jsdom
// Telas do M59-F3 (segredos de parceiros, senhas secundárias e imutabilidade clínica): as regras de tela (como a
// linha aparece, o que falta no cofre, a situação), os textos de cada senha do catálogo, a vista "Credenciais
// guardadas no banco" (guardar no cofre com a rotação, retirar só a linha pronta, sem ações para quem só lê), a vista
// "Senhas secundárias" (retirada só depois da contingência e nunca a própria) e a aba "Registros clínicos" do painel
// de contas do banco. Dados SINTÉTICOS; o fetch é simulado.
import {
  type ImutabilidadeResposta,
  type LinhaSegredoLegado,
  EXCECOES_SEGREDO_LEGADO,
  SEGREDOS_LEGADO,
  type SegredosLegadoResposta,
  type SenhasSecundariasResposta,
  type Sessao,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import SenhasSecundariasUsuarios from '../administracao/componentes/SenhasSecundariasUsuarios.vue';
import ContasBancoTela from '../administracao/telas/ContasBancoTela.vue';
import SegredosParceiros from '../integracoes/componentes/SegredosParceiros.vue';
import { consultaSenhasSecundarias } from './api-segredos.js';
import { mensagensSegredos } from './i18n-segredos.js';
import {
  colunasSemCofre,
  dataHoraBr,
  fmtContagem,
  identificacaoDaLinha,
  podeGuardarNaLinha,
  podeRetirarLinha,
  situacaoDaLinha,
  valoresDaChave,
} from './segredos-tela.js';

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
async function montar(tela: Component) {
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:caminho(.*)*', component: { template: '<div />' } }],
  });
  await roteador.push('/');
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

const comPermissoes = (permissoes: string[]) => definirSessaoDaTela({ permissoes } as unknown as Sessao);

function preencher(testid: string, valor: string): void {
  const e = document.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!;
  e.value = valor;
  e.dispatchEvent(new Event('input'));
}
const enviarForm = (testid: string) =>
  document.querySelector<HTMLFormElement>(`[data-testid="${testid}"]`)!.dispatchEvent(new Event('submit'));

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  definirSessaoDaTela(null);
});

const linha = (l: Partial<LinhaSegredoLegado>): LinhaSegredoLegado => ({
  tabela: 'convenio',
  chave: 'id=901',
  descricao: 'CONVENIO SINTETICO',
  comValor: ['senha_portal'],
  noCofre: [],
  rotacionadoEm: null,
  retiradoEm: null,
  bloqueio: 'falta-no-cofre',
  ...l,
});

describe('regras de tela', () => {
  it('a linha aparece pela descrição ou pelos valores da chave (nunca o nome da tabela)', () => {
    expect(valoresDaChave('convenio_id=7;versao_tiss_id=2')).toBe('7 · 2');
    expect(identificacaoDaLinha({ chave: 'id=901', descricao: 'CONVENIO SINTETICO' })).toBe(
      'CONVENIO SINTETICO (901)',
    );
    expect(identificacaoDaLinha({ chave: 'ID=3', descricao: null })).toBe('3');
  });

  it('o que falta no cofre segue a ordem do catálogo; a situação decide as ações', () => {
    const h = linha({ tabela: 'estabelecimento', chave: 'id=1', descricao: null });
    expect(
      colunasSemCofre({ ...h, comValor: ['senha_assinatura', 'senha_provedor'], noCofre: ['senha_assinatura'] }),
    ).toEqual(['senha_provedor']);
    expect(situacaoDaLinha(linha({}))).toBe('falta-cofre');
    const pronta = linha({ noCofre: ['senha_portal'], bloqueio: null });
    expect(situacaoDaLinha(pronta)).toBe('pronto');
    expect(podeRetirarLinha(pronta, true)).toBe(true);
    expect(podeRetirarLinha(pronta, false)).toBe(false);
    const aguardando = linha({ noCofre: ['senha_portal'], bloqueio: 'contingencia-ativa' });
    expect(situacaoDaLinha(aguardando)).toBe('bloqueado');
    expect(podeRetirarLinha(aguardando, true)).toBe(false);
    const retirada = linha({ comValor: [], noCofre: ['senha_portal'], retiradoEm: '2026-10-28T13:05:00.000Z' });
    expect(situacaoDaLinha(retirada)).toBe('retirado');
    expect(podeGuardarNaLinha(retirada, true)).toBe(false);
    expect(podeGuardarNaLinha(linha({}), true)).toBe(true);
  });

  it('formatos: faixa, data e consulta da lista', () => {
    expect(fmtContagem('<5')).toBe('<5');
    expect(fmtContagem(1234)).toBe('1.234');
    expect(dataHoraBr('2026-10-28T13:05:00.000Z')).toBe('28/10/2026 13:05');
    expect(dataHoraBr(null)).toBe('');
    expect(consultaSenhasSecundarias({})).toBe('');
    expect(consultaSenhasSecundarias({ busca: ' sint ', pagina: 2 })).toBe('?busca=sint&pagina=2');
  });

  it('toda senha do catálogo e toda exceção têm texto de produto', () => {
    const colunas = mensagensSegredos.colunas as Record<string, Record<string, string>>;
    for (const s of SEGREDOS_LEGADO)
      for (const c of s.colunas) expect(colunas[s.tabela]?.[c], `${s.tabela}.${c}`).toBeTruthy();
    expect(Object.keys(mensagensSegredos.excecoes).sort()).toEqual(['contas_acesso_modulos', 'integracao_bancaria_externa']);
    // O motivo da tela é de produto: sem código de pendência do planejamento nem menção à cópia de dev.
    const motivos = mensagensSegredos.excecoesMotivo as Record<string, string>;
    for (const e of EXCECOES_SEGREDO_LEGADO) {
      expect(motivos[e.objeto], e.objeto).toBeTruthy();
      expect(motivos[e.objeto]).not.toMatch(/\bDP-\d|c[oó]pia|SPDATA|legado|sistema anterior/i);
    }
  });
});

// ── segredos de parceiros ───────────────────────────────────────────────────────────────────────

const segredos = (sobre: Partial<SegredosLegadoResposta> = {}): SegredosLegadoResposta => ({
  hospital: 'aa',
  em: '2026-10-29T10:00:00.000Z',
  contingenciaLigada: false,
  cofreDisponivel: true,
  receita: { ligada: true, motivo: null },
  tabelas: [
    {
      tabela: 'convenio',
      rotulo: 'Senha de acesso ao portal do convênio',
      comValor: 12,
      noCofre: '<5',
      rotacionados: 0,
      retirados: 0,
    },
    {
      tabela: 'equipamento_laboratorio',
      rotulo: 'Senhas de transferência dos equipamentos de laboratório',
      comValor: '<5',
      noCofre: 0,
      rotacionados: 0,
      retirados: 0,
    },
  ],
  linhas: [
    linha({}),
    linha({
      chave: 'id=902',
      descricao: 'CONVENIO PRONTO',
      noCofre: ['senha_portal'],
      bloqueio: null,
      rotacionadoEm: '2026-10-20T09:00:00.000Z',
    }),
    linha({
      tabela: 'equipamento_laboratorio',
      chave: 'CODIGO=5',
      descricao: 'EQUIPAMENTO SINTETICO',
      comValor: ['senha_transferencia', 'senha_exportacao'],
    }),
  ],
  linhasTotal: 3,
  excecoes: [{ objeto: 'integracao_bancaria_externa', motivo: 'lida por gatilhos que escrevem em banco externo' }],
  ...sobre,
});

describe('Credenciais guardadas no banco', () => {
  it('quem gere: guarda no cofre a credencial nova e retira só a linha pronta', async () => {
    comPermissoes(['integracao.segredoLegado.ler', 'integracao.segredoLegado.gerir']);
    const pedidos = simular((p) => {
      if (p.url.endsWith('/segredos-legado/guardar'))
        return { status: 200, corpo: { guardado: true, novo: true } };
      if (p.url.endsWith('/segredos-legado/retirar')) return { status: 200, corpo: { retirado: true } };
      if (p.url.endsWith('/segredos-legado')) return { status: 200, corpo: segredos() };
      return undefined;
    });
    const w = await montar(SegredosParceiros);
    await flushPromises();
    expect(w.get('[data-testid="segredos-resumo-convenio"]').text()).toContain('<5');
    expect(w.text()).not.toContain('convenio');
    expect(w.get('[data-testid="segredos-situacao-tbconven-cod-901"]').text()).toBe('Falta guardar no cofre');
    expect(w.get('[data-testid="segredos-situacao-tbconven-cod-902"]').text()).toBe('Pronta para retirar');
    expect(w.find('[data-testid="segredos-retirar-tbconven-cod-901"]').exists()).toBe(false);
    expect(w.text()).toContain('Dados de acesso ao banco externo do estabelecimento');
    expect(w.text()).toContain('integração bancária automática');
    expect(w.text()).not.toContain('lida por gatilhos');

    await w.get('[data-testid="segredos-guardar-sitpeqv-codigo-5"]').trigger('click');
    await flushPromises();
    preencher('segredo-valor', 'credencial-sintetica');
    preencher('segredo-senha', 'senha-sintetica');
    enviarForm('form-segredo');
    await flushPromises();
    expect(pedidos.find((p) => p.url.endsWith('/guardar'))?.corpo).toEqual({
      tabela: 'equipamento_laboratorio',
      chave: 'CODIGO=5',
      coluna: 'senha_transferencia',
      valor: 'credencial-sintetica',
      rotacionado: true,
      senha: 'senha-sintetica',
    });
    expect(w.get('[data-testid="segredos-aviso"]').text()).toContain('EQUIPAMENTO SINTETICO');

    await w.get('[data-testid="segredos-retirar-tbconven-cod-902"]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Senha do portal');
    preencher('segredo-senha', 'senha-sintetica');
    enviarForm('form-segredo');
    await flushPromises();
    const r = pedidos.find((p) => p.url.endsWith('/retirar'));
    expect(r?.metodo).toBe('POST');
    expect(r?.corpo).toEqual({ tabela: 'convenio', chave: 'id=902', senha: 'senha-sintetica' });
  });

  it('quem só lê não tem ações; contingência, cofre e retirada desligada aparecem com o motivo', async () => {
    comPermissoes(['integracao.segredoLegado.ler']);
    simular((p) =>
      p.url.endsWith('/segredos-legado')
        ? {
            status: 200,
            corpo: segredos({
              contingenciaLigada: true,
              cofreDisponivel: false,
              receita: { ligada: false, motivo: 'aguardando a prova na cópia' },
            }),
          }
        : undefined,
    );
    const w = await montar(SegredosParceiros);
    await flushPromises();
    expect(w.get('[data-testid="segredos-contingencia"]').text()).toContain('contingência está ligado');
    expect(w.find('[data-testid="segredos-sem-cofre"]').exists()).toBe(true);
    expect(w.get('[data-testid="segredos-desligada"]').text()).toContain('aguardando a prova na cópia');
    expect(w.find('[data-testid^="segredos-guardar-"]').exists()).toBe(false);
    expect(w.find('[data-testid^="segredos-retirar-"]').exists()).toBe(false);
  });
});

// ── senhas secundárias ──────────────────────────────────────────────────────────────────────────

const senhas = (sobre: Partial<SenhasSecundariasResposta> = {}): SenhasSecundariasResposta => ({
  hospital: 'aa',
  contingenciaLigada: false,
  receita: { ligada: true, motivo: null },
  porColuna: [
    { coluna: 'senha_liberacao', usuarios: 8 },
    { coluna: 'senha_cancelamento_nota', usuarios: '<5' },
  ],
  usuariosComSenha: 9,
  pagina: 1,
  total: 2,
  usuarios: [
    { login: 'SINT.OUTRO', colunas: ['senha_liberacao', 'senha_cancelamento_nota'], proprio: false },
    { login: 'SINT.GESTOR', colunas: ['senha_liberacao'], proprio: true },
  ],
  ...sobre,
});

describe('Senhas secundárias', () => {
  it('depois da contingência: retira a de outro usuário com a senha de novo; a própria não', async () => {
    comPermissoes(['acesso.senhaSecundaria.ler', 'acesso.senhaSecundaria.retirar']);
    const pedidos = simular((p) => {
      if (p.url.includes('/senhas-secundarias/') && p.url.endsWith('/retirar'))
        return { status: 200, corpo: { retirada: true } };
      if (p.url.includes('/senhas-secundarias')) return { status: 200, corpo: senhas() };
      return undefined;
    });
    const w = await montar(SenhasSecundariasUsuarios);
    await flushPromises();
    expect(w.get('[data-testid="senhas-sec-total"]').text()).toBe('9');
    expect(w.get('[data-testid="senhas-sec-tipo-senha_cancelamento_nota"]').text()).toContain('<5');
    expect(w.get('[data-testid="senhas-sec-linha-SINT.OUTRO"]').text()).toContain(
      'Senha de liberação, Senha de cancelamento de nota fiscal',
    );
    expect(w.find('[data-testid="senhas-sec-retirar-SINT.GESTOR"]').exists()).toBe(false);
    expect(w.get('[data-testid="senhas-sec-linha-SINT.GESTOR"]').text()).toContain('outro gestor');
    await w.get('[data-testid="senhas-sec-retirar-SINT.OUTRO"]').trigger('click');
    await flushPromises();
    preencher('senhas-sec-senha', 'senha-sintetica');
    enviarForm('form-senhas-sec');
    await flushPromises();
    const r = pedidos.find((p) => p.url.endsWith('/SINT.OUTRO/retirar'));
    expect(r?.corpo).toEqual({ senha: 'senha-sintetica' });
    expect(w.get('[data-testid="senhas-sec-aviso"]').text()).toBe(
      'Senhas secundárias de SINT.OUTRO retiradas.',
    );
  });

  it('contingência ligada ou retirada desligada: nenhum botão de retirar', async () => {
    comPermissoes(['acesso.senhaSecundaria.ler', 'acesso.senhaSecundaria.retirar']);
    simular((p) =>
      p.url.includes('/senhas-secundarias')
        ? {
            status: 200,
            corpo: senhas({ contingenciaLigada: true, receita: { ligada: false, motivo: null } }),
          }
        : undefined,
    );
    const w = await montar(SenhasSecundariasUsuarios);
    await flushPromises();
    expect(w.find('[data-testid^="senhas-sec-retirar-"]').exists()).toBe(false);
    expect(w.find('[data-testid="senhas-sec-desligada"]').exists()).toBe(true);
  });
});

// ── imutabilidade clínica ───────────────────────────────────────────────────────────────────────

const imutabilidade: ImutabilidadeResposta = {
  hospital: 'aa',
  em: '2026-10-29T10:00:00.000Z',
  tabelasClinicas: { legado: 55, sgh: 14 },
  operacoesComDelete: [],
  planoComDelete: 0,
  excecoes: [{ tabela: 'SGH_PEP_FORMNOVO_CASO', motivo: 'casos de teste do formulário novo' }],
  titulares: [
    { titular: 'SGH_APP_SINT', doSante: true, tabelas: 69 },
    { titular: '(outras)', doSante: false, tabelas: '<5' },
  ],
  concessaoVigente: true,
};

describe('Contas do banco › Registros clínicos', () => {
  it('mostra quem ainda pode apagar registro clínico, o plano e as operações', async () => {
    comPermissoes(['acesso.contaBanco.ler']);
    const pedidos = simular((p) =>
      p.url.endsWith('/contas-banco/imutabilidade') ? { status: 200, corpo: imutabilidade } : undefined,
    );
    const w = await montar(ContasBancoTela);
    await flushPromises();
    await w.get('[data-testid="contas-aba-imutabilidade"]').trigger('click');
    await flushPromises();
    expect(pedidos.some((p) => p.url.endsWith('/imutabilidade'))).toBe(true);
    expect(w.get('[data-testid="imutabilidade-tabelas"]').text()).toBe(
      'Tabelas clínicas: 55 do prontuário e 14 do Sante.',
    );
    expect(w.get('[data-testid="imutabilidade-concessao"]').text()).toContain('ainda pode apagar');
    const tit = w.get('[data-testid="imutabilidade-titulares"]').text();
    expect(tit).toContain('SGH_APP_SINT');
    expect(tit).toContain('Demais contas (somadas, sem nome)');
    expect(w.get('[data-testid="imutabilidade-plano"]').text()).toContain('Nenhum');
    expect(w.find('[data-testid="imutabilidade-operacoes-nenhuma"]').exists()).toBe(true);
  });
});
