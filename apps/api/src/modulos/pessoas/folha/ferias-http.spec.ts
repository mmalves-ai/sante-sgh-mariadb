// M53.4 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): cada rota de
// férias e 13º pela permissão da opção do outro sistema. O departamento pessoal (férias 387, liberação 395, 13º 382)
// abre tudo; quem só consulta a folha (351) vê as parcelas do 13º, não as férias, e não calcula; quem só tem os eventos
// (367) abre o apoio da área e nada mais. A chave `pessoas.folha` nasce desligada: programar e calcular de verdade são
// recusados, a prévia do 13º sai. O autosserviço vê só as próprias férias.
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
const P = '/api/pessoas/folha';
const LEITURAS = [
  `${P}/ferias/apoio`,
  `${P}/ferias?de=2026-11-01&ate=2026-12-31`,
  `${P}/ferias/saldo?vinculo=999999`,
  `${P}/ferias/999999`,
  `${P}/decimo?empresa=1&ano=2026`,
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
    headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '', 'idempotency-key': `m53-4-${Math.random()}` },
    payload: payload as Record<string, unknown>,
  });

describe('férias e 13º: cada rota pela sua permissão', { timeout: 180_000 }, () => {
  it('leituras por usuário (colaborador e férias inexistentes são 404 para quem pode ver)', async () => {
    expect(await situacoes('SINT.DP.FOLHA')).toEqual([200, 200, 404, 404, 200]);
    expect(await situacoes('SINT.FOLHA.CONSULTA')).toEqual([200, 403, 403, 403, 200]);
    expect(await situacoes('SINT.FOLHA.EVENTOS')).toEqual([200, 403, 403, 403, 403]);
  });

  it('recibo de férias em PDF: leitura das férias e o salário; consulta e eventos não abrem', async () => {
    const pdf = async (login: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `${P}/ferias/999999/recibo/pdf`,
          headers: { cookie: await entrar(login) },
        })
      ).statusCode;
    expect(await pdf('SINT.DP.FOLHA')).toBe(404);
    expect(await pdf('SINT.FOLHA.CONSULTA')).toBe(403);
    expect(await pdf('SINT.FOLHA.EVENTOS')).toBe(403);
  });

  it('gravar com a chave desligada é recusado; a prévia do 13º sai; a consulta não calcula; entrada inválida é 400', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const apoio = await app.inject({ method: 'GET', url: `${P}/ferias/apoio`, headers: { cookie: dp } });
    expect(apoio.json()).toMatchObject({
      gravacao: { ligada: false },
      acoes: { programar: false, calcularFerias: false, calcularDecimo: false, verSalario: true },
    });
    const decimo = { empresa: 1, ano: 2026, parcela: 1, pagamento: '2026-11-20' };
    const previa = await post(dp, `${P}/decimo`, { ...decimo, simular: true });
    expect(previa.statusCode, previa.body).toBe(200);
    expect(previa.json()).toMatchObject({ calculado: false, simulado: true });
    expect((await post(dp, `${P}/decimo`, { ...decimo, simular: false })).statusCode).toBe(403);
    const programar = await post(dp, `${P}/ferias`, {
      vinculo: 1,
      empresa: 1,
      aquisitivoInicio: '2025-01-05',
      inicio: '2026-11-30',
      dias: 30,
      abono: 0,
      adiantarDecimo: false,
    });
    expect(programar.statusCode).toBe(403);
    const consulta = await entrar('SINT.FOLHA.CONSULTA');
    expect((await post(consulta, `${P}/decimo`, { ...decimo, simular: true })).statusCode).toBe(403);
    expect((await post(consulta, `${P}/ferias/1/calculo`, { versao: 0, simular: true })).statusCode).toBe(
      403,
    );
    // O descarte da parcela do 13º tem rota própria pela permissão do 13º: a consulta é barrada na guarda; o DP passa
    // da guarda e para na chave desligada.
    const descarte = { versao: 0, motivo: 'Teste sintético' };
    const semDecimo = await post(consulta, `${P}/decimo/999999/descarte`, descarte);
    expect(semDecimo.statusCode).toBe(403);
    expect(semDecimo.json()).not.toMatchObject({ codigo: 'recurso-desligado' });
    const dpDescarte = await post(dp, `${P}/decimo/999999/descarte`, descarte);
    expect(dpDescarte.statusCode, dpDescarte.body).toBe(403);
    expect(dpDescarte.json()).toMatchObject({ codigo: 'recurso-desligado' });
    expect((await post(dp, `${P}/decimo`, { ...decimo, pagamento: '2025-11-20' })).statusCode).toBe(400);
    expect((await post(dp, `${P}/ferias`, { vinculo: 1, empresa: 1 })).statusCode).toBe(400);
  });

  it('autosserviço: só o próprio vínculo; com a folha desligada, só a frase', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const r = await app.inject({ method: 'GET', url: '/api/pessoas/meu/ferias', headers: { cookie: dp } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ disponivel: false, saldo: null });
    const outro = await app.inject({
      method: 'GET',
      url: '/api/pessoas/meu/ferias?vinculo=1',
      headers: { cookie: dp },
    });
    expect(outro.statusCode).toBe(403);
  });
});
