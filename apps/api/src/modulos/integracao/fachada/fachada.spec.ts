// M58-F4 pela HTTP, com a sessão real sobre a fonte sintética e a porta da fachada EM MEMÓRIA (nada conecta a banco):
// o serviço público no caminho da API original com o token da superfície e o contrato de erro dela (nunca o Problem
// Details), o painel (integracao.fachada.ler) e a configuração crítica (senha de novo e a trilha), que liga a fachada
// e a escrita; a ação de situação do convênio em dois tempos pela HTTP.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { moduloIntegracao } from '../modulo.js';
import { PortaFachadaMemoria } from './porta-memoria.js';

const TOKEN = 't'.repeat(40);
const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  FACHADA_API_TOKEN: TOKEN,
  API_MODULOS: 'integracao',
};
const trilha = new RegistradorTrilhaMemoria();
const porta = new PortaFachadaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: { integracao: async () => ({ modulo: (ctx) => moduloIntegracao(ctx, { fachada: porta }) }) },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const configurar = (s: Sessao, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: '/api/administracao/integracoes/fachada/configuracao',
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      'idempotency-key': `teste-m58f4-${++chave}-${Date.now()}`,
    },
    payload: payload as Record<string, unknown>,
  });
const F = '/api/fachada/sante-api/aa';
const fachada = (method: 'GET' | 'POST', url: string, payload?: unknown, token: string | null = TOKEN) =>
  app.inject({
    method,
    url: `${F}${url}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

describe('fachada da API de integração pela HTTP', { timeout: 60_000 }, () => {
  it('desligada por padrão; token e o contrato de erro da API original', async () => {
    const d = await fachada('GET', '/convenios');
    expect(d.statusCode).toBe(503);
    expect(d.json()).toMatchObject({ status: 'error', codigo: 'fachada_desligada' });
    expect(d.headers['cache-control']).toBe('no-store');
    const sem = await fachada('GET', '/convenios', undefined, null);
    expect(sem.statusCode).toBe(401);
    expect(sem.json()).toEqual({
      status: 'error',
      codigo: 'nao_autorizado',
      message: 'Não autorizado: token ausente ou inválido. Verifique o header Authorization.',
    });
    expect((await fachada('GET', '/convenios', undefined, 'errado')).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/fachada/sante-api/AA!/health' })).statusCode).toBe(
      404,
    );
  });

  it('painel e configuração (senha de novo, trilha); liga a fachada e serve convênios', async () => {
    const s = await entrar('SINT.ONDA5');
    const p = await app.inject({
      method: 'GET',
      url: '/api/administracao/integracoes/fachada',
      headers: { cookie: s.cookie },
    });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({
      hospital: 'aa',
      versaoContrato: '0.23.0',
      configuracao: { ligada: false, escrita: false },
      totais: { operacoes: 78 },
      pode: { configurar: true },
    });
    expect(p.body).not.toContain(TOKEN);
    const semSenha = await configurar(s, {
      chave: 'integracao.fachada.ligada',
      valor: 'sim',
      justificativa: 'aceite da equipe da Hal-AI no ensaio',
    });
    expect(semSenha.statusCode).toBeGreaterThanOrEqual(400);
    const recusado = await configurar(s, {
      chave: 'integracao.fachada.destino',
      valor: 'ftp://x',
      justificativa: 'endereço errado de propósito',
      senha: SENHA,
    });
    expect(recusado.statusCode).toBe(422);
    const ok = await configurar(s, {
      chave: 'integracao.fachada.ligada',
      valor: 'sim',
      justificativa: 'aceite da equipe da Hal-AI no ensaio',
      senha: SENHA,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ configuracao: { ligada: true, escrita: false } });
    const l = await fachada('GET', '/convenios?ativo=true');
    expect(l.statusCode).toBe(200);
    expect(l.json()).toMatchObject({ total: 2 });
    const um = await fachada('GET', '/convenios/30');
    expect(um.json()).toEqual({
      codigo: 30,
      nome: 'CONVENIO SINTETICO DOIS',
      ativo: false,
      permiteAtendimento: 0,
    });
    const inv = await fachada('GET', '/convenios?limite=600');
    expect(inv.statusCode).toBe(400);
    expect(inv.json()).toMatchObject({ codigo: 'parametro_invalido' });
    expect((await fachada('GET', '/nao-existe')).json()).toMatchObject({ codigo: 'rota_nao_encontrada' });
    expect((await fachada('GET', '/health', undefined, null)).json()).toMatchObject({ status: 'ok' });
  });

  it('escrita: desligada por padrão; ligada, a ação em dois tempos', async () => {
    const s = await entrar('SINT.ONDA5');
    expect(
      (await fachada('POST', '/acoes/convenios/situacao', { convenio: 20, operacao: 'suspender' }))
        .statusCode,
    ).toBe(403);
    const ok = await configurar(s, {
      chave: 'integracao.fachada.escrita',
      valor: 'sim',
      justificativa: 'ensaio da escrita pela fachada',
      senha: SENHA,
    });
    expect(ok.statusCode).toBe(200);
    const p = await fachada('POST', '/acoes/convenios/situacao', { convenio: 20, operacao: 'suspender' });
    expect(p.statusCode).toBe(200);
    const { propostaId, aplicada } = p.json() as { propostaId: string; aplicada: boolean };
    expect(aplicada).toBe(false);
    expect(porta.gravacoes).toHaveLength(0);
    const c = await fachada('POST', '/acoes/confirmar', { propostaId });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({ aplicada: true, situacaoAtual: 'I' });
    expect(porta.gravacoes).toHaveLength(1);
    const st = await fachada('GET', '/acoes/status');
    expect(st.json()).toMatchObject({ habilitada: true, propostasPendentes: 0 });
  });
});
