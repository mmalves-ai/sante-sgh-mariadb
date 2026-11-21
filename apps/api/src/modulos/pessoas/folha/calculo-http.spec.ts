// M53.3 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): cada rota do
// cálculo pela permissão da opção do outro sistema. O departamento pessoal (folha mensal, processamento, alteração de
// salário, parâmetros) abre tudo; quem só consulta a folha (351) vê os cálculos e os parâmetros, não o salário, e não
// calcula; quem só tem os eventos (367) abre o apoio da área e nada mais. A chave `pessoas.folha` nasce desligada:
// calcular de verdade é recusado, a prévia sai.
import { criarAppPessoas } from '../opcoes-teste.spec-util.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarAppPessoas(env, {
    trilha: new RegistradorTrilhaMemoria(),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

async function entrar(login: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  const csrf =
    set
      .find((c) => c.startsWith('sgh_csrf='))
      ?.split(';')[0]
      ?.slice(9) ?? '';
  csrfDe.set(set.map((c) => c.split(';')[0]).join('; '), csrf);
  return set.map((c) => c.split(';')[0]).join('; ');
}
const csrfDe = new Map<string, string>();
const P = '/api/pessoas/folha';
const LEITURAS = [
  `${P}/calculo/apoio`,
  `${P}/calculos?empresa=1`,
  `${P}/parametros?empresa=1`,
  `${P}/salarios?vinculo=1`,
] as const;

async function situacoes(login: string): Promise<number[]> {
  const cookie = await entrar(login);
  const r: number[] = [];
  for (const url of LEITURAS)
    r.push((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode);
  return r;
}

const calcular = (cookie: string, simular: boolean) =>
  app.inject({
    method: 'POST',
    url: `${P}/calculos`,
    headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '', 'idempotency-key': `m53-3-${Math.random()}` },
    payload: { empresa: 1, competencia: '2026-09', simular },
  });

describe('cálculo da folha: cada rota pela sua permissão', { timeout: 180_000 }, () => {
  it('leituras por usuário (o salário do vínculo inexistente é 404 para quem pode ver)', async () => {
    expect(await situacoes('SINT.DP.FOLHA')).toEqual([200, 200, 200, 404]);
    expect(await situacoes('SINT.FOLHA.CONSULTA')).toEqual([200, 200, 200, 403]);
    expect(await situacoes('SINT.FOLHA.EVENTOS')).toEqual([200, 403, 403, 403]);
  });

  it('calcular: o DP simula com a chave desligada e não grava; a consulta não calcula', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const apoio = await app.inject({ method: 'GET', url: `${P}/calculo/apoio`, headers: { cookie: dp } });
    expect(apoio.json()).toMatchObject({
      gravacao: { ligada: false },
      acoes: { calcular: false, verSalario: true },
    });
    const previa = await calcular(dp, true);
    expect(previa.statusCode, previa.body).toBe(200);
    expect(previa.json()).toMatchObject({ calculado: false, simulado: true });
    const gravar = await calcular(dp, false);
    expect(gravar.statusCode).toBe(403);
    const consulta = await entrar('SINT.FOLHA.CONSULTA');
    expect((await calcular(consulta, true)).statusCode).toBe(403);
    const invalida = await app.inject({
      method: 'POST',
      url: `${P}/calculos`,
      headers: { cookie: dp, 'x-csrf': csrfDe.get(dp) ?? '', 'idempotency-key': 'm53-3-invalida' },
      payload: { empresa: 1, competencia: '2026-13' },
    });
    expect(invalida.statusCode).toBe(400);
  });

  it('holerite do autosserviço: só o próprio vínculo; com a folha desligada, só a frase', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const r = await app.inject({ method: 'GET', url: '/api/pessoas/meu/holerite', headers: { cookie: dp } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ disponivel: false, calculado: false, linhas: [] });
    const outro = await app.inject({
      method: 'GET',
      url: '/api/pessoas/meu/holerite?vinculo=1',
      headers: { cookie: dp },
    });
    expect(outro.statusCode).toBe(403);
    const invalida = await app.inject({
      method: 'GET',
      url: '/api/pessoas/meu/holerite?competencia=2026-13',
      headers: { cookie: dp },
    });
    expect(invalida.statusCode).toBe(400);
  });

  it('documentos em PDF/A: holerite sem cálculo é 404; a conferência de processamento inexistente é 404, sem a permissão 403', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const h = await app.inject({
      method: 'GET',
      url: '/api/pessoas/meu/holerite/pdf',
      headers: { cookie: dp },
    });
    expect(h.statusCode, h.body).toBe(404);
    const outro = await app.inject({
      method: 'GET',
      url: '/api/pessoas/meu/holerite/pdf?vinculo=1',
      headers: { cookie: dp },
    });
    expect(outro.statusCode).toBe(403);
    const c = await app.inject({
      method: 'GET',
      url: `${P}/calculos/999999/conferencia/pdf`,
      headers: { cookie: dp },
    });
    expect(c.statusCode, c.body).toBe(404);
    const eventos = await entrar('SINT.FOLHA.EVENTOS');
    const sem = await app.inject({
      method: 'GET',
      url: `${P}/calculos/999999/conferencia/pdf`,
      headers: { cookie: eventos },
    });
    expect(sem.statusCode).toBe(403);
  });

  it('D-PERM-SAL-533: a consulta (pessoas.folha.ler sem pessoas.salario.ler) não lê memória nem conferência por colaborador', async () => {
    const ler = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
    const consulta = await entrar('SINT.FOLHA.CONSULTA');
    const apoio = await ler(consulta, `${P}/calculo/apoio`);
    expect(apoio.json()).toMatchObject({ acoes: { verSalario: false } });
    expect((await ler(consulta, `${P}/calculos/999999/vinculos/1`)).statusCode).toBe(403);
    expect((await ler(consulta, `${P}/calculos/999999/conferencia/pdf`)).statusCode).toBe(403);
    const dp = await entrar('SINT.DP.FOLHA');
    expect((await ler(dp, `${P}/calculos/999999/vinculos/1`)).statusCode).toBe(404);
  });
});
