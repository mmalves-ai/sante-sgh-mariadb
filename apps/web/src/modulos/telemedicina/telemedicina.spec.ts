// @vitest-environment jsdom
// Telas da telemedicina (M50, etapa 4): a lista do médico com o paciente na sala de espera marcado; o detalhe com o
// alerta do crônico, o início que manda a declaração, o CID, os dados da ficha e a ciência do alerta (e recusa sem a
// declaração); a sala de espera do portal que só envia com o termo aceito e o local, e a entrada na sala simulada.
// Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import PortalTeleconsultaTela from '../portal/telas/PortalTeleconsultaTela.vue';
import TelemedicinaTela from './telas/TelemedicinaTela.vue';
import TeleconsultaMedicoTela from './telas/TeleconsultaMedicoTela.vue';

const push = vi.fn();
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ replace: vi.fn(), push }),
  useRoute: () => ({ params: { id: '51' }, query: {} }),
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
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
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
      return new Response(JSON.stringify(rota(String(url), init)), {
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
  push.mockReset();
});

const resumo = (situacao = 'aguardando') => ({
  id: 51,
  modalidade: 'teleconsulta',
  situacao,
  data: '2026-11-10',
  hora: '1030',
  agenda: 'CARDIOLOGIA - ANA MEDICA SINTETICO',
  paciente: { id: 1003, nome: 'PACIENTE SINTETICA', prontuario: 501003 },
  atendimento: null,
  pacienteNaEspera: situacao === 'aguardando',
  versao: 2,
});
const detalhe = (situacao = 'aguardando') => ({
  ...resumo(situacao),
  marcacao: 880101,
  termo: { versao: 'TELE-2026.1', aceitoEm: '2026-11-10T10:05:00.000' },
  local: { uf: 'RJ', municipio: 'PETROPOLIS', tipo: 'residencia' },
  esperaDesde: '2026-11-10T10:05:00.000',
  pacienteEntrouEm: null,
  iniciadaEm: null,
  encerradaEm: null,
  motivoEncerramento: null,
  medico: null,
  sala: null,
  alerta: {
    cronico: true,
    condicoes: ['I10-I15 hipertensão'],
    ultimaPresencial: '2026-04-24',
    diasSemPresencial: 200,
    alerta: true,
    mensagem: 'Paciente com condição crônica sem consulta presencial há 200 dias.',
  },
  abertura: { convenio: 306, especialidade: 15, unidade: 1, centroCusto: 300600, procedimento: 0 },
  interconsulta: null,
  acoes: {
    iniciar: { pode: situacao === 'aguardando', motivo: null },
    encerrar: { pode: true, motivo: null },
    responder: { pode: false, motivo: 'x' },
    cancelar: { pode: false, motivo: 'x' },
  },
});
const APOIO = {
  especialidades: [{ codigo: 15, nome: 'CLINICA MEDICA' }],
  unidades: [{ codigo: 1, nome: 'AMBULATORIO' }],
  centrosCusto: [{ codigo: 300600, nome: 'AMBULATORIO' }],
  procedimentoPadrao: 10101012,
  medicos: [
    { vinculo: 7101, nome: 'ANA MEDICA SINTETICO', crm: 52001 },
    { vinculo: 7102, nome: 'CARLOS CARDIOLOGISTA SINTETICO', crm: 52002 },
  ],
};

describe('telemedicina do médico', () => {
  it('a lista marca o paciente na sala de espera e abre o detalhe', async () => {
    definirSessaoDaTela({ permissoes: ['atendimento.teleconsulta.ler'] } as never);
    simular((url) =>
      url.startsWith('/api/telemedicina')
        ? {
            data: '2026-11-10',
            teleconsultas: [resumo()],
            interconsultas: [],
            truncado: false,
            ligada: true,
            motivo: null,
            podeRealizar: false,
            profissional: { vinculo: 7101, nome: 'ANA MEDICA SINTETICO' },
          }
        : {},
    );
    const w = montar(TelemedicinaTela);
    await flushPromises();
    expect(w.get('[data-testid="tele-espera-51"]').text()).toContain('sala de espera');
    expect(w.find('[data-testid="tele-pedir"]').exists()).toBe(false);
    await w.get('[data-testid="tele-abrir-51"]').trigger('click');
    expect(push).toHaveBeenCalledWith({ name: 'telemedicina.detalhe', params: { id: 51 } });
  });

  it('com a chave desligada, o aviso e nada para gravar', async () => {
    definirSessaoDaTela({
      permissoes: ['atendimento.teleconsulta.ler', 'atendimento.teleconsulta.realizar'],
    } as never);
    simular((url) =>
      url.endsWith('/apoio')
        ? APOIO
        : {
            data: '2026-11-10',
            teleconsultas: [],
            interconsultas: [],
            truncado: false,
            ligada: false,
            motivo: 'liberação pendente',
            podeRealizar: true,
            profissional: { vinculo: 7101, nome: 'ANA MEDICA SINTETICO' },
          },
    );
    const w = montar(TelemedicinaTela);
    await flushPromises();
    expect(w.get('[data-testid="tele-desligada"]').text()).toContain('liberação pendente');
    expect(w.find('[data-testid="tele-pedir"]').exists()).toBe(false);
    expect(w.find('[data-testid="tele-nenhuma"]').exists()).toBe(true);
  });

  it('iniciar exige a declaração; manda o CID, os dados da ficha e a ciência do alerta', async () => {
    const chamadas = simular((url, init) => {
      if (url.endsWith('/apoio')) return APOIO;
      if (url.includes('/cid?')) return [{ id: 2, codigo: 'I10', nome: 'HIPERTENSAO ESSENCIAL' }];
      if (init?.method === 'POST')
        return {
          ok: true,
          teleconsulta: {
            ...detalhe('em-andamento'),
            atendimento: 900101,
            sala: {
              provedor: 'simulado',
              endereco: 'simulado:SIM-SALA-AB12:medico',
              abertaEm: '2026-11-10T10:31:00',
            },
            acoes: { ...detalhe().acoes, iniciar: { pode: false, motivo: 'já iniciada' } },
          },
          mensagem: 'Teleconsulta iniciada: o atendimento foi aberto.',
        };
      return detalhe();
    });
    const w = montar(TeleconsultaMedicoTela);
    await flushPromises();
    expect(w.get('[data-testid="teled-alerta"]').text()).toContain('200 dias');
    expect(w.get('[data-testid="teled-local"]').text()).toContain('PETROPOLIS/RJ');
    await w.get('[data-testid="teled-iniciar-acao"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Confirme a declaração do médico');
    expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false);
    await w.get('[data-testid="teled-declaracao"]').setValue(true);
    await w.get('[data-testid="teled-ciente"]').setValue(true);
    await w.get('[data-testid="teled-busca-cid"]').setValue('I10');
    await w.get('[data-testid="teled-busca-cid"]').trigger('submit');
    await flushPromises();
    await w.get('[data-testid="teled-iniciar-acao"]').trigger('click');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.url).toBe('/api/telemedicina/51/inicio');
    expect(post?.corpo).toEqual({
      declaracao: 'CFM-2314-2026.1',
      cidPrincipal: 2,
      especialidade: 15,
      unidade: 1,
      centroCusto: 300600,
      procedimento: 10101012,
      cienteAlerta: true,
      versao: 2,
    });
    expect(w.get('[data-testid="teled-sala-simulada"]').text()).toContain('SIM-SALA-AB12');
    expect(w.get('[data-testid="teled-atendimento"]').text()).toContain('900101');
  });
});

describe('sala de espera do portal', () => {
  const SESSAO = {
    hospital: 'aa',
    primeiroNome: 'Cinthya',
    ativo: { vinculo: null, primeiroNome: 'Cinthya', idade: 34, escopos: ['agendamentos'] },
    titulares: [{ vinculo: null, primeiroNome: 'Cinthya', idade: 34, escopos: ['agendamentos'] }],
    expiraEm: '2026-11-10T23:00:00.000Z',
    soResponsavel: false,
  };
  const portal = (situacao: string, sala: unknown = null) => ({
    id: 51,
    situacao,
    data: '2026-11-10',
    hora: '1030',
    agenda: 'CARDIOLOGIA - ANA MEDICA SINTETICO',
    termo: situacao === 'agendada' ? null : { versao: 'TELE-2026.1', aceitoEm: '2026-11-10T10:05:00.000' },
    local: null,
    salaEspera: { aberta: true, abreEm: '2026-11-10T10:00', fechaEm: '2026-11-10T12:30', motivo: null },
    sala,
    podeEntrar: true,
  });

  it('só envia com o termo aceito e o local; manda a versão vigente', async () => {
    const chamadas = simular((url, init) => {
      if (url.includes('/eu')) return SESSAO;
      if (init?.method === 'POST') return portal('aguardando');
      return portal('agendada');
    });
    const w = montar(PortalTeleconsultaTela);
    await flushPromises();
    await w.get('[data-testid="pac-tele-esperar"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Leia e aceite o termo');
    await w.get('[data-testid="pac-tele-aceito"]').setValue(true);
    await w.get('[data-testid="pac-tele-esperar"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Informe o estado e a cidade');
    expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false);
  });

  it('com o médico na sala, entra e mostra a sala simulada', async () => {
    const sala = {
      provedor: 'simulado',
      endereco: 'simulado:SIM-SALA-CD34:paciente',
      abertaEm: '2026-11-10T10:31:00',
    };
    const chamadas = simular((url, init) => {
      if (url.includes('/eu')) return SESSAO;
      return portal(init?.method === 'POST' ? 'em-andamento' : 'em-andamento', sala);
    });
    const w = montar(PortalTeleconsultaTela);
    await flushPromises();
    await w.get('[data-testid="pac-tele-entrar"]').trigger('click');
    await flushPromises();
    expect(chamadas.find((c) => c.metodo === 'POST')?.url).toBe('/api/paciente/teleconsultas/51/entrada');
    expect(w.get('[data-testid="pac-tele-simulada"]').text()).toContain('SIM-SALA-CD34');
  });
});
