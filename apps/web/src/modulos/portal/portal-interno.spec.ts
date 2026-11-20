// @vitest-environment jsdom
// Telas internas do portal do paciente (M50, etapa 1; correção da revisão do M50.1): a conferência dos responsáveis
// busca pelo prontuário do representado e carrega a página seguinte pelo cursor (nenhum vínculo fora de alcance); a
// ficha do paciente lista os responsáveis vigentes e encerra o acesso de um deles com a justificativa e a senha. Dados
// SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import ContaPortalPaciente from './componentes/ContaPortalPaciente.vue';
import ConferenciaVinculosTela from './telas/ConferenciaVinculosTela.vue';
import CopiasProntuarioTela from './telas/CopiasProntuarioTela.vue';
import PortalCopiaTela from './telas/PortalCopiaTela.vue';
import PortalOuvidoriaTela from './telas/PortalOuvidoriaTela.vue';
import PortalPacienteInternoTela from './telas/PortalPacienteInternoTela.vue';
import PortalPrivacidadeTela from './telas/PortalPrivacidadeTela.vue';
import TesourariaPortalTela from './telas/TesourariaPortalTela.vue';

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
const montar = (c: unknown, props: Record<string, unknown> = {}) =>
  mount(c as never, {
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

const vinculo = (id: number, nome: string, situacao = 'ativo') => ({
  vinculo: String(id),
  tipo: 'pai-mae',
  prova: 'certidao-nascimento',
  situacao,
  escopos: ['documentos'],
  pedidoEm: '2026-10-20T12:00:00.000Z',
  decididoEm: situacao === 'pendente' ? null : '2026-10-21T12:00:00.000Z',
  validade: null,
  terminaEm: null,
  motivoFim: null,
  primeiroNomeOutro: 'Filho',
  prontuarioTitular: 950_002,
  idadeTitular: 10,
  responsavelConta: '7',
  primeiroNomeResponsavel: nome,
  diasNaFila: 1,
  canal: 'portal',
  temArquivo: false,
  guardiao: null,
  curatelado: false,
  motivoRecusa: null,
});

type Rota = (url: string, init?: RequestInit) => unknown;
function simular(rota: Rota) {
  const chamadas: { url: string; metodo: string; corpo: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({
        url: String(url),
        metodo: init?.method ?? 'GET',
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const r = rota(String(url), init);
      if (r instanceof Response) return r;
      if (r === null) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(r), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return chamadas;
}

afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
});

describe('conferência dos responsáveis: busca e páginas', () => {
  it('busca pelo prontuário do representado e carrega a página seguinte pelo cursor', async () => {
    const chamadas = simular((url) => {
      const q = new URL(url, 'http://x').searchParams;
      if (q.get('prontuario') === '950002') return { itens: [vinculo(9, 'Achada')], proximo: null };
      if (q.get('depoisDe') === '1') return { itens: [vinculo(2, 'Segunda')], proximo: null };
      return { itens: [vinculo(1, 'Primeira')], proximo: '1' };
    });
    const w = montar(ConferenciaVinculosTela);
    await flushPromises();
    expect(w.get('[data-testid="conf-fila"]').text()).toContain('Primeira');
    await w.get('[data-testid="conf-mais"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="conf-fila"]').text()).toContain('Segunda');
    expect(w.get('[data-testid="conf-fila"]').text()).toContain('Primeira');
    expect(w.find('[data-testid="conf-mais"]').exists()).toBe(false);
    await w.get('[data-testid="conf-busca"]').setValue('950.002');
    await w.get('form.conf-busca').trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="conf-fila"]').text()).toContain('Achada');
    expect(w.get('[data-testid="conf-fila"]').text()).not.toContain('Primeira');
    expect(chamadas.some((c) => c.url.includes('situacao=pendente&prontuario=950002'))).toBe(true);
  });
});

describe('ficha do paciente: responsáveis vigentes', () => {
  it('lista os vigentes e encerra o acesso de um deles com a justificativa e a senha', async () => {
    definirSessaoDaTela({ permissoes: ['portal.conta.ler', 'portal.vinculo.conferir'] } as never);
    let encerrado = false;
    const chamadas = simular((url, init) => {
      if (url.endsWith('/pacientes/2/conta')) return { conta: null, ligado: true };
      if (url.endsWith('/pacientes/2/responsaveis')) return encerrado ? [] : [vinculo(5, 'Mae')];
      if (url.endsWith('/vinculos/5/encerramento') && init?.method === 'POST') {
        encerrado = true;
        return null;
      }
      return {};
    });
    const w = montar(ContaPortalPaciente, { idPaciente: 2 });
    await flushPromises();
    expect(w.get('[data-testid="conta-portal-responsavel-5"]').text()).toContain('Mae');
    await w.get('[data-testid="conta-portal-encerrar-vinculo-5"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="conta-portal-form"] textarea').setValue('perda da guarda, teste sintético');
    await w.get('[data-testid="conta-portal-senha"]').setValue('senha-sintetica');
    await w.get('[data-testid="conta-portal-form"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.url.endsWith('/vinculos/5/encerramento'));
    expect(post?.corpo).toEqual({
      motivo: 'revogado-pelo-hospital',
      justificativa: 'perda da guarda, teste sintético',
      senha: 'senha-sintetica',
    });
    expect(w.get('[data-testid="conta-portal-responsaveis"]').text()).toContain(
      'Nenhum responsável com acesso ou pedido em conferência.',
    );
  });

  it('sem portal.vinculo.conferir, a lista não aparece nem é pedida', async () => {
    definirSessaoDaTela({ permissoes: ['portal.conta.ler'] } as never);
    const chamadas = simular((url) => (url.endsWith('/conta') ? { conta: null, ligado: true } : []));
    const w = montar(ContaPortalPaciente, { idPaciente: 2 });
    await flushPromises();
    expect(w.find('[data-testid="conta-portal-responsaveis"]').exists()).toBe(false);
    expect(chamadas.some((c) => c.url.includes('/responsaveis'))).toBe(false);
  });
});

describe('W0-10: ficha do paciente troca o e-mail e redefine o segundo fator', () => {
  const conta = {
    conta: '9',
    situacao: 'ativa',
    emailMascarado: 'j***@portal.test',
    segundoFator: true,
    criadaEm: '2026-10-20T12:00:00.000Z',
    ativadaEm: '2026-10-20T12:00:00.000Z',
    ultimoAcessoEm: null,
    bloqueadaAte: null,
    motivo: null,
    responsaveis: 0,
  };
  it('troca o e-mail com motivo, justificativa e senha; mostra a troca pendente e a cancela', async () => {
    definirSessaoDaTela({ permissoes: ['portal.conta.ler', 'portal.conta.trocarEmail'] } as never);
    let pendente: unknown = null;
    const chamadas = simular((url, init) => {
      if (url.endsWith('/pacientes/2/conta')) return { conta, ligado: true };
      if (url.endsWith('/contas/9/email/troca')) return { troca: pendente };
      if (url.endsWith('/contas/9/email') && init?.method === 'POST') {
        pendente = {
          envio: 'simulador',
          emailMascarado: 'n***@portal.test',
          validoAte: '2026-11-19T12:00:00.000Z',
          origem: 'balcao',
        };
        return pendente;
      }
      if (url.endsWith('/email/troca/cancelamento')) {
        pendente = null;
        return null;
      }
      return {};
    });
    const w = montar(ContaPortalPaciente, { idPaciente: 2 });
    await flushPromises();
    await w.get('[data-testid="conta-portal-trocar-email"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="conta-portal-email-novo"]').setValue('novo@portal.test');
    await w.get('[data-testid="conta-portal-form"] textarea').setValue('perdeu o e-mail, teste sintético');
    await w.get('[data-testid="conta-portal-senha"]').setValue('senha-sintetica');
    await w.get('[data-testid="conta-portal-form"]').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.url.endsWith('/contas/9/email'))?.corpo).toEqual({
      email: 'novo@portal.test',
      motivo: 'email-perdido',
      justificativa: 'perdeu o e-mail, teste sintético',
      senha: 'senha-sintetica',
    });
    expect(w.get('[data-testid="conta-portal-troca"]').text()).toContain('n***@portal.test');
    await w.get('[data-testid="conta-portal-cancelar-troca"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="conta-portal-senha"]').setValue('senha-sintetica');
    await w.get('[data-testid="conta-portal-form"]').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.url.endsWith('/cancelamento'))?.corpo).toEqual({
      senha: 'senha-sintetica',
    });
    expect(w.find('[data-testid="conta-portal-troca"]').exists()).toBe(false);
  });

  it('redefine o segundo fator com o motivo e mostra o convite novo para imprimir', async () => {
    definirSessaoDaTela({ permissoes: ['portal.conta.ler', 'portal.conta.bloquear'] } as never);
    const chamadas = simular((url, init) => {
      if (url.endsWith('/pacientes/2/conta')) return { conta, ligado: true };
      if (url.endsWith('/contas/9/email/troca')) return { troca: null };
      if (url.endsWith('/segundo-fator/redefinicao') && init?.method === 'POST')
        return {
          conta: { ...conta, situacao: 'convidada', segundoFator: false },
          convite: {
            conta: '9',
            codigo: 'ABCD-EFGH-JKLM',
            validoAte: '2026-11-21T12:00:00.000Z',
            destino: 'memoria',
          },
        };
      return {};
    });
    const w = montar(ContaPortalPaciente, { idPaciente: 2 });
    await flushPromises();
    expect(w.find('[data-testid="conta-portal-trocar-email"]').exists()).toBe(false);
    await w.get('[data-testid="conta-portal-redefinir"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="conta-portal-form"] textarea').setValue('celular roubado, teste sintético');
    await w.get('[data-testid="conta-portal-senha"]').setValue('senha-sintetica');
    await w.get('[data-testid="conta-portal-form"]').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.url.endsWith('/segundo-fator/redefinicao'))?.corpo).toEqual({
      motivo: 'aparelho-perdido',
      justificativa: 'celular roubado, teste sintético',
      senha: 'senha-sintetica',
    });
    expect(w.get('[data-testid="conta-portal-codigo"]').text()).toBe('ABCD-EFGH-JKLM');
  });
});

describe('W0-10: tesouraria das cobranças do portal', () => {
  const pag = (situacao: string, atos: unknown[] = []) => ({
    id: '31',
    tipo: 'consulta',
    marcacao: '900',
    paciente: '4242',
    valor: 150,
    forma: 'pix',
    conector: 'simulado',
    transacao: 'SIM-PIX-ABC',
    situacaoCobranca: 'confirmado',
    confirmadoEm: '2026-11-18T10:00:00.000',
    cobradoPor: 'SGH.PORTAL',
    situacao,
    atos,
  });
  const clicar = async (w: ReturnType<typeof montar>, id: string) => {
    await w.find(`[data-testid="${id}"]`).trigger('click');
    await flushPromises();
  };

  it('concilia com o painel de confirmação e estorna com motivo e senha; cada ação só depois de confirmar', async () => {
    definirSessaoDaTela({ permissoes: ['portal.pagamento.conciliar', 'portal.pagamento.estornar'] } as never);
    let estado = pag('a-conciliar');
    const chamadas = simular((url, init) => {
      if (url.includes('/conciliacao') && init?.method === 'POST') {
        estado = pag('conciliado', [
          {
            id: '1',
            acao: 'conciliado',
            valor: 150,
            referencia: 'EXT-1',
            motivo: null,
            usuario: 'ANA',
            em: null,
          },
        ]);
        return estado;
      }
      if (url.includes('/estorno') && init?.method === 'POST') {
        estado = pag('estornado', [
          ...estado.atos,
          {
            id: '2',
            acao: 'estorno',
            valor: 150,
            referencia: 'SIM-EST-1',
            motivo: 'dobro',
            usuario: 'BIA',
            em: null,
          },
        ]);
        return estado;
      }
      return { itens: [estado], estornoDisponivel: true };
    });
    const w = montar(TesourariaPortalTela);
    await flushPromises();
    expect(w.find('[data-testid="tes-situacao-31"]').text()).toBe('A conciliar');
    await clicar(w, 'tes-conciliar-31');
    await w.find('[data-testid="tes-referencia"] input').setValue('EXT-1');
    await clicar(w, 'tes-seguir');
    // Nada gravado antes da confirmação.
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);
    expect(w.find('[data-testid="tes-pergunta"]').text()).toContain('não se desfaz');
    await clicar(w, 'tes-confirmar');
    const conc = chamadas.find((c) => c.url.endsWith('/tesouraria/portal/pagamentos/31/conciliacao'));
    expect(conc?.corpo).toEqual({ acao: 'conciliado', valor: 150, referencia: 'EXT-1' });
    expect(w.find('[data-testid="tes-feito"]').text()).toContain('Baixa registrada');
    // Depois da baixa: só o estorno.
    expect(w.find('[data-testid="tes-conciliar-31"]').exists()).toBe(false);
    await clicar(w, 'tes-estornar-31');
    await w.find('[data-testid="tes-motivo"] input').setValue('cobrança em dobro');
    await w.find('[data-testid="tes-senha"]').setValue('segredo');
    await clicar(w, 'tes-seguir');
    await clicar(w, 'tes-confirmar');
    const est = chamadas.find((c) => c.url.endsWith('/pagamentos/31/estorno'));
    expect(est?.corpo).toEqual({ motivo: 'cobrança em dobro', senha: 'segredo' });
    expect(w.find('[data-testid="tes-situacao-31"]').text()).toBe('Estornado');
    expect(w.find('[data-testid="tes-estornar-31"]').exists()).toBe(false);
  });

  it('a recusa por segregação de funções (quem conciliou não estorna) aparece com o texto da tesouraria, não como conflito de versão', async () => {
    definirSessaoDaTela({ permissoes: ['portal.pagamento.conciliar', 'portal.pagamento.estornar'] } as never);
    simular((url, init) =>
      url.includes('/estorno') && init?.method === 'POST'
        ? new Response(
            JSON.stringify({
              type: 'about:blank',
              title: 'Segregação de funções',
              status: 409,
              detail: 'Quem conciliou o pagamento não pode estorná-lo.',
              codigo: 'segregacao',
            }),
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          )
        : { itens: [pag('conciliado')], estornoDisponivel: true },
    );
    const w = montar(TesourariaPortalTela);
    await flushPromises();
    await clicar(w, 'tes-estornar-31');
    await w.find('[data-testid="tes-motivo"] input').setValue('tentativa de quem conciliou');
    await w.find('[data-testid="tes-senha"]').setValue('segredo');
    await clicar(w, 'tes-seguir');
    await clicar(w, 'tes-confirmar');
    expect(w.find('[data-testid="tes-recusa"]').text()).toContain('quem conciliou não estorna');
    expect(w.text()).not.toContain('alterado por outra pessoa');
    expect(w.find('[data-testid="tes-situacao-31"]').text()).toBe('Conciliado');
  });

  it('sem portal.pagamento.estornar, ou sem gateway, o botão do estorno não aparece', async () => {
    definirSessaoDaTela({ permissoes: ['portal.pagamento.conciliar'] } as never);
    simular(() => ({ itens: [pag('conciliado')], estornoDisponivel: true }));
    const w = montar(TesourariaPortalTela);
    await flushPromises();
    expect(w.find('[data-testid="tes-estornar-31"]').exists()).toBe(false);
    definirSessaoDaTela({ permissoes: ['portal.pagamento.conciliar', 'portal.pagamento.estornar'] } as never);
    simular(() => ({ itens: [pag('conciliado')], estornoDisponivel: false }));
    const w2 = montar(TesourariaPortalTela);
    await flushPromises();
    expect(w2.find('[data-testid="tes-estornar-31"]').exists()).toBe(false);
    expect(w2.text()).toContain('depende do contrato do gateway');
  });
});

describe('W0-10 (M1): ouvidoria pelo portal', () => {
  const sessao = {
    hospital: 'aa',
    primeiroNome: 'José',
    ativo: {
      vinculo: null,
      primeiroNome: 'José',
      idade: 68,
      escopos: ['documentos', 'consentimentos', 'pedidos', 'agendamentos'],
    },
    titulares: [],
    expiraEm: '2026-11-18T13:00:00.000Z',
    soResponsavel: false,
  };
  const item = (protocolo: string, situacao: string, resposta: string | null) => ({
    protocolo,
    tipo: 'reclamacao',
    area: 'Ouvidoria',
    relato: 'Demora no atendimento da recepção.',
    recebidaEm: '2026-11-18T09:00:00',
    prazoEm: '2026-12-02T23:59:59',
    situacao,
    resposta,
    respondidaEm: resposta ? '2026-11-19T10:00:00' : null,
  });

  it('mostra o protocolo e a resposta; a nova manifestação só vai depois da confirmação', async () => {
    let lista = [item('OUV-2026-000010', 'respondida', 'Reforçamos a equipe da recepção.')];
    const chamadas = simular((url, init) => {
      if (url.endsWith('/paciente/eu')) return sessao;
      if (url.endsWith('/paciente/manifestacoes') && init?.method === 'POST') {
        lista = [item('OUV-2026-000011', 'aberta', null), ...lista];
        return { protocolo: 'OUV-2026-000011', prazoEm: '2026-12-02T23:59:59' };
      }
      if (url.endsWith('/paciente/manifestacoes')) return lista;
      return null;
    });
    const w = montar(PortalOuvidoriaTela);
    await flushPromises();
    await flushPromises();
    const linha = w.find('[data-testid="pac-manifestacao-OUV-2026-000010"]');
    expect(linha.text()).toContain('Respondida');
    expect(linha.text()).toContain('Reforçamos a equipe da recepção.');
    const sel = w.findComponent({ name: 'SanteSelecao' });
    sel.vm.$emit('update:modelValue', 'sugestao');
    await w
      .find('[data-testid="pac-relato-manifestacao"] textarea')
      .setValue('Mais cadeiras na sala de espera.');
    await w.find('[data-testid="pac-revisar-manifestacao"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="pac-pergunta-manifestacao"]').text()).toContain('não se altera');
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);
    await w.find('[data-testid="pac-enviar-manifestacao"]').trigger('click');
    await flushPromises();
    const post = chamadas.filter((c) => c.metodo === 'POST');
    expect(post).toHaveLength(1);
    expect(post[0]?.corpo).toEqual({
      tipo: 'sugestao',
      area: null,
      relato: 'Mais cadeiras na sala de espera.',
    });
    expect(w.find('[data-testid="pac-manifestacao-enviada"]').text()).toContain('OUV-2026-000011');
    await flushPromises();
    expect(w.find('[data-testid="pac-manifestacao-OUV-2026-000011"]').text()).toContain('Recebida');
  });
});

describe('W0-10 (M2): cópia do prontuário', () => {
  const sessao = (escopos: string[]) => ({
    hospital: 'aa',
    primeiroNome: 'José',
    ativo: { vinculo: null, primeiroNome: 'José', idade: 68, escopos },
    titulares: [],
    expiraEm: '2026-11-18T13:00:00.000Z',
    soResponsavel: false,
  });
  const copia = (protocolo: string, etapa: string, baixavel = false) => ({
    protocolo,
    situacao: etapa === 'entregue' ? 'atendido' : 'aberto',
    etapa,
    solicitante: 'titular',
    abertoEm: '2026-11-18T09:00:00',
    prazo: '2026-12-03T09:00:00',
    atrasado: false,
    entregueEm: etapa === 'entregue' ? '2026-11-20T10:00:00' : null,
    meio: etapa === 'entregue' ? 'portal' : null,
    baixavel,
  });
  const naFila = (etapa: string, geracoes = 0) => ({
    protocolo: 'LGPD-2026-000020',
    situacao: 'aberto',
    canal: 'portal',
    paciente: 4242,
    prontuario: 950_002,
    abertoEm: '2026-11-18T09:00:00',
    prazo: '2026-12-03T09:00:00',
    atrasado: false,
    solicitante: 'titular',
    vinculo: null,
    etapa,
    geracoes,
  });
  const clicar = async (w: ReturnType<typeof montar>, id: string) => {
    await w.find(`[data-testid="${id}"]`).trigger('click');
    await flushPromises();
  };

  it('portal: lista a etapa e o PDF entregue; o pedido novo só vai depois da confirmação', async () => {
    let lista = [copia('LGPD-2026-000010', 'entregue', true)];
    const chamadas = simular((url, init) => {
      if (url.endsWith('/paciente/eu')) return sessao(['documentos']);
      if (url.endsWith('/paciente/copias') && init?.method === 'POST') {
        lista = [copia('LGPD-2026-000011', 'aguardando-conferencia'), ...lista];
        return { protocolo: 'LGPD-2026-000011', prazo: '2026-12-03T09:00:00' };
      }
      if (url.endsWith('/paciente/copias')) return lista;
      return null;
    });
    const w = montar(PortalCopiaTela);
    await flushPromises();
    await flushPromises();
    const linha = w.find('[data-testid="pac-copia-LGPD-2026-000010"]');
    expect(linha.text()).toContain('Entregue');
    expect(w.find('[data-testid="pac-copia-baixar-LGPD-2026-000010"]').attributes('href')).toContain(
      '/copias/LGPD-2026-000010/pdf',
    );
    await w.find('[data-testid="pac-copia-observacao"] textarea').setValue('Para a segunda opinião.');
    await clicar(w, 'pac-copia-revisar');
    expect(w.find('[data-testid="pac-copia-pergunta"]').text()).toContain('não se altera');
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);
    await clicar(w, 'pac-copia-pedir');
    const post = chamadas.filter((c) => c.metodo === 'POST');
    expect(post).toHaveLength(1);
    expect(post[0]?.corpo).toEqual({ observacao: 'Para a segunda opinião.' });
    expect(w.find('[data-testid="pac-copia-feito"]').text()).toContain('LGPD-2026-000011');
    await flushPromises();
    expect(w.find('[data-testid="pac-copia-LGPD-2026-000011"]').text()).toContain('Aguardando a conferência');
  });

  it('portal: ao voltar à tela, lê a lista de novo (a entrega feita pelo hospital aparece, mesmo com o cache novo)', async () => {
    let lista: ReturnType<typeof copia>[] = [];
    simular((url) => {
      if (url.endsWith('/paciente/eu')) return sessao(['documentos']);
      if (url.endsWith('/paciente/copias')) return lista;
      return null;
    });
    // O mesmo cliente nas duas montagens, com o staleTime do app (15 s): sem o refetch na montagem, a lista vazia
    // da primeira visita voltaria do cache.
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });
    const abrir = () =>
      mount(PortalCopiaTela as never, {
        global: {
          plugins: [
            criarI18n(mensagensWeb as unknown as Record<string, unknown>),
            ui,
            [VueQueryPlugin, { queryClient: cliente }],
          ] as never,
          stubs: { RouterLink: { template: '<a><slot /></a>' } },
        },
      });
    const w1 = abrir();
    await flushPromises();
    await flushPromises();
    expect(w1.find('[data-testid="pac-copias-tabela"]').exists()).toBe(false);
    w1.unmount();
    lista = [copia('LGPD-2026-000012', 'entregue', true)];
    const w2 = abrir();
    await flushPromises();
    await flushPromises();
    expect(w2.find('[data-testid="pac-copia-LGPD-2026-000012"]').text()).toContain('Entregue');
  });

  it('portal: sem o escopo de documentos, o representante não pede a cópia', async () => {
    simular((url) => (url.endsWith('/paciente/eu') ? sessao(['consentimentos']) : []));
    const w = montar(PortalCopiaTela);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="pac-copia-sem-escopo"]').exists()).toBe(true);
    expect(w.find('[data-testid="pac-nova-copia"]').exists()).toBe(false);
  });

  it('balcão: legitimidade e entrega com senha, geração com hash; cada ação só depois de confirmar', async () => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:copia', revokeObjectURL: () => undefined }),
    );
    let estado = naFila('aguardando-conferencia');
    const chamadas = simular((url, init) => {
      if (url.endsWith('/legitimidade')) {
        estado = naFila('legitimidade-conferida');
        return null;
      }
      if (url.endsWith('/geracao')) {
        estado = naFila('gerada', 1);
        return new Response(new Blob(['%PDF-1.4']), {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'x-copia-sha256': 'abc123', 'x-copia-paginas': '3' },
        });
      }
      if (url.endsWith('/entrega')) {
        estado = { ...naFila('entregue', 1), situacao: 'atendido' };
        return null;
      }
      if (url.includes('/copias?') && (init?.method ?? 'GET') === 'GET') return [estado];
      return null;
    });
    const w = montar(CopiasProntuarioTela);
    await flushPromises();
    const p = 'LGPD-2026-000020';
    expect(w.find(`[data-testid="cop-etapa-${p}"]`).text()).toContain('Aguardando');
    await clicar(w, `cop-legitimidade-${p}`);
    await w.find('[data-testid="cop-prova"] input').setValue('RG conferido');
    await w.find('[data-testid="cop-senha"]').setValue('segredo');
    await clicar(w, 'cop-seguir');
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);
    await clicar(w, 'cop-confirmar');
    const leg = chamadas.find((c) => c.url.endsWith(`/copias/${p}/legitimidade`));
    expect(leg?.corpo).toEqual({
      solicitante: 'titular',
      vinculo: null,
      prova: 'RG conferido',
      senha: 'segredo',
    });
    await flushPromises();
    await clicar(w, `cop-gerar-${p}`);
    await clicar(w, 'cop-seguir');
    expect(w.find('[data-testid="cop-pergunta"]').text()).toContain('hash');
    await clicar(w, 'cop-confirmar');
    expect(w.find('[data-testid="cop-feito"]').text()).toContain('abc123');
    expect(w.find('[data-testid="cop-pdf"]').attributes('href')).toBe('blob:copia');
    await flushPromises();
    await clicar(w, `cop-entregar-${p}`);
    await w.find('[data-testid="cop-recebedor"] input').setValue('José, RG 123');
    await w.find('[data-testid="cop-senha"]').setValue('segredo');
    await clicar(w, 'cop-seguir');
    await clicar(w, 'cop-confirmar');
    const ent = chamadas.find((c) => c.url.endsWith(`/copias/${p}/entrega`));
    expect(ent?.corpo).toEqual({ meio: 'balcao', recebedor: 'José, RG 123', senha: 'segredo' });
    await flushPromises();
    expect(w.find(`[data-testid="cop-etapa-${p}"]`).text()).toContain('Entregue');
  });

  it('balcão: o pedido novo do familiar leva a prova e só vai depois de confirmar', async () => {
    const chamadas = simular((url, init) => {
      if (url.endsWith('/copias') && init?.method === 'POST') return { protocolo: 'LGPD-2026-000030' };
      return [];
    });
    const w = montar(CopiasProntuarioTela);
    await flushPromises();
    await clicar(w, 'cop-novo');
    await w.find('[data-testid="cop-paciente"] input').setValue('4242');
    w.findAllComponents({ name: 'SanteSelecao' })[0]?.vm.$emit('update:modelValue', 'herdeiro');
    await flushPromises();
    await w.find('[data-testid="cop-prova"] input').setValue('certidão de óbito e de parentesco');
    await clicar(w, 'cop-seguir');
    expect(w.find('[data-testid="cop-pergunta"]').text()).toContain('4242');
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);
    await clicar(w, 'cop-confirmar');
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.corpo).toEqual({
      paciente: 4242,
      solicitante: 'herdeiro',
      vinculo: null,
      prova: 'certidão de óbito e de parentesco',
      observacao: null,
    });
    expect(w.find('[data-testid="cop-feito"]').text()).toContain('LGPD-2026-000030');
  });
});

describe('W0-10 (M3): portabilidade em FHIR/IPS', () => {
  const pedido = (protocolo: string, tipo: string, situacao: string, pacoteIps: boolean) => ({
    protocolo,
    tipo,
    situacao,
    abertoEm: '2026-11-18T09:00:00',
    prazo: '2026-12-03T09:00:00',
    atrasado: false,
    respondidoEm: situacao === 'atendido' ? '2026-11-20T10:00:00' : null,
    resposta: situacao === 'atendido' ? 'Pacote disponível no portal.' : null,
    fundamento: null,
    motivoCancelamento: null,
    cancelavel: situacao === 'aberto',
    pacoteIps,
  });
  it('o pedido de portabilidade atendido oferece o download do pacote; o aberto e o de outro tipo não', async () => {
    simular((url) => {
      if (url.endsWith('/paciente/eu'))
        return {
          hospital: 'aa',
          primeiroNome: 'José',
          ativo: { vinculo: null, primeiroNome: 'José', idade: 68, escopos: ['pedidos', 'documentos'] },
          titulares: [],
          expiraEm: '2026-11-18T13:00:00.000Z',
          soResponsavel: false,
        };
      if (url.endsWith('/paciente/pedidos'))
        return [
          pedido('2026-000031', 'portabilidade', 'atendido', true),
          pedido('2026-000032', 'portabilidade', 'aberto', false),
          pedido('2026-000033', 'acesso', 'atendido', false),
        ];
      return [];
    });
    const w = montar(PortalPrivacidadeTela);
    await flushPromises();
    await flushPromises();
    const link = w.find('[data-testid="pac-baixar-ips-2026-000031"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toContain('/paciente/portabilidade/2026-000031/ips');
    expect(link.attributes('download')).toBeDefined();
    expect(link.text()).toContain('FHIR');
    expect(w.find('[data-testid="pac-baixar-ips-2026-000032"]').exists()).toBe(false);
    expect(w.find('[data-testid="pac-baixar-ips-2026-000033"]').exists()).toBe(false);
  });
});

describe('W0-10 revisão: a fila da cópia do prontuário se abre pela tela do portal interno', () => {
  const montarInicio = () => {
    simular(() => ({ estabelecimento: 'aa' }));
    return mount(PortalPacienteInternoTela as never, {
      global: {
        plugins: [
          criarI18n(mensagensWeb as unknown as Record<string, unknown>),
          ui,
          [
            VueQueryPlugin,
            { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          ],
        ] as never,
        stubs: { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } },
      },
    });
  };

  it('com portal.copia.conferir mostra o link para portal.copias', async () => {
    definirSessaoDaTela({ permissoes: ['portal.copia.conferir'] } as never);
    const w = montarInicio();
    await flushPromises();
    const li = w.find('[data-testid="portal-link-copias"]');
    expect(li.exists()).toBe(true);
    expect(li.text()).toBe('Cópia do prontuário');
    expect(li.find('a').attributes('data-to')).toBe(JSON.stringify({ name: 'portal.copias' }));
  });

  it('sem a permissão o link não aparece', async () => {
    definirSessaoDaTela({ permissoes: ['portal.vinculo.conferir'] } as never);
    const w = montarInicio();
    await flushPromises();
    expect(w.find('[data-testid="portal-link-copias"]').exists()).toBe(false);
  });
});
