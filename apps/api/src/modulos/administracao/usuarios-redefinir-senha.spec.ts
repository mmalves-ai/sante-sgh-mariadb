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
import { criarContaComSenhaInicial, SENHA_INICIAL_PENDENTE } from './criacao-com-senha.js';
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

describe('criar a conta com a senha inicial (regra da composição)', () => {
  const preparada = { senha: 'sintetica-123', resumo: '$argon2id$v=19$m=8,t=1,p=1$c2FsdA$aGFzaA' };

  it('a conta nasce com o resumo na própria criação; a recusa da criação sobe sem senha na resposta', async () => {
    const recebidos: (string | null)[] = [];
    const r = await criarContaComSenhaInicial(
      async () => preparada,
      async (resumo) => {
        recebidos.push(resumo);
        return { idUsuario: 7 };
      },
    );
    expect(recebidos).toEqual([preparada.resumo]);
    expect(r).toEqual({
      conta: { idUsuario: 7 },
      senhaInicial: { emitida: true, senha: { senhaProvisoria: 'sintetica-123', trocaObrigatoria: true } },
    });
    await expect(
      criarContaComSenhaInicial(
        async () => preparada,
        async () => {
          throw new Error('login-em-uso');
        },
      ),
    ).rejects.toThrow('login-em-uso');
    // A troca obrigatória é a da credencial gravada pela receita: a conclusão (serviço da identidade) roda com a conta
    // e a senha, mas o desfecho dela (regravação recusada ou com falha) nunca rebaixa a troca obrigatória.
    const concluidas: [number, string][] = [];
    for (const desfecho of [async () => false, async () => Promise.reject(new Error('identidade-fora'))]) {
      const c = await criarContaComSenhaInicial(
        async () => preparada,
        async () => ({ idUsuario: 11 }),
        async (conta, senha) => {
          concluidas.push([conta.idUsuario, senha]);
          return desfecho();
        },
      );
      expect(c.senhaInicial).toEqual({
        emitida: true,
        senha: { senhaProvisoria: 'sintetica-123', trocaObrigatoria: true },
      });
    }
    expect(concluidas).toEqual([
      [11, 'sintetica-123'],
      [11, 'sintetica-123'],
    ]);
  });

  it('sem como gerar a senha: a conta nasce sem credencial e a resposta diz pendente, com o motivo', async () => {
    const semPorta = await criarContaComSenhaInicial(null, async (resumo) => ({ idUsuario: 8, resumo }));
    expect(semPorta).toEqual({
      conta: { idUsuario: 8, resumo: null },
      senhaInicial: { emitida: false, motivo: SENHA_INICIAL_PENDENTE },
    });
    const falhou = await criarContaComSenhaInicial(
      async () => {
        throw Object.assign(new Error('x'), { detalhe: 'Serviço de senha indisponível.' });
      },
      async (resumo) => ({ idUsuario: 9, resumo }),
    );
    expect(falhou.conta).toEqual({ idUsuario: 9, resumo: null });
    expect(falhou.senhaInicial).toEqual({
      emitida: false,
      motivo: `${SENHA_INICIAL_PENDENTE} (Serviço de senha indisponível.)`,
    });
    const vazia = await criarContaComSenhaInicial(
      async () => ({ senha: '', resumo: '' }),
      async (resumo) => ({ idUsuario: 10, resumo }),
    );
    expect(vazia.senhaInicial.emitida).toBe(false);
    expect(vazia.conta.resumo).toBeNull();
  });
});

describe('criar usuário pela HTTP: a senha inicial volta na resposta da criação (01-ADM L57)', () => {
  let app: NestFastifyApplication;
  let trilha: RegistradorTrilhaMemoria;
  beforeAll(async () => {
    ({ app, trilha } = await subir({ ACESSO_TROCA_SENHA_PELO_NOVO: 'sim' }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('cria e devolve a senha inicial sem cache e sem trilha da senha; a criação recusada não devolve senha', async () => {
    const c = cliente(app);
    const g = await c.entrar('SINT.GESTOR');
    expect(g.status).toBeLessThan(300);
    const opcoes = (await c.get(g, `${A}/usuarios-opcoes`)).json() as {
      grupos: { nome: string; ativo: boolean }[];
    };
    const grupo = opcoes.grupos.find((x) => x.ativo)?.nome ?? '';
    expect(grupo).not.toBe('');
    const entrada = { login: 'SINT.NOVA57', nomeCompleto: 'USUARIA SINTETICA NOVA', grupo };

    const semSenha = await c.post(g, `${A}/usuarios`, { entrada });
    expect(semSenha.statusCode).toBe(401);

    const r = await c.post(g, `${A}/usuarios`, { entrada, senha: SENHA });
    expect(r.statusCode).toBe(201);
    expect(r.headers['cache-control']).toBe('no-store');
    const corpo = r.json() as Record<string, unknown>;
    expect(corpo['operacao']).toBe('acesso.criarUsuario');
    expect(corpo['senhaPendente']).toBeUndefined();
    expect(String(corpo['senhaProvisoria'])).toMatch(/^.{12,}$/);
    expect(JSON.stringify(trilha)).not.toContain(String(corpo['senhaProvisoria']));

    expect(corpo['trocaObrigatoria']).toBe(true);
    // A ficha já mostra a conta com senha definida: a credencial nasceu na própria criação.
    const ficha = (await c.get(g, `${A}/usuarios/SINT.NOVA57`)).json() as {
      usuario?: { senhaDefinida?: boolean };
    };
    expect(ficha.usuario?.senhaDefinida).toBe(true);
    // O resumo da senha só o servidor põe: vindo de fora, recusa (nada criado).
    const forjada = await c.post(g, `${A}/usuarios`, {
      entrada: {
        ...entrada,
        login: 'SINT.NOVA58',
        resumoSenhaInicial: '$argon2id$v=19$m=8,t=1,p=1$c2FsdA$aGFzaA',
      },
      senha: SENHA,
    });
    expect(forjada.statusCode).toBe(400);
    expect((await c.get(g, `${A}/usuarios/SINT.NOVA58`)).statusCode).toBeGreaterThanOrEqual(400);

    // Login repetido: recusa da criação, sem senha na resposta.
    const repetido = await c.post(g, `${A}/usuarios`, { entrada, senha: SENHA });
    expect(repetido.statusCode).toBeGreaterThanOrEqual(400);
    expect(repetido.body).not.toContain('senhaProvisoria');
  });
});
