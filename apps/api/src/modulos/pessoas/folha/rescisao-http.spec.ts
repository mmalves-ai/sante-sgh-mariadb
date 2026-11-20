// M53.5 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): cada rota da
// rescisão pela permissão da opção do outro sistema. O departamento pessoal (Lançamentos › Rescisão 388) abre tudo;
// quem só consulta a folha (351) e quem só tem os eventos (367) abrem o apoio da área e nada mais. A chave
// `pessoas.folha` nasce desligada: calcular de verdade e cancelar são recusados na chave; a entrada inválida é 400.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { CifraCpf } from '../cifra-cpf.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha: new RegistradorTrilhaMemoria(),
    cifraCpf: new CifraCpf(Buffer.alloc(32, 7)),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

const csrfDe = new Map<string, string>();
async function entrar(login: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  const cookie = set.map((c) => c.split(';')[0]).join('; ');
  csrfDe.set(
    cookie,
    set
      .find((c) => c.startsWith('sgh_csrf='))
      ?.split(';')[0]
      ?.slice(9) ?? '',
  );
  return cookie;
}
const P = '/api/pessoas/folha';
const LEITURAS = [
  `${P}/rescisoes/apoio`,
  `${P}/rescisoes/desligados?de=2026-10-01&ate=2026-10-31`,
  `${P}/rescisoes?de=2026-10-01&ate=2026-10-31`,
  `${P}/rescisoes/999999`,
] as const;

async function situacoes(login: string): Promise<number[]> {
  const cookie = await entrar(login);
  const r: number[] = [];
  for (const url of LEITURAS)
    r.push((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode);
  return r;
}
const post = (cookie: string, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '', 'idempotency-key': `m53-5-${Math.random()}` },
    payload: payload as Record<string, unknown>,
  });

const calculo = {
  vinculo: 999_999,
  empresa: 1,
  modalidade: 'sem-justa-causa',
  aviso: 'indenizado',
  termo: null,
  saldoFgts: null,
  pagamento: null,
};

describe('rescisão: cada rota pela sua permissão', { timeout: 180_000 }, () => {
  it('leituras por usuário (rescisão inexistente é 404 para quem pode ver)', async () => {
    expect(await situacoes('SINT.DP.FOLHA')).toEqual([200, 200, 200, 404]);
    expect(await situacoes('SINT.FOLHA.CONSULTA')).toEqual([200, 403, 403, 403]);
    expect(await situacoes('SINT.FOLHA.EVENTOS')).toEqual([200, 403, 403, 403]);
  });

  it('o termo em PDF: inexistente é 404 para o DP; sem a permissão da rescisão, 403', async () => {
    const pdf = async (login: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `${P}/rescisoes/999999/termo/pdf`,
          headers: { cookie: await entrar(login) },
        })
      ).statusCode;
    expect(await pdf('SINT.DP.FOLHA')).toBe(404);
    expect(await pdf('SINT.FOLHA.CONSULTA')).toBe(403);
    expect(await pdf('SINT.FOLHA.EVENTOS')).toBe(403);
  });

  it('o apoio: chave desligada, modalidades com os avisos e os tipos de rescisão com a sugestão', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const r = await app.inject({ method: 'GET', url: `${P}/rescisoes/apoio`, headers: { cookie: dp } });
    expect(r.json()).toMatchObject({
      gravacao: { ligada: false },
      acoes: { calcular: false, verSalario: true },
    });
    expect(r.json().modalidades).toHaveLength(10);
    const consulta = await entrar('SINT.FOLHA.CONSULTA');
    const c = await app.inject({ method: 'GET', url: `${P}/rescisoes/apoio`, headers: { cookie: consulta } });
    expect(c.json()).toMatchObject({ acoes: { calcular: false, verSalario: false } });
  });

  it('gravar com a chave desligada é recusado; a consulta não calcula; colaborador inexistente é 404; entrada inválida é 400', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const previa = await post(dp, `${P}/rescisoes`, { ...calculo, simular: true });
    expect(previa.statusCode, previa.body).toBe(404);
    const gravar = await post(dp, `${P}/rescisoes`, { ...calculo, simular: false });
    expect(gravar.statusCode).toBe(403);
    expect(gravar.json()).toMatchObject({ codigo: 'recurso-desligado' });
    const cancelar = await post(dp, `${P}/rescisoes/999999/cancelamento`, { versao: 0, motivo: 'Teste' });
    expect(cancelar.json()).toMatchObject({ codigo: 'recurso-desligado' });
    const consulta = await entrar('SINT.FOLHA.CONSULTA');
    const semPermissao = await post(consulta, `${P}/rescisoes`, { ...calculo, simular: true });
    expect(semPermissao.statusCode).toBe(403);
    expect(semPermissao.json()).not.toMatchObject({ codigo: 'recurso-desligado' });
    expect((await post(dp, `${P}/rescisoes`, { ...calculo, modalidade: 'outra' })).statusCode).toBe(400);
    expect((await post(dp, `${P}/rescisoes`, { vinculo: 1 })).statusCode).toBe(400);
    const intervalo = await app.inject({
      method: 'GET',
      url: `${P}/rescisoes/desligados?de=2026-10-31&ate=2026-10-01`,
      headers: { cookie: dp },
    });
    expect(intervalo.statusCode).toBe(400);
  });
});
