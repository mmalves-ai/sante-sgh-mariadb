// M53.7 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): o fechamento
// da folha e os periódicos do eSocial, cada rota pela permissão da opção do outro sistema. O departamento pessoal (com a
// liberação do mês e a abertura do mês/ano) fecha e reabre; quem só acompanha o eSocial (5109) vê o painel dos
// periódicos e não gera; quem só consulta a folha (351) lista os fechamentos e não fecha. A chave `pessoas.folha` nasce
// desligada: a prévia sai, fechar é recusado na chave; a entrada inválida é 400.
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
const post = (cookie: string, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '', 'idempotency-key': `m53-7-${Math.random()}` },
    payload: payload as Record<string, unknown>,
  });
const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

const F = '/api/pessoas/folha/fechamentos';
const E = '/api/pessoas/esocial/periodicos';
const PERIODO = { empresa: 1, apuracao: 'mensal', periodo: '2026-09' };

describe('fechamento da folha e periódicos: cada rota pela sua permissão', { timeout: 180_000 }, () => {
  it('leituras por usuário', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const consultaEsocial = await entrar('SINT.ESOCIAL.CONSULTA');
    const consultaFolha = await entrar('SINT.FOLHA.CONSULTA');
    const painel = `${E}?empresa=1&apuracao=mensal&periodo=2026-09`;
    expect((await get(dp, F)).statusCode).toBe(200);
    expect((await get(dp, `${F}/999999`)).statusCode).toBe(404);
    expect((await get(dp, painel)).statusCode).toBe(200);
    expect((await get(consultaEsocial, painel)).statusCode).toBe(200);
    expect((await get(consultaEsocial, F)).statusCode).toBe(403);
    expect((await get(consultaFolha, F)).statusCode).toBe(200);
    expect((await get(consultaFolha, painel)).statusCode).toBe(403);
    const p = (await get(dp, painel)).json();
    expect(p).toMatchObject({ folha: null, situacao: 'aberto' });
    expect(p.pendencias.map((x: { codigo: string }) => x.codigo)).toContain('folha-nao-fechada');
  });

  it('prévia sai com a chave desligada; fechar e gerar são recusados na chave; sem permissão é 403; inválido é 400', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const previa = await post(dp, F, { ...PERIODO, pagamento: '2026-10-05', simular: true });
    expect(previa.statusCode, previa.body).toBe(200);
    expect(previa.json()).toMatchObject({ simulado: true, fechado: false });
    const fechar = await post(dp, F, { ...PERIODO, pagamento: '2026-10-05', simular: false });
    expect(fechar.json()).toMatchObject({ codigo: 'recurso-desligado' });
    expect(
      (await post(dp, `${F}/1/reabertura`, { versao: 0, motivo: 'Correção da folha' })).json(),
    ).toMatchObject({
      codigo: 'recurso-desligado',
    });
    const s1200 = await post(dp, `${E}/remuneracao`, { ...PERIODO, gravar: true });
    expect(s1200.json()).toMatchObject({ codigo: 'recurso-desligado' });
    const consulta = await entrar('SINT.FOLHA.CONSULTA');
    expect((await post(consulta, F, { ...PERIODO, pagamento: null, simular: true })).statusCode).toBe(403);
    const esocial = await entrar('SINT.ESOCIAL.CONSULTA');
    for (const rota of ['remuneracao', 'fechamento', 'reabertura'])
      expect((await post(esocial, `${E}/${rota}`, { ...PERIODO, gravar: false })).statusCode, rota).toBe(403);
    expect(
      (await post(esocial, `${E}/pagamentos`, { empresa: 1, periodo: '2026-10', gravar: false })).statusCode,
    ).toBe(403);
    expect(
      (await post(dp, F, { ...PERIODO, periodo: '2026', pagamento: null, simular: true })).statusCode,
    ).toBe(400);
    expect(
      (await post(dp, F, { ...PERIODO, apuracao: 'anual', periodo: '2026-09', simular: true })).statusCode,
    ).toBe(400);
    expect((await get(dp, `${E}?empresa=1&apuracao=mensal&periodo=2026-13`)).statusCode).toBe(400);
    expect((await post(dp, `${F}/1/reabertura`, { versao: 0, motivo: 'x' })).statusCode).toBe(400);
  });
});
