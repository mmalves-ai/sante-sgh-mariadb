// W1-01 (parte 2b) pela HTTP: POST /api/administracao/acesso/usuarios/:login/senha-provisoria, com a sessão real
// sobre a fonte sintética (nada conecta a banco). Com a troca pelo novo ligada (ACESSO_TROCA_SENHA_PELO_NOVO=sim, porta
// em memória): reautenticação obrigatória, segregação (a própria não), a provisória volta só na resposta sem cache, a
// sessão do usuário cai e a trilha não leva a senha. Desligada: a ficha mostra a operação desligada com o motivo e a
// gravação responde 409.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';

const A = '/api/administracao/acesso';
let chave = 0;

async function subir(extra: Record<string, string>) {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', ...extra };
  const trilha = new RegistradorTrilhaMemoria();
  const app = await criarApp(lerConfiguracao(env), null, env, { trilha });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, trilha };
}

function cliente(app: NestFastifyApplication) {
  const entrar = async (login: string, senha = SENHA) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha },
    });
    const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
    return {
      status: r.statusCode,
      corpo: r.statusCode < 300 ? r.json() : null,
      cookie: set.map((c) => c.split(';')[0]).join('; '),
      csrf:
        set
          .find((c) => c.startsWith('sgh_csrf='))
          ?.split(';')[0]
          ?.slice(9) ?? '',
    };
  };
  type S = Awaited<ReturnType<typeof entrar>>;
  const get = (s: S, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
  const post = (s: S, url: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        cookie: s.cookie,
        'x-csrf': s.csrf,
        'idempotency-key': `teste-w101-${++chave}-${Date.now()}`,
      },
      payload,
    });
  return { entrar, get, post };
}

describe('redefinir a senha pela ficha (troca pelo novo ligada)', () => {
  let app: NestFastifyApplication;
  let trilha: RegistradorTrilhaMemoria;
  beforeAll(async () => {
    ({ app, trilha } = await subir({ ACESSO_TROCA_SENHA_PELO_NOVO: 'sim' }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('reautentica, devolve a provisória sem cache, derruba a sessão do usuário; a própria e sem senha são recusadas', async () => {
    const c = cliente(app);
    const g = await c.entrar('SINT.GESTOR');
    const alvo = await c.entrar('SINT.FATURISTA');
    expect((await c.get(alvo, '/api/sessao')).statusCode).toBe(200);
    const ficha = (await c.get(g, `${A}/usuarios/SINT.FATURISTA`)).json();
    expect(
      ficha.operacoes.find((o: { operacao: string }) => o.operacao === 'acesso.redefinirSenha'),
    ).toMatchObject({
      ligada: true,
    });

    const semSenha = await c.post(g, `${A}/usuarios/SINT.FATURISTA/senha-provisoria`, {});
    expect(semSenha.statusCode).toBe(401);
    const proprio = await c.post(g, `${A}/usuarios/SINT.GESTOR/senha-provisoria`, { senha: SENHA });
    expect(proprio.statusCode).toBe(409);

    const r = await c.post(g, `${A}/usuarios/SINT.FATURISTA/senha-provisoria`, { senha: SENHA });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const corpo = r.json();
    expect(corpo.operacao).toBe('acesso.redefinirSenha');
    expect(corpo.senhaProvisoria).toMatch(/^.{12,}$/);
    expect((await c.get(alvo, '/api/sessao')).statusCode).toBe(401);
    // Varredura: a provisória e a senha do gestor não vão à trilha.
    const t = JSON.stringify(trilha);
    expect(t).not.toContain(corpo.senhaProvisoria);
  });
});

describe('redefinir a senha pela ficha (troca pelo novo desligada)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    ({ app } = await subir({}));
  });
  afterAll(async () => {
    await app.close();
  });

  it('a ficha mostra a operação desligada com o motivo; a gravação responde 409 com o código', async () => {
    const c = cliente(app);
    const g = await c.entrar('SINT.GESTOR');
    const ficha = (await c.get(g, `${A}/usuarios/SINT.FATURISTA`)).json();
    const op = ficha.operacoes.find((o: { operacao: string }) => o.operacao === 'acesso.redefinirSenha');
    expect(op.ligada).toBe(false);
    expect(op.motivo).toMatch(/formato da senha/);
    const r = await c.post(g, `${A}/usuarios/SINT.FATURISTA/senha-provisoria`, { senha: SENHA });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('troca-indisponivel');
  });
});
