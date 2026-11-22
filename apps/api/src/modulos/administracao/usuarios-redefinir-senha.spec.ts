// W1-01 (parte 2b) pela HTTP: POST /api/administracao/acesso/usuarios/:login/senha-provisoria, com a sessão real
// sobre a fonte sintética (nada conecta a banco), com o módulo da administração registrado: reautenticação
// obrigatória, segregação (a própria não), a provisória volta só na resposta sem cache, a sessão do usuário cai e a
// trilha não leva a senha. Sem convivência com sistema anterior (ADR 0003), a senha é sempre a do produto: o caso
// "troca pelo novo desligada" (operação desligada, 409) deixou de existir e saiu daqui.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { modulo } from './modulo.js';

const A = '/api/administracao/acesso';
let chave = 0;

async function subir(extra: Record<string, string>) {
  const env: Record<string, string> = {
    ...envTeste,
    AMBIENTE: 'dev',
    API_MODULOS: 'administracao',
    ...extra,
  };
  const trilha = new RegistradorTrilhaMemoria();
  const app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: { administracao: async () => ({ modulo: (ctx) => modulo(ctx) }) },
  });
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
