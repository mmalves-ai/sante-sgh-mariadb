// Boot mínimo (F2-L): a base sobe sem o boot antigo, os serviços de módulos não migrados respondem 501 (nunca 503
// calado), API_MODULOS inválido recusa a montagem e a trilha própria grava pelo Escritor do núcleo, só com códigos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from './app.js';
import { acaoDoEvento, type NucleoEscrita, RegistradorTrilhaPropria } from './autorizacao/trilha-propria.js';
import { USUARIO_DESCONHECIDO } from './autorizacao/trilha.js';
import { lerConfiguracao } from './configuracao.js';
import { envTeste } from './sessao/teste.spec-util.js';

const env: Record<string, string> = { ...envTeste };
let app: NestFastifyApplication;
beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

describe('boot mínimo', () => {
  it('saúde e seletor respondem; login sintético em ci', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/saude' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/estabelecimentos' })).statusCode).toBe(200);
  });

  it('rota de módulo fora do boot: 404 (não montada)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/configuracao/parametros' })).statusCode).toBe(404);
  });

  it('"Esqueci a senha", certificado e troca rápida (módulos não migrados): 501, disponibilidade falsa', async () => {
    const h = { host: 'localhost' };
    const disp = await app.inject({
      method: 'GET',
      url: '/api/sessao/recuperacao/disponivel?estabelecimento=aa',
      headers: h,
    });
    expect(disp.json()).toEqual({ disponivel: false });
    const cert = await app.inject({
      method: 'GET',
      url: '/api/sessao/certificado/disponivel?estabelecimento=aa',
      headers: h,
    });
    expect(cert.json()).toEqual({ disponivel: false, agenteLocal: null });
    for (const [url, payload] of [
      ['/api/sessao/recuperacao', { estabelecimento: 'aa', login: 'x' }],
      ['/api/sessao/recuperacao/usar', { token: 'x'.repeat(43) }],
      ['/api/sessao/certificado/desafio', { estabelecimento: 'aa', login: 'x' }],
      ['/api/sessao/troca-rapida', { login: 'x', pin: '123456' }],
    ] as const) {
      const r = await app.inject({ method: 'POST', url, headers: h, payload });
      expect(r.statusCode, url).toBe(501);
      expect(r.json().title).toBe('Módulo não migrado');
    }
  });

  it('API_MODULOS com módulo não migrado: a montagem é recusada com a mensagem', async () => {
    const ruim = { ...env, API_MODULOS: 'sessao,pep' };
    await expect(criarApp(lerConfiguracao(ruim), null, ruim)).rejects.toThrow(/faturamento/);
  });
});

describe('sessão sintética com o núcleo do cliente em dev', () => {
  // Núcleo presente (o banco do cliente) e a fonte de acesso sintética: a trava olha o núcleo, não a fonte. O núcleo
  // aqui é só a presença (nenhuma chamada chega a ele com a fonte sintética).
  const nucleo = {} as NucleoProprio;
  const dev = { ...env, AMBIENTE: 'dev', ACESSO_FONTE_DEV: 'sintetica' };

  async function sessaoSemCookie(e: Record<string, string>): Promise<number> {
    const a = await criarApp(lerConfiguracao(e), nucleo, e);
    try {
      await a.init();
      await a.getHttpAdapter().getInstance().ready();
      return (await a.inject({ method: 'GET', url: '/api/sessao', headers: { host: 'localhost' } })).statusCode;
    } finally {
      await a.close();
    }
  }

  it('sem SESSAO_SINTETICA=sim: GET /api/sessao sem cookie é 401', async () => {
    expect(await sessaoSemCookie(dev)).toBe(401);
  });

  it('com SESSAO_SINTETICA=sim: a sintética responde (200)', async () => {
    expect(await sessaoSemCookie({ ...dev, SESSAO_SINTETICA: 'sim' })).toBe(200);
  });
});

describe('trilha própria', () => {
  function falso() {
    const sqls: { sql: string; p: readonly unknown[] }[] = [];
    const contextos: unknown[] = [];
    const w = {
      uma: (sql: string, p: readonly unknown[] = []) => {
        sqls.push({ sql, p });
        return Promise.resolve(sql.includes('FROM estabelecimento') ? { id: 7 } : { id: 42 });
      },
      inserir: (sql: string, p: readonly unknown[] = []) => {
        sqls.push({ sql, p });
        return Promise.resolve(99);
      },
    } as unknown as Escritor;
    const nucleo: NucleoEscrita = {
      escrever: (ctx, fn) => {
        contextos.push(ctx);
        return fn(w);
      },
    };
    return { nucleo, sqls, contextos };
  }
  const base = {
    rede: 'rede-teste',
    hospital: 'aa',
    estacao: 'ESTACAO:web',
    correlacao: 'c1',
    recurso: 'sessao',
  };

  it('login ok: ação login com os ids do banco do cliente; carga só com códigos', async () => {
    const f = falso();
    const r = await new RegistradorTrilhaPropria(f.nucleo, 'teste_login', () => new Date(0)).registrar({
      ...base,
      evento: 'sessao.login.ok',
      usuario: 'conta.qualquer',
      resultado: 'sucesso',
    });
    expect(r).toEqual({ sgh: '99', legado: null });
    expect(f.contextos[0]).toMatchObject({ cliente: 'teste_login', correlacao: 'c1' });
    const ins = f.sqls.find((s) => s.sql.startsWith('INSERT INTO trilha_auditoria'));
    expect(ins?.p.slice(0, 6)).toEqual([7, 42, new Date(0), 'login', 'sessao', null]);
    expect(String(ins?.p[7])).toContain('sessao.login.ok');
    expect(String(ins?.p[7])).not.toContain('conta.qualquer');
  });

  it('login falho com usuário desconhecido: acesso negado, sem procurar o login digitado', async () => {
    const f = falso();
    await new RegistradorTrilhaPropria(f.nucleo, 'teste_login').registrar({
      ...base,
      evento: 'sessao.login.falho',
      usuario: USUARIO_DESCONHECIDO,
      resultado: 'falha',
    });
    expect(f.sqls.some((s) => s.sql.includes('FROM usuario'))).toBe(false);
    const ins = f.sqls.find((s) => s.sql.startsWith('INSERT'));
    expect(ins?.p[1]).toBeNull();
    expect(ins?.p[3]).toBe('acesso_negado');
  });

  it('mapa de ações', () => {
    expect(acaoDoEvento('sessao.encerrada', 'sucesso')).toBe('logout');
    expect(acaoDoEvento('pep.prontuario.lido', 'sucesso')).toBe('consulta');
    expect(acaoDoEvento('acesso.senha.trocada', 'sucesso')).toBe('operacao');
    expect(acaoDoEvento('acesso.senha.trocada', 'falha')).toBe('acesso_negado');
  });
});
