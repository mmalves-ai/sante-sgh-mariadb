// M53.9 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): a integração
// da folha com o financeiro e o contábil, cada rota pela permissão da opção do outro sistema. O departamento pessoal
// (Tabelas › Integração 371, Rotinas › Integração 397, a tabela de integração 4876 a 4882) consulta, configura e lança;
// quem só consulta a folha (351) não vê a integração. A chave `pessoas.folha` nasce desligada: as leituras e a prévia
// saem, gravar o de-para e lançar são recusados na chave; a entrada inválida é 400.
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
const post = (cookie: string, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '', 'idempotency-key': `m53-9-${Math.random()}` },
    payload: payload as Record<string, unknown>,
  });
const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

const I = '/api/pessoas/folha/integracao';
const DE_PARA = {
  empresa: 1,
  inicio: '2026-09-01',
  destinos: [
    {
      destino: 'fgts',
      credor: 9003,
      classificacao: { grupo: 296, subgrupo: 4, item: 2 },
      diaVencimento: 20,
      mesesDepois: 1,
    },
  ],
};

describe('integração da folha: cada rota pela sua permissão', { timeout: 180_000 }, () => {
  it('leituras: o DP lê; quem só consulta a folha não vê a integração', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const consulta = await entrar('SINT.FOLHA.CONSULTA');
    const apoio = await get(dp, `${I}/apoio`);
    expect(apoio.statusCode, apoio.body).toBe(200);
    expect(apoio.json().rotinas).toHaveLength(19);
    expect(JSON.stringify(apoio.json())).not.toMatch(/cpf/i);
    expect((await get(dp, `${I}/de-para?empresa=1`)).statusCode).toBe(200);
    expect((await get(dp, `${I}/lancamentos?empresa=1&ano=2026`)).json()).toEqual({ itens: [] });
    expect((await get(dp, `${I}/origens?empresa=1&ano=2026`)).statusCode).toBe(200);
    expect((await get(dp, `${I}/credores?termo=SINTETIC`)).json().itens.length).toBeGreaterThan(0);
    expect((await get(dp, `${I}/credores?termo=x`)).statusCode).toBe(400);
    expect((await get(dp, `${I}/lancamentos/999999`)).statusCode).toBe(404);
    expect((await get(dp, `${I}/custo?empresa=1&periodo=2026-09`)).json()).toMatchObject({
      total: 0,
      centros: [],
    });
    for (const rota of [
      'apoio',
      'de-para?empresa=1',
      'lancamentos?empresa=1&ano=2026',
      'origens?empresa=1&ano=2026',
      'credores?termo=SINTETIC',
      'custo?empresa=1&periodo=2026-09',
    ])
      expect((await get(consulta, `${I}/${rota}`)).statusCode, rota).toBe(403);
  });

  it('gravar e lançar: recusados na chave desligada; sem permissão é 403; inválido é 400', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const consulta = await entrar('SINT.FOLHA.CONSULTA');
    expect((await post(dp, `${I}/de-para`, DE_PARA)).json()).toMatchObject({ codigo: 'recurso-desligado' });
    // A prévia de uma origem que não existe é 404 (lê, não grava).
    expect((await post(dp, `${I}/previa`, { empresa: 1, origem: 'fechamento', id: 999 })).statusCode).toBe(
      404,
    );
    const lancar = {
      empresa: 1,
      origem: 'fechamento',
      id: 999,
      resumo: 'a'.repeat(64),
      emissao: '2026-09-30',
    };
    expect((await post(dp, `${I}/lancamentos`, lancar)).statusCode).toBe(404);
    expect((await post(consulta, `${I}/de-para`, DE_PARA)).statusCode).toBe(403);
    expect((await post(consulta, `${I}/lancamentos`, lancar)).statusCode).toBe(403);
    expect(
      (await post(consulta, `${I}/previa`, { empresa: 1, origem: 'fechamento', id: 1 })).statusCode,
    ).toBe(403);
    expect((await post(dp, `${I}/de-para`, { ...DE_PARA, destinos: [] })).statusCode).toBe(400);
    expect((await post(dp, `${I}/lancamentos`, { ...lancar, resumo: 'x' })).statusCode).toBe(400);
    expect((await post(dp, `${I}/previa`, { empresa: 1, origem: 'outra', id: 1 })).statusCode).toBe(400);
    expect((await get(dp, `${I}/custo?empresa=1&periodo=2026-13`)).statusCode).toBe(400);
  });
});
