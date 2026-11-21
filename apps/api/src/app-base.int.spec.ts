// Integração do boot mínimo (F2-L) contra o MariaDB real (cliente teste_login, criado por
// `python3 -I tools/db/criar_cliente.py teste_login "Cliente de teste do login"`): o caminho do marco, com o núcleo,
// a fonte própria e o CLIENTE_PADRAO. Prova pela HTTP: login 201 com cookie Secure e linha 'login' na
// trilha_auditoria; senha errada com linha 'acesso_negado' e tentativas contadas até fechar a porta; troca de senha
// pelo Executor gravando historico_senha; app.close() encerrando os pools do núcleo da app.
// Contas FICTÍCIAS, preparadas de forma idempotente; a senha é gerada a cada execução e nunca sai do processo.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
// Rodar: vitest run --config apps/api/vitest.integracao.config.ts src/app-base.int.spec.ts
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { type Escritor, type Linha, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from './app.js';
import { lerConfiguracao } from './configuracao.js';
import { COOKIE_CSRF, COOKIE_SESSAO_DEV } from './sessao/cookies.js';
import { REDE } from './sessao/teste.spec-util.js';

const CLIENTE = 'teste_login';
const EST = 'tlogin';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const INICIO = '2026-01-01';
const LOGIN_OK = 'teste.boot.ok';
const LOGIN_ERRA = 'teste.boot.erra';
/** Administrador da plataforma FICTÍCIO no banco plataforma de uso (criado e removido por este arquivo). */
const LOGIN_PLATAFORMA = 'teste.boot.plataforma';
const EMAIL_PLATAFORMA = 'teste.boot.plataforma@exemplo.invalid';
const RAIZ = resolve(import.meta.dirname, '../../..');

/** SQL no banco plataforma pelo tools/db/sql.sh (sem expor a senha do banco). */
function sqlPlataforma(texto: string): string {
  return execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), 'plataforma', '-N'], {
    input: texto,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
const LIMPAR_PLATAFORMA = `SET @adm = (SELECT id FROM administrador_plataforma WHERE email = '${EMAIL_PLATAFORMA}');
DELETE FROM cliente_evento WHERE administrador_plataforma_id = @adm;
DELETE FROM credencial_administrador_plataforma WHERE administrador_plataforma_id = @adm;
DELETE FROM administrador_plataforma WHERE id = @adm;`;

describe.skipIf(SEM_BANCO)('boot mínimo sobre o MariaDB (cliente teste_login)', () => {
  /** Núcleo da app (fechado pelo app.close()). */
  let nucleoApp: NucleoProprio;
  /** Núcleo do preparo e das conferências (independente do da app). */
  let conferencia: NucleoProprio;
  let app: NestFastifyApplication;
  let fechada = false;
  const senha = `T${randomUUID()}9`;
  const ids: Record<string, number> = {};
  const h = { host: 'localhost' };

  const ler = <T extends Linha>(sql: string, p: unknown[]): Promise<T | null> =>
    conferencia.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-boot' }, (l) => l.uma<T>(sql, p));
  const maxTrilha = async (): Promise<number> =>
    Number((await ler<{ m: number | null }>('SELECT MAX(id) AS m FROM trilha_auditoria', []))?.m ?? 0);
  const contarTrilha = async (desde: number, acao: string, usuarioId: number): Promise<number> =>
    Number(
      (
        await ler<{ n: number }>(
          'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE id > ? AND acao = ? AND usuario_id = ?',
          [desde, acao, usuarioId],
        )
      )?.n ?? 0,
    );

  beforeAll(async () => {
    conferencia = new NucleoProprio();
    expect((await conferencia.cliente(CLIENTE)).banco).toBe('cliente_teste_login');
    const resumo = await cifrarSenha(senha);
    await conferencia.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-boot' }, async (e: Escritor) => {
      const agora = new Date();
      const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      const est = await garantir(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital de teste ${EST}`, `Hospital de teste ${EST} (fictício)`, agora],
      );
      await garantir(
        'SELECT id FROM politica_senha WHERE estabelecimento_id = ?',
        [est],
        `INSERT INTO politica_senha (estabelecimento_id, tamanho_minimo, exige_numero, tentativas_ate_bloqueio,
           inatividade_sessao_minutos, aviso_fim_sessao_minutos, validade_dias, criado_em) VALUES (?, 10, TRUE, 4, 20, 2, 60, ?)`,
        [est, agora],
      );
      for (const login of [LOGIN_OK, LOGIN_ERRA]) {
        const id = await garantir(
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [login, `Conta fictícia ${login}`, agora],
        );
        await e.executar(
          "UPDATE usuario SET situacao = 'ativo', bloqueado_em = NULL, expira_em = NULL, excluido_em = NULL WHERE id = ?",
          [id],
        );
        await garantir(
          'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
          [id, est],
          'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [id, est, INICIO, agora],
        );
        await e.executar(
          'UPDATE usuario_estabelecimento SET vigencia_fim = NULL, excluido_em = NULL WHERE usuario_id = ? AND estabelecimento_id = ?',
          [id, est],
        );
        await e.executar('DELETE FROM credencial_usuario WHERE usuario_id = ?', [id]);
        await e.inserir(
          'INSERT INTO credencial_usuario (usuario_id, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em) VALUES (?, ?, ?, FALSE, ?)',
          [id, resumo, agora, agora],
        );
        ids[login] = id;
      }
    });

    const env: Record<string, string> = {
      AMBIENTE: 'dev',
      PRODUTO_NOME: 'Produto de teste',
      REDE_PADRAO: REDE,
      CLIENTE_PADRAO: CLIENTE,
      ACESSO_FONTE_DEV: 'propria',
    };
    nucleoApp = new NucleoProprio();
    app = await criarApp(lerConfiguracao(env), nucleoApp, env, { encerrarNucleo: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (!SEM_BANCO) sqlPlataforma(LIMPAR_PLATAFORMA);
    if (!fechada) await app?.close();
    await conferencia?.encerrar();
  });

  const cookies = (r: { headers: Record<string, unknown> }): string[] => {
    const c = r.headers['set-cookie'];
    return Array.isArray(c) ? (c as string[]) : typeof c === 'string' ? [c] : [];
  };
  const valor = (lista: string[], nome: string): string =>
    lista.find((c) => c.startsWith(`${nome}=`))?.split(';')[0]?.slice(nome.length + 1) ?? '';

  it('login: 201 com cookie Secure e uma linha "login" na trilha_auditoria com o usuario_id', async () => {
    const desde = await maxTrilha();
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      headers: h,
      payload: { estabelecimento: EST, login: LOGIN_OK, senha },
    });
    expect(r.statusCode).toBe(201);
    const c = cookies(r);
    const sessao = c.find((x) => x.startsWith(`${COOKIE_SESSAO_DEV}=`)) ?? '';
    expect(sessao).toMatch(/;\s*Secure/);
    expect(sessao).toMatch(/HttpOnly/);
    expect(await contarTrilha(desde, 'login', ids[LOGIN_OK] ?? -1)).toBe(1);
  });

  it('senha errada: 401 com linha "acesso_negado"; as tentativas contam até fechar a porta (429)', async () => {
    const desde = await maxTrilha();
    const tentar = () =>
      app.inject({
        method: 'POST',
        url: '/api/sessao',
        headers: h,
        payload: { estabelecimento: EST, login: LOGIN_ERRA, senha: `${senha}x` },
      });
    const status: number[] = [];
    for (let i = 0; i < 5; i++) status.push((await tentar()).statusCode);
    // Política do tlogin: 4 tentativas; a quinta já encontra a porta fechada.
    expect(status).toEqual([401, 401, 401, 401, 429]);
    expect(await contarTrilha(desde, 'acesso_negado', ids[LOGIN_ERRA] ?? -1)).toBeGreaterThanOrEqual(1);
  });

  it('troca de senha pela HTTP: grava historico_senha pelo Executor e a senha nova entra', async () => {
    const entrada = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      headers: h,
      payload: { estabelecimento: EST, login: LOGIN_OK, senha },
    });
    expect(entrada.statusCode).toBe(201);
    const c = cookies(entrada);
    const sid = valor(c, COOKIE_SESSAO_DEV);
    const csrf = valor(c, COOKIE_CSRF);
    const usuarioId = ids[LOGIN_OK] ?? -1;
    const antes = Number(
      (await ler<{ n: number }>('SELECT COUNT(*) AS n FROM historico_senha WHERE usuario_id = ?', [usuarioId]))?.n ??
        0,
    );
    const nova = `N${randomUUID()}7`;
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao/senha',
      headers: { ...h, cookie: `${COOKIE_SESSAO_DEV}=${sid}; ${COOKIE_CSRF}=${csrf}`, 'x-csrf': csrf },
      payload: { senhaAtual: senha, senhaNova: nova, confirmacao: nova },
    });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    const depois = Number(
      (await ler<{ n: number }>('SELECT COUNT(*) AS n FROM historico_senha WHERE usuario_id = ?', [usuarioId]))?.n ??
        0,
    );
    expect(depois).toBe(antes + 1);
    const comNova = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      headers: h,
      payload: { estabelecimento: EST, login: LOGIN_OK, senha: nova },
    });
    expect(comNova.statusCode).toBe(201);
  });

  it('administrador da plataforma pela HTTP: 201 com todas as permissões, falha contada no banco plataforma, troca com evento', async () => {
    const resumo = await cifrarSenha(senha);
    const adm = Number(
      sqlPlataforma(`${LIMPAR_PLATAFORMA}
INSERT INTO administrador_plataforma (nome, email, ativo, criado_em)
  VALUES ('Administrador fictício do boot', '${EMAIL_PLATAFORMA}', TRUE, NOW(3));
INSERT INTO credencial_administrador_plataforma
    (administrador_plataforma_id, login, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em)
  VALUES (LAST_INSERT_ID(), '${LOGIN_PLATAFORMA}', '${resumo}', NOW(3), FALSE, NOW(3));
SELECT administrador_plataforma_id FROM credencial_administrador_plataforma WHERE login = '${LOGIN_PLATAFORMA}';`),
    );
    expect(adm).toBeGreaterThan(0);
    const contagem = () =>
      sqlPlataforma(
        `SELECT tentativas_falhas FROM credencial_administrador_plataforma WHERE administrador_plataforma_id = ${adm};`,
      );
    const entrar = (login: string, s: string) =>
      app.inject({
        method: 'POST',
        url: '/api/sessao/plataforma',
        headers: h,
        payload: { estabelecimento: EST, login, senha: s },
      });
    // Login com caractere invisível: recusado pelo contrato (400), sem chegar ao banco.
    expect((await entrar('teste.boot.plata\u200bforma', `${senha}x`)).statusCode).toBe(400);
    expect(contagem()).toBe('0');
    // Senha errada: 401 e a tentativa contada na credencial (banco plataforma).
    expect((await entrar(LOGIN_PLATAFORMA, `${senha}x`)).statusCode).toBe(401);
    expect(contagem()).toBe('1');
    // Senha certa (maiúsculas viram minúsculas): 201, cookie Secure, ator da plataforma, contagem zerada.
    const r = await entrar(LOGIN_PLATAFORMA.toUpperCase(), senha);
    expect(r.statusCode, r.body.slice(0, 300)).toBe(201);
    const c = cookies(r);
    expect(c.find((x) => x.startsWith(`${COOKIE_SESSAO_DEV}=`)) ?? '').toMatch(/;\s*Secure/);
    const corpo = r.json() as { usuario: { id: string; ator?: string; login?: string }; permissoes: string[] };
    expect(corpo.usuario.ator).toBe('plataforma');
    expect(corpo.usuario.id).toBe(`plataforma:${adm}`);
    expect(corpo.permissoes.length).toBeGreaterThan(10);
    expect(contagem()).toBe('0');
    // Troca de senha pela HTTP: gravada no banco plataforma com o evento do cliente.
    const sid = valor(c, COOKIE_SESSAO_DEV);
    const csrf = valor(c, COOKIE_CSRF);
    const nova = `N${randomUUID()}7`;
    const t = await app.inject({
      method: 'POST',
      url: '/api/sessao/senha',
      headers: { ...h, cookie: `${COOKIE_SESSAO_DEV}=${sid}; ${COOKIE_CSRF}=${csrf}`, 'x-csrf': csrf },
      payload: { senhaAtual: senha, senhaNova: nova, confirmacao: nova },
    });
    expect(t.statusCode, t.body.slice(0, 300)).toBe(200);
    expect(
      sqlPlataforma(
        `SELECT COUNT(*) FROM cliente_evento e JOIN cliente c ON c.id = e.cliente_id
          WHERE c.codigo = '${CLIENTE}' AND e.tipo = 'senha_administrador_trocada' AND e.administrador_plataforma_id = ${adm};`,
      ),
    ).toBe('1');
    expect((await entrar(LOGIN_PLATAFORMA, nova)).statusCode).toBe(201);
  });

  it('app.close() encerra os pools do núcleo da app', async () => {
    expect(nucleoApp.estadosDosPools().length).toBeGreaterThan(0);
    await app.close();
    fechada = true;
    expect(nucleoApp.estadosDosPools()).toEqual([]);
    await expect(
      nucleoApp.lerSomente({ cliente: CLIENTE, correlacao: 'depois-do-fim' }, (l) => l.uma('SELECT 1 AS um', [])),
    ).rejects.toThrow(/encerrad/i);
  });
});
