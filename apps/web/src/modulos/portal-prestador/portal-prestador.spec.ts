// @vitest-environment jsdom
// Portal do prestador credenciado (M56, etapa 8, F7): sem a sessão do portal, o convite para entrar; só com a consulta
// liberada, a lista com as iniciais e sem "Novo pedido"; com a solicitação, o pedido sai pelo formulário da operadora
// sem o prestador e sem a origem (o servidor tira os dois da conta) e com o CSRF do portal; a ativação mostra o QR do
// segundo fator uma vez e a entrada leva aos pedidos. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import FormAutorizacao from '../operadora/componentes/FormAutorizacao.vue';
import PortalPrestadorContaTela from './telas/PortalPrestadorContaTela.vue';
import PortalPrestadorContasTela from './telas/PortalPrestadorContasTela.vue';
import PortalPrestadorElegibilidadeTela from './telas/PortalPrestadorElegibilidadeTela.vue';
import PortalPrestadorEntrarTela from './telas/PortalPrestadorEntrarTela.vue';
import PortalPrestadorPedidosTela from './telas/PortalPrestadorPedidosTela.vue';
import PortalPrestadorProtocoloTela from './telas/PortalPrestadorProtocoloTela.vue';

const navegar = vi.fn();
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ replace: navegar, push: navegar }),
  useRoute: () => ({ query: { estabelecimento: 'pc' }, params: {} }),
}));

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
const montar = (c: unknown) =>
  mount(c as never, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a href="#"><slot /></a>' } },
    },
  });

type Pedido = { url: string; init?: RequestInit };
function simular(rotas: (u: string, init?: RequestInit) => unknown): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      pedidos.push({ url: u, ...(init ? { init } : {}) });
      const corpo = rotas(u, init);
      if (corpo instanceof Response) return corpo;
      return new Response(JSON.stringify(corpo ?? { title: 'Sessão do portal encerrada' }), {
        status: corpo === undefined ? 401 : 200,
        headers: { 'content-type': corpo === undefined ? 'application/problem+json' : 'application/json' },
      });
    }),
  );
  return pedidos;
}
afterEach(() => {
  vi.unstubAllGlobals();
  navegar.mockReset();
  document.body.innerHTML = '';
  document.cookie = 'sgh_portal_prestador_csrf=; max-age=0';
});

const sessao = (funcoes: number[]) => ({
  nome: 'Responsável Sintético',
  prestador: 21,
  prestadorNome: 'Clínica Sintética',
  operadora: 1,
  funcoes,
  expiraEm: '2026-10-26T15:20:00.000Z',
});
const pedido = {
  id: 9,
  protocolo: '90000120261026000009',
  carteirinha: '0000000000000001',
  beneficiarioIniciais: 'B. S.',
  tipoGuia: 2,
  situacao: 'em-analise',
  situacaoRotulo: 'Em análise',
  solicitadaEm: '2026-10-26T09:00:00',
  prazoEm: '2026-11-02T23:59:59',
  senha: null,
  senhaValidade: null,
  versao: 1,
};

describe('portal do prestador', () => {
  it('sem a sessão do portal: o convite para entrar e nada dos pedidos', async () => {
    const pedidos = simular(() => undefined);
    const w = montar(PortalPrestadorPedidosTela);
    await flushPromises();
    expect(w.find('[data-testid="portal-prestador-sem-sessao"]').exists()).toBe(true);
    expect(pedidos.some((p) => p.url.includes('/autorizacoes'))).toBe(false);
    w.unmount();
  });

  it('só com a consulta: a lista com as iniciais, sem "Novo pedido" e sem o menu do protocolo', async () => {
    simular((u) => {
      if (u.endsWith('/sessao')) return sessao([3]);
      if (u.includes('/autorizacoes')) return { itens: [pedido], proxima: null };
      return undefined;
    });
    const w = montar(PortalPrestadorPedidosTela);
    await flushPromises();
    expect(w.find('[data-testid="pp-linha-9"]').text()).toContain('B. S.');
    expect(w.find('[data-testid="pp-novo"]').exists()).toBe(false);
    expect(w.find('[data-testid="portal-prestador-menu-protocolo"]').exists()).toBe(false);
    w.unmount();
  });

  it('com a solicitação: o pedido sai sem prestador e sem origem, com o CSRF do portal', async () => {
    document.cookie = 'sgh_portal_prestador_csrf=csrf-sintetico';
    const pedidos = simular((u, init) => {
      if (u.endsWith('/sessao')) return sessao([1, 3]);
      if (u.endsWith('/apoio')) return { tiposGuia: [{ codigo: 2, rotulo: 'SP/SADT' }], hoje: '2026-10-26' };
      if (init?.method === 'POST' && u.endsWith('/api/portal-prestador/autorizacoes'))
        return {
          ok: true,
          id: 10,
          versao: 1,
          situacao: 'em-analise',
          protocolo: '90000120261026000010',
          senha: null,
          mensagem: 'Pedido registrado com o protocolo 90000120261026000010.',
          avisos: [],
        };
      if (u.includes('/autorizacoes/10')) return { ...pedido, id: 10, itens: [] };
      if (u.includes('/autorizacoes')) return { itens: [], proxima: null };
      return undefined;
    });
    const w = montar(PortalPrestadorPedidosTela);
    await flushPromises();
    await w.find('[data-testid="pp-novo"]').trigger('click');
    await flushPromises();
    const form = w.findComponent(FormAutorizacao);
    expect(form.exists()).toBe(true);
    expect(document.body.querySelector('[data-testid="aut-prestador"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="aut-origem"]')).toBeNull();
    const st = (
      form.vm as unknown as {
        $: { setupState: { f: Record<string, unknown>; completo: boolean; gravar: () => Promise<void> } };
      }
    ).$.setupState;
    Object.assign(st.f, {
      carteirinha: '0000000000000001',
      tipoGuia: 2,
      indicacao: 'Indicação clínica sintética do pedido.',
      profNome: 'Profissional Sintético',
      profNumero: '000001',
      itens: [{ tabela: 22, codigo: '40301010', descricao: '', quantidade: '1' }],
    });
    await flushPromises();
    expect(st.completo).toBe(true);
    await st.gravar();
    await flushPromises();
    const post = pedidos.find((p) => p.init?.method === 'POST');
    expect(post?.url).toMatch(/\/api\/portal-prestador\/autorizacoes$/);
    const corpo = JSON.parse(String(post?.init?.body)) as Record<string, unknown>;
    expect(corpo).not.toHaveProperty('prestador');
    expect(corpo).not.toHaveProperty('origem');
    expect(corpo['executante']).toBeNull();
    expect((post?.init?.headers as Record<string, string>)['x-csrf-portal-prestador']).toBe('csrf-sintetico');
    expect(w.find('[data-testid="pp-mensagem"]').text()).toContain('90000120261026000010');
    w.unmount();
  });

  it('a ativação mostra o QR uma vez; a entrada leva aos pedidos', async () => {
    const pedidos = simular((u) => {
      if (u.endsWith('/pc/ativacao'))
        return {
          otpauth: 'otpauth://totp/Sante:resp?secret=JBSWY3DPEHPK3PXP&issuer=Sante',
          mensagem: 'Conta ativada.',
        };
      if (u.endsWith('/pc/entrada')) return sessao([1, 3, 7]);
      return undefined;
    });
    const w = montar(PortalPrestadorEntrarTela);
    await flushPromises();
    await w.find('[data-testid="pp-trocar"]').trigger('click');
    await w.find('[data-testid="pp-login"]').setValue('responsavel@clinica.invalid');
    await w.find('[data-testid="pp-ativacao"]').setValue('abcd2345efgh');
    await w.find('[data-testid="pp-senha"]').setValue('senhaSintetica2026');
    await w.find('[data-testid="pp-senha2"]').setValue('senhaSintetica2026');
    await w.find('[data-testid="portal-prestador-form-ativar"]').trigger('submit');
    await flushPromises();
    const ativacao = pedidos.find((p) => p.url.endsWith('/pc/ativacao'));
    expect(JSON.parse(String(ativacao?.init?.body))).toMatchObject({ codigo: 'ABCD2345EFGH' });
    expect(w.find('[data-testid="portal-prestador-qr"]').exists()).toBe(true);
    expect(w.text()).toContain('JBSWY3DPEHPK3PXP');

    await w.find('[data-testid="pp-senha"]').setValue('senhaSintetica2026');
    await w.find('[data-testid="pp-codigo"]').setValue('123456');
    await w.find('[data-testid="portal-prestador-form-entrar"]').trigger('submit');
    await flushPromises();
    expect(navegar).toHaveBeenCalledWith({ name: 'portal.prestador.pedidos' });
    w.unmount();
  });

  it('a consulta do protocolo mostra a situação do protocolo do prestador', async () => {
    simular((u) => {
      if (u.endsWith('/sessao')) return sessao([7]);
      if (u.includes('/protocolos/'))
        return {
          tipo: 'atendimento',
          id: 5,
          protocolo: '90000120261026500005',
          situacao: 'aberto',
          situacaoRotulo: 'Aberto',
          abertoEm: '2026-10-26T10:00:00',
          prazoEm: '2026-11-02T23:59:59',
          vencido: false,
          versao: 1,
          respondivel: true,
          interacoes: [],
        };
      return undefined;
    });
    const w = montar(PortalPrestadorProtocoloTela);
    await flushPromises();
    const campo = document.body.querySelector('#pp-numero') as HTMLInputElement;
    campo.value = '90000120261026500005';
    campo.dispatchEvent(new Event('input'));
    await flushPromises();
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="pp-protocolo-situacao"]').text()).toBe('Aberto');
    w.unmount();
  });

  describe('W0-10: minha conta (senha e autenticador)', () => {
    const digitar = async (w: ReturnType<typeof montar>, id: string, v: string) => {
      await w.find(`[data-testid="${id}"]`).setValue(v);
    };
    const clicar = async (w: ReturnType<typeof montar>, id: string) => {
      await w.find(`[data-testid="${id}"]`).trigger('click');
      await flushPromises();
    };

    it('a troca da senha só sai depois do painel de confirmação, com o CSRF; a recusa mostra o texto do servidor', async () => {
      document.cookie = 'sgh_portal_prestador_csrf=csrf-sintetico';
      let tentativa = 0;
      const pedidos = simular((u, init) => {
        if (u.endsWith('/sessao')) return sessao([3]);
        if (init?.method === 'POST' && u.endsWith('/conta/senha'))
          return ++tentativa === 1
            ? new Response(
                JSON.stringify({
                  title: 'Senha ou código não confere',
                  detail: 'A senha ou o código do aplicativo não confere.',
                  codigo: 'credencial-nao-confere',
                }),
                { status: 422, headers: { 'content-type': 'application/problem+json' } },
              )
            : { mensagem: 'Senha trocada. Use a senha nova na próxima entrada.' };
        return undefined;
      });
      const w = montar(PortalPrestadorContaTela);
      await flushPromises();
      expect(w.find('[data-testid="portal-prestador-menu-conta"]').exists()).toBe(true);
      const botao = () => w.find('[data-testid="pp-senha-trocar"]');
      await digitar(w, 'pp-senha-atual', 'senha-sintetica-56');
      await digitar(w, 'pp-senha-nova', 'senha-nova-sint-78');
      await digitar(w, 'pp-senha-repetir', 'senha-nova-sint-79');
      await digitar(w, 'pp-senha-codigo', '123456');
      expect(w.text()).toContain('As senhas novas não conferem.');
      expect(botao().attributes('disabled')).toBeDefined();
      await digitar(w, 'pp-senha-repetir', 'senha-nova-sint-78');
      expect(botao().attributes('disabled')).toBeUndefined();
      await clicar(w, 'pp-senha-trocar');
      // Nada enviado antes do "Confirmar"; "Voltar" fecha o painel sem enviar.
      expect(w.find('[data-testid="pp-conta-confirmacao"]').exists()).toBe(true);
      expect(pedidos.some((p) => p.url.endsWith('/conta/senha'))).toBe(false);
      await clicar(w, 'pp-conta-voltar');
      expect(w.find('[data-testid="pp-conta-confirmacao"]').exists()).toBe(false);
      await clicar(w, 'pp-senha-trocar');
      await clicar(w, 'pp-conta-confirmar');
      expect(w.find('[data-testid="pp-conta-recusa"]').text()).toContain('não confere');
      const envio = pedidos.find((p) => p.url.endsWith('/conta/senha'));
      expect(JSON.parse(String(envio?.init?.body))).toEqual({
        senhaAtual: 'senha-sintetica-56',
        codigo: '123456',
        senhaNova: 'senha-nova-sint-78',
      });
      expect((envio?.init?.headers as Record<string, string>)['x-csrf-portal-prestador']).toBe(
        'csrf-sintetico',
      );
      // O código é limpo depois da recusa; com um novo, a troca passa e os campos esvaziam.
      expect((w.find('[data-testid="pp-senha-codigo"]').element as HTMLInputElement).value).toBe('');
      await digitar(w, 'pp-senha-codigo', '654321');
      await clicar(w, 'pp-senha-trocar');
      await clicar(w, 'pp-conta-confirmar');
      expect(w.text()).toContain('Senha trocada.');
      expect((w.find('[data-testid="pp-senha-atual"]').element as HTMLInputElement).value).toBe('');
      w.unmount();
    });

    it('a troca do autenticador: confirma, mostra o QR e a chave do novo e grava só com o código do app novo', async () => {
      document.cookie = 'sgh_portal_prestador_csrf=csrf-sintetico';
      const pedidos = simular((u, init) => {
        if (u.endsWith('/sessao')) return sessao([3]);
        if (init?.method === 'POST' && u.endsWith('/conta/autenticador'))
          return {
            otpauth: 'otpauth://totp/Sante:troca%40clinica.invalid?secret=JBSWY3DPEHPK3PXP&issuer=Sante',
            validoAte: '2026-10-26T13:10:00.000Z',
            mensagem: 'Cadastre o código no aplicativo autenticador novo.',
          };
        if (init?.method === 'POST' && u.endsWith('/conta/autenticador/confirmacao'))
          return { mensagem: 'Aplicativo autenticador trocado.' };
        return undefined;
      });
      const w = montar(PortalPrestadorContaTela);
      await flushPromises();
      await digitar(w, 'pp-aut-senha', 'senha-sintetica-56');
      await digitar(w, 'pp-aut-codigo', '123456');
      await clicar(w, 'pp-aut-iniciar');
      expect(pedidos.some((p) => p.url.endsWith('/conta/autenticador'))).toBe(false);
      await clicar(w, 'pp-conta-confirmar');
      expect(w.find('[data-testid="pp-aut-qr"]').exists()).toBe(true);
      expect(w.find('[data-testid="pp-aut-chave"]').text()).toContain('JBSWY3DPEHPK3PXP');
      await digitar(w, 'pp-aut-codigo-novo', '777888');
      await clicar(w, 'pp-aut-confirmar');
      expect(pedidos.some((p) => p.url.endsWith('/confirmacao'))).toBe(false);
      await clicar(w, 'pp-conta-confirmar');
      const conf = pedidos.find((p) => p.url.endsWith('/conta/autenticador/confirmacao'));
      expect(JSON.parse(String(conf?.init?.body))).toEqual({ codigo: '777888' });
      expect(w.text()).toContain('Aplicativo autenticador trocado.');
      expect(w.find('[data-testid="pp-aut-qr"]').exists()).toBe(false);
      w.unmount();
    });
  });

  describe('W0-10: resposta com arquivos (protocolo e complemento)', () => {
    const escreverEm = async (id: string, v: string) => {
      const c = document.body.querySelector(`#${id}`) as HTMLTextAreaElement;
      c.value = v;
      c.dispatchEvent(new Event('input'));
      await flushPromises();
    };
    const anexar = async (testid: string, arquivos: File[]) => {
      const e = document.body.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement;
      Object.defineProperty(e, 'files', { value: arquivos, configurable: true });
      e.dispatchEvent(new Event('change'));
      await flushPromises();
    };
    const clicar = async (w: ReturnType<typeof montar>, id: string) => {
      await w.find(`[data-testid="${id}"]`).trigger('click');
      await flushPromises();
    };
    const problema = (status: number, detail: string) =>
      new Response(JSON.stringify({ title: 'Recusado', detail }), {
        status,
        headers: { 'content-type': 'application/problem+json' },
      });

    it('o prestador abre o protocolo: o painel confirma, "Voltar" não envia, a recusa aparece e o aberto é consultado', async () => {
      document.cookie = 'sgh_portal_prestador_csrf=csrf-sintetico';
      let recusar = true;
      const pedidos = simular((u, init) => {
        if (u.endsWith('/sessao')) return sessao([7]);
        if (init?.method === 'POST' && u.endsWith('/api/portal-prestador/protocolos')) {
          if (recusar) return problema(409, 'Nenhum beneficiário da operadora com esta carteirinha.');
          return {
            ok: true,
            id: 6,
            protocolo: '90000120261026500006',
            prazoEm: '2026-11-02T23:59:59',
            mensagem: 'Protocolo 90000120261026500006: resposta até 02/11/2026 23:59.',
          };
        }
        if (u.endsWith('/protocolos/90000120261026500006'))
          return {
            tipo: 'atendimento',
            id: 6,
            protocolo: '90000120261026500006',
            situacao: 'aberto',
            situacaoRotulo: 'Aberto',
            abertoEm: '2026-10-26T10:00:00',
            prazoEm: '2026-11-02T23:59:59',
            vencido: false,
            versao: 1,
            respondivel: true,
            interacoes: [],
          };
        return undefined;
      });
      const w = montar(PortalPrestadorProtocoloTela);
      await flushPromises();
      await clicar(w, 'pp-abrir-protocolo');
      expect(w.find('[data-testid="pp-abertura-enviar"]').attributes('disabled')).toBeDefined();
      await escreverEm('pp-abertura-carteirinha', '1234567890123456');
      await escreverEm('pp-abertura-assunto', 'Dúvida sintética');
      await escreverEm('pp-abertura-relato', 'Relato sintético da dúvida do prestador.');
      await clicar(w, 'pp-abertura-enviar');
      expect(w.find('[data-testid="pp-abertura-confirmacao"]').exists()).toBe(true);
      await clicar(w, 'pp-abertura-voltar');
      expect(w.find('[data-testid="pp-abertura-confirmacao"]').exists()).toBe(false);
      expect(pedidos.some((p) => p.init?.method === 'POST')).toBe(false);
      await clicar(w, 'pp-abertura-enviar');
      await clicar(w, 'pp-abertura-confirmar');
      expect(w.find('[data-testid="pp-protocolo-recusa"]').text()).toContain('Nenhum beneficiário');
      expect(w.find('[data-testid="pp-abertura"]').exists()).toBe(true);
      recusar = false;
      await clicar(w, 'pp-abertura-enviar');
      await clicar(w, 'pp-abertura-confirmar');
      const posts = pedidos.filter((p) => p.init?.method === 'POST');
      expect(posts).toHaveLength(2);
      const cab = posts[1]?.init?.headers as Record<string, string>;
      expect(cab['x-csrf-portal-prestador']).toBe('csrf-sintetico');
      // Nem operadora, nem prestador, nem canal: o servidor tira da conta.
      expect(JSON.parse(String(posts[1]?.init?.body))).toEqual({
        natureza: 'informacao',
        carteirinha: '1234567890123456',
        assunto: 'Dúvida sintética',
        relato: 'Relato sintético da dúvida do prestador.',
      });
      expect(w.find('[data-testid="pp-abertura"]').exists()).toBe(false);
      expect(w.find('[data-testid="pp-protocolo-situacao"]').text()).toBe('Aberto');
      expect(w.find('[data-testid="pp-protocolo-mensagem"]').text()).toContain('90000120261026500006');
      w.unmount();
    });

    it('o protocolo mostra a mensagem da operadora; a resposta com um arquivo sai só depois do painel e aparece com o download', async () => {
      document.cookie = 'sgh_portal_prestador_csrf=csrf-sintetico';
      let respondido = false;
      const resposta = {
        id: 4,
        interacao: 31,
        evento: 32,
        texto: 'Segue o laudo sintético.',
        anexo: { nome: 'laudo.pdf', tipo: 'application/pdf', tamanho: 8, sha256: 'ab'.repeat(32) },
        em: '2026-10-27T09:00:00',
      };
      const pedidos = simular((u, init) => {
        if (u.endsWith('/sessao')) return sessao([7]);
        if (init?.method === 'POST' && u.endsWith('/protocolos/5/interacoes/31/resposta')) {
          respondido = true;
          return { ok: true, id: 5, versao: 3, resposta: 4, evento: 32, mensagem: 'Resposta enviada.' };
        }
        if (u.includes('/protocolos/'))
          return {
            tipo: 'atendimento',
            id: 5,
            protocolo: '90000120261026500005',
            situacao: 'em-analise',
            situacaoRotulo: 'Em análise',
            abertoEm: '2026-10-26T10:00:00',
            prazoEm: '2026-11-02T23:59:59',
            vencido: false,
            versao: respondido ? 3 : 2,
            respondivel: true,
            interacoes: [
              {
                evento: 31,
                em: '2026-10-26T15:00:00',
                texto: 'Envie o laudo do exame.',
                respostas: respondido ? [resposta] : [],
              },
            ],
          };
        return undefined;
      });
      const w = montar(PortalPrestadorProtocoloTela);
      await flushPromises();
      await escreverEm('pp-numero', '90000120261026500005');
      await w.find('form').trigger('submit');
      await flushPromises();
      expect(w.find('[data-testid="pp-interacao-31"]').text()).toContain('Envie o laudo do exame.');
      await clicar(w, 'pp-responder-31');
      expect(w.find('[data-testid="pp-interacao-enviar"]').attributes('disabled')).toBeDefined();
      await escreverEm('pp-interacao-texto', 'Segue o laudo sintético.');
      await anexar('pp-interacao-arquivo', [
        new File(['%PDF-1.4'], 'laudo.pdf', { type: 'application/pdf' }),
      ]);
      expect(w.find('[data-testid="pp-interacao-arquivos"]').text()).toContain('laudo.pdf');
      await clicar(w, 'pp-interacao-enviar');
      // Nada sai antes do "Confirmar".
      expect(w.find('[data-testid="pp-interacao-confirmacao"]').exists()).toBe(true);
      expect(pedidos.some((p) => p.init?.method === 'POST')).toBe(false);
      await clicar(w, 'pp-interacao-confirmar');
      const post = pedidos.find((p) => p.init?.method === 'POST');
      const cab = post?.init?.headers as Record<string, string>;
      expect(cab['content-type']).toBe('application/vnd.sgh.anexos+json');
      expect(cab['x-csrf-portal-prestador']).toBe('csrf-sintetico');
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        versao: 2,
        texto: 'Segue o laudo sintético.',
        anexo: { nome: 'laudo.pdf', conteudo: btoa('%PDF-1.4') },
      });
      expect(w.find('[data-testid="pp-protocolo-mensagem"]').text()).toBe('Resposta enviada.');
      expect(w.find('[data-testid="pp-resposta-4"]').text()).toContain('Segue o laudo sintético.');
      expect(w.find('[data-testid="pp-resposta-anexo-4"]').attributes('href')).toBe(
        '/api/portal-prestador/protocolos/5/respostas/4/anexo',
      );
      w.unmount();
    });

    it('o complemento: arquivo acima de 2 MB barra o envio; a recusa do servidor aparece; a resposta com 2 arquivos passa', async () => {
      document.cookie = 'sgh_portal_prestador_csrf=csrf-sintetico';
      let tentativa = 0;
      const pendente = { ...pedido, situacao: 'pendente', situacaoRotulo: 'Aguardando complemento' };
      const pedidos = simular((u, init) => {
        if (u.endsWith('/sessao')) return sessao([3]);
        if (init?.method === 'POST' && u.endsWith('/autorizacoes/9/complemento'))
          return ++tentativa === 1
            ? problema(409, 'O pedido mudou desde que você abriu. Abra de novo e responda.')
            : {
                ok: true,
                id: 9,
                versao: 3,
                evento: 77,
                anexos: 2,
                mensagem: 'Complemento enviado ao auditor.',
              };
        if (u.includes('/autorizacoes/9'))
          return {
            ...pendente,
            itens: [],
            complemento: {
              pedido: 'Envie o exame de imagem e o relatório.',
              aguardando: tentativa < 2,
              respostas:
                tentativa < 2
                  ? []
                  : [
                      {
                        evento: 77,
                        em: '2026-10-27T10:00:00',
                        texto: 'Seguem os arquivos.',
                        anexos: [{ id: 501, nome: 'exame.png', tipo: 'image/png', tamanho: 4, sha256: 'cd' }],
                      },
                    ],
            },
          };
        if (u.includes('/autorizacoes')) return { itens: [pendente], proxima: null };
        return undefined;
      });
      const w = montar(PortalPrestadorPedidosTela);
      await flushPromises();
      await clicar(w, 'pp-abrir-9');
      expect(w.find('[data-testid="pp-complemento-pedido"]').text()).toContain('exame de imagem');
      await clicar(w, 'pp-complemento-responder');
      await escreverEm('pp-complemento-texto', 'Seguem os arquivos.');
      await anexar('pp-complemento-arquivo', [
        new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'grande.pdf', { type: 'application/pdf' }),
      ]);
      expect(w.find('[data-testid="pp-complemento-grande"]').text()).toContain('grande.pdf');
      expect(w.find('[data-testid="pp-complemento-enviar"]').attributes('disabled')).toBeDefined();
      await clicar(w, 'pp-complemento-tirar-0');
      await anexar('pp-complemento-arquivo', [
        new File(['\x89PNG'], 'exame.png', { type: 'image/png' }),
        new File(['%PDF-1.4'], 'relatorio.pdf', { type: 'application/pdf' }),
      ]);
      expect(w.find('[data-testid="pp-complemento-grande"]').exists()).toBe(false);
      await clicar(w, 'pp-complemento-enviar');
      await clicar(w, 'pp-complemento-confirmar');
      expect(w.find('[data-testid="pp-complemento-recusa"]').text()).toContain('O pedido mudou');
      const primeiro = pedidos.find((p) => p.init?.method === 'POST');
      const corpo = JSON.parse(String(primeiro?.init?.body)) as {
        versao: number;
        resposta: string;
        anexos: { nome: string }[];
      };
      expect(corpo.versao).toBe(1);
      expect(corpo.resposta).toBe('Seguem os arquivos.');
      expect(corpo.anexos.map((a) => a.nome)).toEqual(['exame.png', 'relatorio.pdf']);
      expect((primeiro?.init?.headers as Record<string, string>)['content-type']).toBe(
        'application/vnd.sgh.anexos+json',
      );
      await clicar(w, 'pp-complemento-enviar');
      await clicar(w, 'pp-complemento-confirmar');
      expect(w.find('[data-testid="pp-mensagem"]').text()).toBe('Complemento enviado ao auditor.');
      expect(w.find('[data-testid="pp-complemento-responder"]').exists()).toBe(false);
      expect(w.find('[data-testid="pp-complemento-anexo-501"]').attributes('href')).toBe(
        '/api/portal-prestador/autorizacoes/9/anexos/501',
      );
      w.unmount();
    });
  });

  describe('W0-10 (M7): elegibilidade', () => {
    const resultado = {
      carteirinha: '0000000000000001',
      data: '2026-11-18',
      elegivel: false,
      motivos: ['carteirinha-vencida'],
      beneficiario: { id: 5, nome: 'Beneficiária Sintética', situacao: 'ativo' },
      plano: {
        nome: 'Plano Sintético',
        registroAns: '900008',
        natureza: 'plano',
        segmentacao: 'ambulatorial',
        abrangencia: null,
        acomodacao: null,
      },
      carencias: [{ tipo: 'demais', cumpridaEm: '2026-12-01', cumprida: false }],
      validadeCarteirinha: '2026-11-01',
      carteirinhaVencida: true,
      cobertura: [
        { atendimento: 'consulta', cobertura: 'cobre' },
        { atendimento: 'sadt', cobertura: 'cobre' },
        { atendimento: 'internacao', cobertura: 'nao-cobre' },
        { atendimento: 'parto', cobertura: 'nao-cobre' },
      ],
      registro: 77,
    };
    it('consulta com o CSRF, mostra validade, carências, cobertura e o registro, e atualiza as últimas consultas', async () => {
      document.cookie = 'sgh_portal_prestador_csrf=csrf-sintetico';
      let consultou = false;
      const pedidos = simular((u, init) => {
        if (u.endsWith('/sessao')) return sessao([1]);
        if (init?.method === 'POST' && u.endsWith('/elegibilidade')) {
          consultou = true;
          return resultado;
        }
        if (u.endsWith('/elegibilidade'))
          return {
            itens: consultou
              ? [
                  {
                    id: 77,
                    carteirinha: resultado.carteirinha,
                    data: '2026-11-18',
                    elegivel: false,
                    motivos: ['carteirinha-vencida'],
                    em: '2026-11-18T09:30:00',
                  },
                ]
              : [],
          };
        return undefined;
      });
      const w = montar(PortalPrestadorElegibilidadeTela);
      await flushPromises();
      expect(w.find('[data-testid="portal-prestador-menu-elegibilidade"]').exists()).toBe(true);
      expect(w.find('[data-testid="pp-eleg-ultimas"]').text()).toContain('Nenhuma consulta ainda.');
      expect(w.find('[data-testid="pp-eleg-consultar"]').attributes('disabled')).toBeDefined();
      await w.find('[data-testid="pp-eleg-carteirinha"]').setValue(resultado.carteirinha);
      await w.find('[data-testid="pp-eleg-consultar"]').trigger('click');
      await flushPromises();
      const envio = pedidos.find((p) => p.init?.method === 'POST' && p.url.endsWith('/elegibilidade'));
      expect(JSON.parse(String(envio?.init?.body))).toEqual({ carteirinha: resultado.carteirinha });
      expect((envio?.init?.headers as Record<string, string>)['x-csrf-portal-prestador']).toBe(
        'csrf-sintetico',
      );
      const r = w.find('[data-testid="pp-eleg-resultado"]');
      expect(r.attributes('data-elegivel')).toBe('false');
      expect(r.text()).toContain('Não elegível em 18/11/2026.');
      expect(w.find('[data-testid="pp-eleg-motivos"]').text()).toContain('Carteirinha vencida');
      expect(w.find('[data-testid="pp-eleg-validade"]').text()).toContain(
        'Carteirinha vencida em 01/11/2026.',
      );
      expect(w.find('[data-testid="pp-eleg-carencias"]').text()).toContain('em curso até 01/12/2026');
      const cob = w.find('[data-testid="pp-eleg-cobertura"]').text();
      expect(cob).toContain('Consulta: coberto');
      expect(cob).toContain('Internação: não coberto');
      expect(w.find('[data-testid="pp-eleg-registro"]').text()).toContain('77');
      expect(w.find('[data-testid="pp-eleg-linha-77"]').text()).toContain('Não elegível');
      w.unmount();
    });
  });

  describe('W0-10 (M8): contas (lote XML TISS)', () => {
    const lote = (id: number, demonstrativo: boolean, paga = false) => ({
      id,
      protocolo: `2026111800000${id}`,
      operadora: 1,
      prestador: 21,
      prestadorNome: 'Clínica Sintética',
      numeroLote: `L${id}`,
      tipoGuia: 'sp-sadt',
      competencia: '2026-11',
      guias: 2,
      recebidaEm: '2026-11-18T09:00:00',
      prazoPagamento: '2026-12-18',
      vencida: false,
      situacao: paga ? 'paga' : demonstrativo ? 'analisada' : 'recebida',
      recursosPendentes: 0,
      apresentado: 150.5,
      glosado: 10,
      acatado: 0,
      liberado: 140.5,
      pago: 0,
      saldo: 140.5,
      versao: 1,
      demonstrativo,
      demonstrativoPagamento: paga,
    });
    it('recusa arquivo que não é XML, envia com confirmação e CSRF (bytes em base64), lista e baixa o demonstrativo', async () => {
      document.cookie = 'sgh_portal_prestador_csrf=csrf-sintetico';
      let enviou = false;
      let xsdInvalido = true;
      const pedidos = simular((u, init) => {
        if (u.endsWith('/sessao')) return sessao([1]);
        if (init?.method === 'POST' && u.endsWith('/contas') && xsdInvalido) {
          xsdInvalido = false;
          return new Response(
            JSON.stringify({
              title: 'Operação recusada',
              detail: 'O arquivo não passou no XSD da TISS 04.03.00.',
              codigo: 'xsd-invalido',
              avisos: ['Linha 12: falta o elemento CNES.'],
            }),
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        if (init?.method === 'POST' && u.endsWith('/contas')) {
          enviou = true;
          return {
            ok: true,
            id: 31,
            versao: 1,
            situacao: 'recebida',
            protocolo: '202611180000031',
            mensagem: 'Lote recebido.',
            avisos: [],
          };
        }
        if (u.endsWith('/contas/30/demonstrativo'))
          return { nome: 'demonstrativo-30.xml', xmlBase64: btoa('<x/>'), hash: 'h' };
        if (u.endsWith('/contas/29/demonstrativo-pagamento'))
          return { nome: 'demonstrativo-pagamento-29.xml', xmlBase64: btoa('<x/>'), hash: 'h' };
        if (u.includes('/contas'))
          return {
            itens: enviou
              ? [lote(31, false), lote(30, true), lote(29, true, true)]
              : [lote(30, true), lote(29, true, true)],
            proxima: null,
          };
        return undefined;
      });
      const criar = vi.fn(() => 'blob:sintetico');
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: criar, revokeObjectURL: vi.fn() }));
      const w = montar(PortalPrestadorContasTela);
      await flushPromises();
      expect(w.find('[data-testid="portal-prestador-menu-contas"]').exists()).toBe(true);
      expect(w.find('[data-testid="pp-contas-linha-30"]').text()).toContain('Liberada para pagamento');
      expect(w.find('[data-testid="pp-contas-enviar"]').attributes('disabled')).toBeDefined();

      const campo = w.find('[data-testid="pp-contas-arquivo"]');
      const trocar = async (f: File) => {
        Object.defineProperty(campo.element, 'files', { value: [f], configurable: true });
        await campo.trigger('change');
      };
      await trocar(new File(['x'], 'lote.pdf', { type: 'application/pdf' }));
      expect(w.text()).toContain('Escolha um arquivo .xml.');
      expect(w.find('[data-testid="pp-contas-enviar"]').attributes('disabled')).toBeDefined();

      // A recusa do schema mostra o motivo e o que o XSD apontou (não a mensagem genérica).
      await trocar(new File(['<ruim/>'], 'ruim.xml', { type: 'application/xml' }));
      await w.find('[data-testid="pp-contas-enviar"]').trigger('click');
      await w.find('[data-testid="pp-contas-confirmar"]').trigger('click');
      await flushPromises();
      expect(w.find('[data-testid="pp-contas-recusa"]').text()).toContain('XSD da TISS 04.03.00');
      expect(w.find('[data-testid="pp-contas-erros-xsd"]').text()).toContain('falta o elemento CNES');
      expect(w.find('[data-testid="mensagem-erro"]').exists()).toBe(false);
      expect(w.find('[data-testid="pp-contas-recebido"]').exists()).toBe(false);

      await trocar(new File(['<lote/>'], 'lote.xml', { type: 'application/xml' }));
      expect(w.find('[data-testid="pp-contas-recusa"]').exists()).toBe(false);
      await w.find('[data-testid="pp-contas-enviar"]').trigger('click');
      expect(w.find('[data-testid="pp-contas-confirma"]').text()).toContain('Enviar o lote lote.xml?');
      expect(pedidos.filter((p) => p.init?.method === 'POST')).toHaveLength(1);
      await w.find('[data-testid="pp-contas-confirmar"]').trigger('click');
      await flushPromises();
      const envio = pedidos.filter((p) => p.init?.method === 'POST' && p.url.endsWith('/contas'))[1];
      expect(JSON.parse(String(envio?.init?.body))).toEqual({ arquivo: btoa('<lote/>'), nome: 'lote.xml' });
      expect((envio?.init?.headers as Record<string, string>)['x-csrf-portal-prestador']).toBe(
        'csrf-sintetico',
      );
      expect(w.find('[data-testid="pp-contas-recebido"]').text()).toContain('202611180000031');
      expect(w.find('[data-testid="pp-contas-linha-31"]').exists()).toBe(true);
      expect(w.find('[data-testid="pp-contas-demonstrativo-31"]').exists()).toBe(false);

      await w.find('[data-testid="pp-contas-demonstrativo-30"]').trigger('click');
      await flushPromises();
      expect(pedidos.some((p) => p.url.endsWith('/contas/30/demonstrativo'))).toBe(true);
      expect(criar).toHaveBeenCalledTimes(1);
      // W0-10 (M8): o demonstrativo de pagamento só no lote pago.
      expect(w.find('[data-testid="pp-contas-demonstrativo-pagamento-30"]').exists()).toBe(false);
      await w.find('[data-testid="pp-contas-demonstrativo-pagamento-29"]').trigger('click');
      await flushPromises();
      expect(pedidos.some((p) => p.url.endsWith('/contas/29/demonstrativo-pagamento'))).toBe(true);
      expect(criar).toHaveBeenCalledTimes(2);
      w.unmount();
    });

    it('recurso de glosa por item: marca os itens, valor até o glosado, justificativas, confirmação e a decisão de cada item', async () => {
      document.cookie = 'sgh_portal_prestador_csrf=csrf-sintetico';
      let recorreu = false;
      const item = (id: number, glosado: number, recurso: unknown = null) => ({
        id,
        codigo: `1010101${id}`,
        descricao: `Procedimento sintético ${id}`,
        apresentado: 50,
        glosado,
        motivo: 1801,
        motivoNome: 'Procedimento não autorizado',
        justificativa: 'Sem autorização prévia.',
        recurso,
      });
      const recursoDe = (id: number, item: number, valor: number, decisao: unknown) => ({
        id,
        item,
        valor,
        justificativa: 'O procedimento foi autorizado por telefone.',
        em: '2026-11-19T10:00:00',
        por: 'SGH.PORTAL.PRESTADOR',
        decisao,
      });
      const glosas = () => ({
        id: 30,
        versao: recorreu ? 5 : 4,
        protocolo: '202611180000030',
        numeroLote: 'L30',
        situacao: 'analisada',
        podeRecorrer: true,
        guias: [
          {
            id: 300,
            numeroGuiaPrestador: 'G-300',
            apresentado: 100,
            glosado: 30,
            acatado: 0,
            recurso: recorreu
              ? {
                  situacao: 'pendente',
                  valor: 15,
                  justificativa: 'Recurso da guia sintética.',
                  parecer: null,
                }
              : null,
            recorrivel: !recorreu,
            itens: [item(501, 20, recorreu ? recursoDe(9, 501, 15, null) : null), item(502, 10)],
          },
          {
            id: 301,
            numeroGuiaPrestador: 'G-301',
            apresentado: 40,
            glosado: 40,
            acatado: 25,
            recurso: { situacao: 'parcial', valor: 40, justificativa: 'x', parecer: 'Acatado em parte.' },
            recorrivel: false,
            itens: [
              item(
                503,
                40,
                recursoDe(8, 503, 40, {
                  decisao: 'parcial',
                  valorAcatado: 25,
                  parecer: 'Parte comprovada.',
                  em: '2026-11-19T11:00:00',
                  por: 'AUDITOR',
                }),
              ),
            ],
          },
        ],
      });
      const pedidos = simular((u, init) => {
        if (u.endsWith('/sessao')) return sessao([1]);
        if (init?.method === 'POST' && u.endsWith('/contas/30/recursos')) {
          recorreu = true;
          return {
            ok: true,
            id: 30,
            versao: 5,
            situacao: 'analisada',
            protocolo: '202611180000030',
            mensagem: 'ok',
            avisos: [],
          };
        }
        if (u.endsWith('/contas/30/glosas')) return glosas();
        if (u.includes('/contas')) return { itens: [lote(30, true), lote(31, false)], proxima: null };
        return undefined;
      });
      const w = montar(PortalPrestadorContasTela);
      await flushPromises();
      // O lote ainda recebido não tem recurso; o analisado abre o painel.
      expect(w.find('[data-testid="pp-contas-recurso-31"]').exists()).toBe(false);
      await w.find('[data-testid="pp-contas-recurso-30"]').trigger('click');
      await flushPromises();
      const painel = () => w.find('[data-testid="pp-contas-recurso-painel-30"]');
      expect(painel().text()).toContain('Glosas do lote L30');
      // A guia já recorrida mostra a decisão de cada item e não aceita outro recurso.
      expect(w.find('[data-testid="pp-recurso-item-503-recurso"]').text()).toContain('Acatado R$');
      expect(w.find('[data-testid="pp-recurso-item-503-recurso"]').text()).toContain('Parte comprovada.');
      expect(w.find('[data-testid="pp-recurso-marca-503"]').exists()).toBe(false);
      expect(w.find('[data-testid="pp-recurso-recorrer-301"]').exists()).toBe(false);

      const recorrer = () => w.find('[data-testid="pp-recurso-recorrer-300"]');
      expect(recorrer().attributes('disabled')).toBeDefined();
      await w.find('[data-testid="pp-recurso-marca-501"]').setValue(true);
      // Valor acima do glosado (20) não passa.
      await w.find('#pp-recurso-valor-501').setValue('25');
      await w.find('#pp-recurso-justificativa-501').setValue('O procedimento foi autorizado por telefone.');
      await w.find('#pp-recurso-justificativa-guia-300').setValue('Recurso da guia sintética.');
      expect(recorrer().attributes('disabled')).toBeDefined();
      expect(painel().text()).toContain('Marque ao menos um item');
      await w.find('#pp-recurso-valor-501').setValue('15');
      expect(recorrer().attributes('disabled')).toBeUndefined();
      await recorrer().trigger('click');
      expect(w.find('[data-testid="pp-recurso-confirma-300"]').text()).toContain('1 item(ns) da guia G-300');
      expect(w.find('[data-testid="pp-recurso-confirma-300"]').text()).toContain('15,00');
      expect(pedidos.some((p) => p.init?.method === 'POST')).toBe(false);
      await w.find('[data-testid="pp-recurso-confirmar-300"]').trigger('click');
      await flushPromises();
      const envio = pedidos.find((p) => p.init?.method === 'POST' && p.url.endsWith('/contas/30/recursos'));
      expect(JSON.parse(String(envio?.init?.body))).toEqual({
        versao: 4,
        guia: 300,
        itens: [{ item: 501, valor: 15, justificativa: 'O procedimento foi autorizado por telefone.' }],
        justificativa: 'Recurso da guia sintética.',
      });
      expect((envio?.init?.headers as Record<string, string>)['x-csrf-portal-prestador']).toBe(
        'csrf-sintetico',
      );
      expect(w.find('[data-testid="pp-contas-recurso-enviado"]').text()).toContain(
        'Recurso da guia G-300 enviado.',
      );
      expect(w.find('[data-testid="pp-recurso-item-501-recurso"]').text()).toContain('Aguardando a decisão');
      expect(w.find('[data-testid="pp-recurso-guia-300-situacao"]').text()).toContain('Recurso pendente');
      expect(w.find('[data-testid="pp-recurso-recorrer-300"]').exists()).toBe(false);
      await w.find('[data-testid="pp-contas-recurso-fechar"]').trigger('click');
      expect(painel().exists()).toBe(false);
      w.unmount();
    });
  });
});
