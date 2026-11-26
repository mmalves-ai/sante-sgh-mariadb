// CCIH (M48, etapa 3), correção da revisão: a alta e a transferência feitas no outro sistema (D-RECONC-48.3,
// D-ALTA-DISP-48.3), as duas precauções no mesmo quarto com o bloqueio compartilhado e o bloqueio de outro motivo
// (D-VIZINHO-48.3), e a restrição por vínculo nas rotas que entram no prontuário e na prescrição (M23). Porta EM
// MEMÓRIA, dados sintéticos; nada conecta a banco.
import { criarAppQualidade, ctxTeste, TRILHA_TESTE } from './teste.spec-util.js';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { EstadoProntuario } from '../pep/sessao-prontuario.js';
import { CcihController } from './ccih.controller.js';
import {
  ATENDIMENTO_SINTETICO_CCIH,
  INTERNACAO_SINTETICA_CCIH,
  PACIENTE_SINTETICO_CCIH,
  PortaCcihMemoria,
} from './porta-ccih-memoria.js';
import { fichaDe } from './porta-auditoria-antimicrobiano-propria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-22 13:00 em São Paulo. */
const agora = () => new Date('2026-10-22T16:00:00Z');
const uti = (leito: string) => ({ bloco: 'UTI', acomodacao: '01', leito });

interface Sessao {
  cookie: string;
  csrf: string;
}

const abertos: NestFastifyApplication[] = [];
afterEach(async () => {
  for (const app of abertos.splice(0)) await app.close();
});

async function montar() {
  const trilha = new RegistradorTrilhaMemoria();
  const porta = new PortaCcihMemoria({ agora });
  const app: NestFastifyApplication = await criarAppQualidade(env, {
    trilha,
    ccih: porta,
    vigiaEnfermagem: null,
    vigia: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  abertos.push(app);
  const entrar = async (login: string): Promise<Sessao> => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha: SENHA },
    });
    expect(r.statusCode, r.body).toBe(201);
    const set = r.headers['set-cookie'] as string[];
    return {
      cookie: set.map((c) => c.split(';')[0]).join('; '),
      csrf:
        set
          .find((c) => c.startsWith('sgh_csrf='))
          ?.split(';')[0]
          ?.slice(9) ?? '',
    };
  };
  const ccih = await entrar('SINT.CCIH');
  return {
    porta,
    get: (url: string) => app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: ccih.cookie } }),
    post: (url: string, payload: unknown = {}) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: { cookie: ccih.cookie, 'x-csrf': ccih.csrf },
        payload: payload as object,
      }),
  };
}

const precaucao = (internacao: number, motivo: string, tipo: string, bloquearVizinhos: boolean) => ({
  internacao,
  motivo,
  motivoOutro: null,
  tipo,
  origem: 'manual',
  exame: null,
  bloquearVizinhos,
  observacao: null,
});
const encerrar = { versao: 1, motivo: 'reavaliacao', observacao: null };

describe('alta e transferência feitas no outro sistema (D-RECONC-48.3)', () => {
  it('a precaução de quem recebeu alta vira pendência, não pesa no leito do novo ocupante e solta o vizinho ao encerrar', async () => {
    const m = await montar();
    const tb = await m.post(
      '/qualidade/ccih/precaucoes',
      precaucao(INTERNACAO_SINTETICA_CCIH, 'tuberculose', 'aerossois', true),
    );
    expect(tb.statusCode, tb.body).toBe(201);
    expect(m.porta.estadoDoLeito(uti('B')).has('bloqueio')).toBe(true);
    // O outro sistema dá alta ao 4801 e põe o 4802 no leito A; o novo não soube de nada.
    m.porta.simularAlta(INTERNACAO_SINTETICA_CCIH, '2026-10-21');
    m.porta.simularTransferencia(4802, uti('A'));
    const painel = await m.get('/qualidade/ccih/precaucoes');
    expect(painel.json().itens).toEqual([
      expect.objectContaining({
        id: tb.json().id,
        situacao: 'internacaoEncerrada',
        paciente: '',
        leitoAtual: null,
      }),
    ]);
    // A precaução de contato do novo ocupante: o leito mostra contato, não os aerossóis de quem saiu.
    const kpc = await m.post('/qualidade/ccih/precaucoes', precaucao(4802, 'kpc', 'contato', false));
    expect(kpc.statusCode, kpc.body).toBe(201);
    expect(kpc.json()).toMatchObject({ tipoDoLeito: 'contato' });
    expect(m.porta.estadoDoLeito(uti('A')).get('precaucao')).toBe('contato');
    // Encerrar a órfã: o leito fica com a do novo ocupante e o vizinho que só ela bloqueava é solto.
    const fim = await m.post(`/qualidade/ccih/precaucoes/${String(tb.json().id)}/encerrar`, encerrar);
    expect(fim.statusCode, fim.body).toBe(201);
    expect(fim.json()).toEqual({ versao: 2, liberados: 1 });
    expect(m.porta.estadoDoLeito(uti('A')).get('precaucao')).toBe('contato');
    expect(m.porta.estadoDoLeito(uti('B')).has('bloqueio')).toBe(false);
  });

  it('na transferência a precaução segue o paciente (cabeçalho) e o painel mostra o leito atual como pendência', async () => {
    const m = await montar();
    const kpc = await m.post(
      '/qualidade/ccih/precaucoes',
      precaucao(INTERNACAO_SINTETICA_CCIH, 'kpc', 'contato', false),
    );
    expect(kpc.statusCode, kpc.body).toBe(201);
    m.porta.simularTransferencia(INTERNACAO_SINTETICA_CCIH, { bloco: 'CM', acomodacao: '201', leito: 'B' });
    const painel = await m.get('/qualidade/ccih/precaucoes');
    expect(painel.json().itens[0]).toMatchObject({ situacao: 'transferida', leitoAtual: 'CM · 201 · B' });
    const cab = await m.get(`/qualidade/ccih/precaucoes/do-paciente/${String(PACIENTE_SINTETICO_CCIH)}`);
    expect(cab.json().itens).toEqual([expect.objectContaining({ tipo: 'contato', motivo: 'kpc' })]);
    // Encerrada no leito antigo, o mapa dele perde a precaução.
    const fim = await m.post(`/qualidade/ccih/precaucoes/${String(kpc.json().id)}/encerrar`, encerrar);
    expect(fim.statusCode, fim.body).toBe(201);
    expect(m.porta.estadoDoLeito(uti('A')).has('precaucao')).toBe(false);
  });

  it('o dispositivo sem retirada para de contar na alta e vira pendência até a CCIH registrar a retirada', async () => {
    const m = await montar();
    const cvc = await m.post('/qualidade/ccih/dispositivos', {
      internacao: INTERNACAO_SINTETICA_CCIH,
      tipo: 'cvc',
      sitio: 'Subclávia direita',
      inseridoEm: '2026-10-17T10:00',
      itemPrescricao: null,
      observacao: null,
    });
    expect(cvc.statusCode, cvc.body).toBe(201);
    const antes = await m.get('/qualidade/ccih/denominadores?competencia=2026-10&setor=UTI');
    // Dias 17 a 21 instalados no fim do dia (o 22 ainda não terminou).
    expect(antes.json().todos.dispositivosDia.cvc).toBe(5);
    expect(antes.json().semRetirada).toEqual([]);
    m.porta.simularAlta(INTERNACAO_SINTETICA_CCIH, '2026-10-20');
    const depois = await m.get('/qualidade/ccih/denominadores?competencia=2026-10&setor=UTI');
    // Só 17, 18 e 19: o dia da alta não conta, como no censo.
    expect(depois.json().todos.dispositivosDia.cvc).toBe(3);
    expect(depois.json().semRetirada).toEqual([
      expect.objectContaining({
        id: cvc.json().id,
        internacao: INTERNACAO_SINTETICA_CCIH,
        alta: '2026-10-20',
      }),
    ]);
    const ret = await m.post(`/qualidade/ccih/dispositivos/${String(cvc.json().id)}/retirar`, {
      versao: 1,
      retiradoEm: '2026-10-20T00:00',
      motivo: 'alta',
      observacao: null,
    });
    expect(ret.statusCode, ret.body).toBe(201);
    const fim = await m.get('/qualidade/ccih/denominadores?competencia=2026-10&setor=UTI');
    expect(fim.json().semRetirada).toEqual([]);
    expect(fim.json().todos.dispositivosDia.cvc).toBe(3);
  });
});

describe('bloqueio do vizinho (D-VIZINHO-48.3)', () => {
  it('duas precauções de aerossóis no quarto: encerrar a primeira não solta o vizinho que a segunda ainda pede', async () => {
    const m = await montar();
    const tb = await m.post(
      '/qualidade/ccih/precaucoes',
      precaucao(INTERNACAO_SINTETICA_CCIH, 'tuberculose', 'aerossois', true),
    );
    const sarampo = await m.post(
      '/qualidade/ccih/precaucoes',
      precaucao(INTERNACAO_SINTETICA_CCIH, 'varicelaSarampo', 'aerossois', true),
    );
    expect([tb.statusCode, sarampo.statusCode], sarampo.body).toEqual([201, 201]);
    expect(sarampo.json()).toMatchObject({ bloqueados: 0 });
    const fimTb = await m.post(`/qualidade/ccih/precaucoes/${String(tb.json().id)}/encerrar`, encerrar);
    expect(fimTb.json()).toEqual({ versao: 2, liberados: 0 });
    expect(m.porta.estadoDoLeito(uti('B')).has('bloqueio')).toBe(true);
    const fimS = await m.post(`/qualidade/ccih/precaucoes/${String(sarampo.json().id)}/encerrar`, encerrar);
    expect(fimS.json()).toEqual({ versao: 2, liberados: 1 });
    expect(m.porta.estadoDoLeito(uti('B')).has('bloqueio')).toBe(false);
  });

  it('o bloqueio aberto por outro motivo (manutenção) não é encerrado pela CCIH', async () => {
    const m = await montar();
    m.porta.bloquearLeito(uti('B'), 'manutencao');
    const tb = await m.post(
      '/qualidade/ccih/precaucoes',
      precaucao(INTERNACAO_SINTETICA_CCIH, 'tuberculose', 'aerossois', true),
    );
    expect(tb.json()).toMatchObject({ bloqueados: 0 });
    const fim = await m.post(`/qualidade/ccih/precaucoes/${String(tb.json().id)}/encerrar`, encerrar);
    expect(fim.json()).toEqual({ versao: 2, liberados: 0 });
    expect(m.porta.estadoDoLeito(uti('B')).get('bloqueio')).toBe('manutencao');
  });
});

describe('restrição por vínculo nas rotas do prontuário e da prescrição (M23)', () => {
  const PERMISSOES = ['pep.prontuario.ler', 'pep.prescricao.ler'];
  let n = 0;
  async function controlador(vinculos: { login: string; idPaciente: number; forma: 'equipe' }[]) {
    const t = new RegistradorTrilhaMemoria();
    const porta = new PortaCcihMemoria({ agora });
    const configuracao = fonteConfiguracaoMemoria(t, {
      chavesIniciais: chavesIniciaisSinteticas,
      prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      parametrosIniciais: parametrosIniciaisSinteticos,
    });
    const ctrl = new CcihController(
      porta,
      t,
      configuracao,
      null,
      new EstadoProntuario(),
      null,
      new VinculoSintetico(vinculos),
      null,
    );
    // Uma precaução aberta do paciente sintético (a leitura que o cabeçalho mostra).
    await porta.gravarSgh(ctxTeste('aa'), TRILHA_TESTE, (g) =>
      g.definirPrecaucao({
        reg: INTERNACAO_SINTETICA_CCIH,
        paciente: PACIENTE_SINTETICO_CCIH,
        leito: uti('A'),
        motivo: 'kpc',
        motivoOutro: null,
        tipo: 'contato',
        tipoDoLeito: 'contato',
        origem: 'manual',
        exame: null,
        multirresistente: true,
        bloquear: [],
        observacao: null,
        agora: '2026-10-22T12:00:00',
        usuario: 'SINT.CCIH',
      }),
    );
    const req = () =>
      ({
        headers: { 'idempotency-key': `teste.m48.vinculo.${String(n++)}` },
        ip: '127.0.0.1',
        sgh: {
          real: false,
          permissao: 'pep.prontuario.ler',
          ability: criarAbility(regrasDeAcesso(PERMISSOES, null)),
          sessao: {
            usuario: { id: '1', nome: 'Médico sintético', login: 'SINT.MEDICO' },
            rede: 'rede-teste',
            estabelecimentos: [],
            estabelecimentoAtivo: 'aa',
            unidadeAtiva: null,
            permissoes: PERMISSOES,
            restricaoVinculo: true,
            sintetica: true,
            bloqueioInatividadeSegundos: 0,
            expiraEm: '',
          },
        },
      }) as unknown as RequisicaoAutorizada;
    return { ctrl, t, req };
  }
  const recusa = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (e instanceof ErroProblema) return e;
      throw e;
    }
    return null;
  };
  const P = String(PACIENTE_SINTETICO_CCIH);

  it('sem vínculo: 403 sem-vinculo nas três rotas e a tentativa vai à trilha', async () => {
    const m = await controlador([]);
    const tentativas = [
      () => m.ctrl.precaucoesDoPaciente(P, m.req()),
      () => m.ctrl.alertasDoAtendimento(String(ATENDIMENTO_SINTETICO_CCIH), m.req()),
      () => m.ctrl.alertas(String(INTERNACAO_SINTETICA_CCIH), m.req()),
    ];
    for (const f of tentativas) expect(await recusa(f())).toMatchObject({ tipo: 'sem-vinculo' });
    expect(
      m.t.eventos.filter(
        (e) =>
          e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo && e.paciente === PACIENTE_SINTETICO_CCIH,
      ),
    ).toHaveLength(3);
  });

  it('com vínculo: a precaução e o alerta saem, e a leitura fica na trilha do prontuário', async () => {
    const m = await controlador([
      { login: 'SINT.MEDICO', idPaciente: PACIENTE_SINTETICO_CCIH, forma: 'equipe' },
    ]);
    const cab = await m.ctrl.precaucoesDoPaciente(P, m.req());
    expect(cab.itens).toEqual([expect.objectContaining({ tipo: 'contato', motivo: 'kpc' })]);
    await m.ctrl.alertas(String(INTERNACAO_SINTETICA_CCIH), m.req());
    expect(
      m.t.eventos.some(
        (e) => e.evento === EVENTOS_AUDITAVEIS.consultaRes.codigo && e.paciente === PACIENTE_SINTETICO_CCIH,
      ),
    ).toBe(true);
    expect(m.t.eventos.some((e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo)).toBe(false);
  });
});

// A ficha de antimicrobiano migrada sem atendimento ligado na origem (ficha_antimicrobiano.atendimento_id nulo só com
// origem='migracao') entra na fila da comissão com o atendimento nulo, nunca 0.
describe('ficha de antimicrobiano migrada sem atendimento', () => {
  it('o atendimento fica nulo na ficha migrada e vem preenchido na ficha nova', () => {
    const linha = {
      id: 1,
      versao: 1,
      paciente_id: 2,
      atendimento_id: null,
      prescricao_item_id: 3,
      dias_previstos: 7,
    };
    expect(fichaDe(linha).atendimento).toBeNull();
    expect(fichaDe({ ...linha, atendimento_id: 5 }).atendimento).toBe(5);
  });
});
