// Porta de entrada pela HTTP (M05): seletor público, login com cookie HttpOnly/SameSite (sem token no
// corpo), erro genérico, GET /api/sessao real × sintética, sair, e as operações em Bloqueio (troca de
// senha e segundo fator). Ambiente SINTÉTICO: nenhuma conexão real, nenhum dado de pessoa.
import {
  esquemaEstabelecimentosEntrada,
  esquemaProblema,
  esquemaSessao,
  tipoDoProblema,
} from '@sgh/contratos';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste } from '../../sessao/teste.spec-util.js';

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

function cookieDe(set: string | string[] | undefined, nome: string): string | null {
  const lista = Array.isArray(set) ? set : set ? [set] : [];
  for (const c of lista) {
    const m = new RegExp(`(?:^|; )?${nome}=([^;]*)`).exec(c);
    if (c.startsWith(`${nome}=`) && m) return m[1] ?? '';
  }
  return null;
}

describe('GET /api/estabelecimentos (seletor, público)', () => {
  it('lista só os estabelecimentos da rede do endereço, com a situação', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/estabelecimentos' });
    expect(r.statusCode).toBe(200);
    const corpo = esquemaEstabelecimentosEntrada.parse(r.json());
    expect(corpo.rede).toBe('rede-teste');
    expect(corpo.estabelecimentos.map((e) => [e.codigo, e.disponivel])).toEqual([
      ['aa', true],
      ['bb', true],
    ]);
    expect(JSON.stringify(corpo)).not.toMatch(/senha|fdb|127\.0\.0\.1/i);
  });
});

/** Entra pela HTTP e devolve o cabeçalho Cookie e o token CSRF (como a tela faria). */
async function entrarHttp(
  login = 'SINT.USUARIO',
  senha = 'Sintetico#2026',
): Promise<{ cookie: string; csrf: string; set: string[] }> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha },
  });
  expect(r.statusCode).toBe(201);
  const bruto = r.headers['set-cookie'];
  const set = Array.isArray(bruto) ? bruto : [String(bruto)];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf: cookieDe(set, 'sgh_csrf') ?? '',
    set,
  };
}

describe('POST /api/sessao (entrar)', () => {
  it('Set-Cookie HttpOnly, Secure e SameSite=Strict (também em dev/ci) e corpo sem token', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.USUARIO', senha: 'Sintetico#2026' },
    });
    expect(r.statusCode).toBe(201);
    const set = r.headers['set-cookie'];
    const lista = Array.isArray(set) ? set : [String(set)];
    const sessao = lista.find((c) => c.startsWith('sgh_sessao=')) ?? '';
    for (const parte of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(sessao).toContain(parte);
    expect(lista.find((c) => c.startsWith('sgh_csrf=')) ?? '').toContain('Secure');
    const s = esquemaSessao.parse(r.json());
    expect(s.sintetica).toBe(false);
    expect(s.usuario.login).toBe('SINT.USUARIO');
    // Nenhum token no corpo (nem id de sessão, nem csrf, nem senha).
    expect(JSON.stringify(s)).not.toMatch(/Sintetico#2026|csrf|idSessao/i);
    for (const c of lista) expect(JSON.stringify(s)).not.toContain(c.split(';')[0]?.split('=')[1] ?? '§');
  });

  it('usuário ou senha inválidos: 401 genérico, sem cookie de sessão', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.USUARIO', senha: 'errada' },
    });
    expect(r.statusCode).toBe(401);
    expect(tipoDoProblema(esquemaProblema.parse(r.json()))).toBe('nao-autenticado');
    expect(cookieDe(r.headers['set-cookie'], 'sgh_sessao')).toBeNull();
  });

  it('conta sem senha guardada: 403 primeiro-acesso, sem cookie (nunca entra com qualquer texto)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.SEMCIFRA', senha: 'qualquer' },
    });
    expect(r.statusCode).toBe(403);
    expect(tipoDoProblema(esquemaProblema.parse(r.json()))).toBe('primeiro-acesso');
    expect(cookieDe(r.headers['set-cookie'], 'sgh_sessao')).toBeNull();
  });

  it('corpo inválido: 400 entrada-invalida', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { login: 'x' } });
    expect(r.statusCode).toBe(400);
    expect(tipoDoProblema(esquemaProblema.parse(r.json()))).toBe('entrada-invalida');
  });

  it('login e senha com acento do CP1252 são aceitos pelo contrato; fora do CP1252, recusados', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.JOÃO', senha: 'Ação#çãõ2026' },
    });
    expect(ok.statusCode).toBe(401); // passou do contrato; usuário sintético inexistente
    const fora = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.USUARIO', senha: 'senha😀' },
    });
    expect(fora.statusCode).toBe(400);
  });
});

describe('rede pelo endereço (ARQ-2)', () => {
  it('endereço desconhecido: o seletor responde 404 rede-desconhecida', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/estabelecimentos',
      headers: { host: 'outra.rede.exemplo' },
    });
    expect(r.statusCode).toBe(404);
    expect(tipoDoProblema(esquemaProblema.parse(r.json()))).toBe('rede-desconhecida');
  });

  it('sessão aberta em localhost não vale sob outro endereço (nem cai na sintética)', async () => {
    const { cookie } = await entrarHttp();
    const outra = await app.inject({
      method: 'GET',
      url: '/api/sessao',
      headers: { cookie, host: 'outra.rede.exemplo' },
    });
    expect(outra.statusCode).toBe(404);
    expect(tipoDoProblema(esquemaProblema.parse(outra.json()))).toBe('rede-desconhecida');
    const entrarFora = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      headers: { host: 'outra.rede.exemplo' },
      payload: { estabelecimento: 'aa', login: 'SINT.USUARIO', senha: 'Sintetico#2026' },
    });
    expect(entrarFora.statusCode).toBe(404);
  });
});

describe('ciclo da sessão real pela HTTP', () => {
  it('GET /api/sessao com o cookie devolve a sessão real; DELETE com CSRF encerra', async () => {
    const { cookie, csrf } = await entrarHttp();
    const atual = await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie } });
    expect(esquemaSessao.parse(atual.json()).sintetica).toBe(false);
    const semCsrf = await app.inject({ method: 'DELETE', url: '/api/sessao', headers: { cookie } });
    expect(semCsrf.statusCode).toBe(403);
    const saiu = await app.inject({
      method: 'DELETE',
      url: '/api/sessao',
      headers: { cookie, 'x-csrf': csrf },
    });
    expect(saiu.statusCode).toBe(204);
    // Cookie de sessão que não vale mais: 401 (não cai na sessão sintética).
    const depois = await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie } });
    expect(depois.statusCode).toBe(401);
  });

  it('CSRF: cookie e cabeçalho iguais mas diferentes do token da sessão → 403', async () => {
    const { cookie, csrf } = await entrarHttp();
    const forjado = 'forjado-0000';
    const trocado = cookie.replace(`sgh_csrf=${csrf}`, `sgh_csrf=${forjado}`);
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao/unidade',
      headers: { cookie: trocado, 'x-csrf': forjado },
      payload: { codigo: 1 },
    });
    expect(r.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/sessao/unidade',
      headers: { cookie, 'x-csrf': csrf },
      payload: { codigo: 1 },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('trocar de estabelecimento com sessão real exige CSRF e encerra a sessão (novo login)', async () => {
    const { cookie, csrf } = await entrarHttp();
    const semCsrf = await app.inject({
      method: 'POST',
      url: '/api/sessao/estabelecimento',
      headers: { cookie },
      payload: { codigo: 'bb' },
    });
    expect(semCsrf.statusCode).toBe(403);
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao/estabelecimento',
      headers: { cookie, 'x-csrf': csrf },
      payload: { codigo: 'bb' },
    });
    expect(r.statusCode).toBe(409);
    expect(tipoDoProblema(esquemaProblema.parse(r.json()))).toBe('outro-estabelecimento');
    expect((await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie } })).statusCode).toBe(
      401,
    );
  });

  it('entrar de novo com o cookie antigo apaga a sessão antiga no servidor', async () => {
    const a = await entrarHttp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      headers: { cookie: a.cookie },
      payload: { estabelecimento: 'aa', login: 'SINT.USUARIO', senha: 'Sintetico#2026' },
    });
    expect(r.statusCode).toBe(201);
    const antiga = await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: a.cookie } });
    expect(antiga.statusCode).toBe(401);
  });
});

describe('Minhas sessões pela HTTP (W1-01, parte 8)', () => {
  it('GET lista as próprias com o dispositivo e sem id; POST encerrar exige CSRF e derruba as outras', async () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      headers: { 'user-agent': ua },
      payload: { estabelecimento: 'aa', login: 'SINT.RECEPCAO', senha: 'Sintetico#2026' },
    });
    expect(r.statusCode).toBe(201);
    const set = ([] as string[]).concat(r.headers['set-cookie'] ?? []);
    const outra = set.map((c) => c.split(';')[0]).join('; ');
    const { cookie, csrf } = await entrarHttp('SINT.RECEPCAO');
    const lista = await app.inject({ method: 'GET', url: '/api/sessao/sessoes', headers: { cookie } });
    expect(lista.statusCode).toBe(200);
    const corpo = lista.json() as { ref: string; atual: boolean; dispositivo: string | null }[];
    expect(corpo).toHaveLength(2);
    expect(corpo.find((x) => !x.atual)?.dispositivo).toBe('Chrome no Windows');
    expect(lista.body).not.toContain(csrf);
    const semCsrf = await app.inject({
      method: 'POST',
      url: '/api/sessao/sessoes/encerrar',
      headers: { cookie },
      payload: {},
    });
    expect(semCsrf.statusCode).toBe(403);
    const ruim = await app.inject({
      method: 'POST',
      url: '/api/sessao/sessoes/encerrar',
      headers: { cookie, 'x-csrf': csrf },
      payload: { ref: 'nada' },
    });
    expect(ruim.statusCode).toBe(400);
    const fim = await app.inject({
      method: 'POST',
      url: '/api/sessao/sessoes/encerrar',
      headers: { cookie, 'x-csrf': csrf },
      payload: {},
    });
    expect(fim.json()).toEqual({ encerradas: 1 });
    expect(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: outra } })).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie } })).statusCode).toBe(
      200,
    );
  });

  it('sem sessão real, em ci: lista vazia (a sintética é uma só)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/sessao/sessoes' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
  });
});

describe('GET /api/sessao sintética (só dev/ci, sem cookie)', () => {
  it('sem cookie, em ci, devolve a sessão sintética para a casca', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/sessao' });
    const s = esquemaSessao.parse(r.json());
    expect(s.sintetica).toBe(true);
    expect(s.estabelecimentos).toEqual([
      { codigo: 'aa', nome: 'Estabelecimento A (teste)' },
      { codigo: 'bb', nome: 'Estabelecimento B (teste)' },
    ]);
    expect(s.estabelecimentoAtivo).toBe('aa');
    // M06: o mesmo cálculo da sessão real, sobre concessões sintéticas (Administrador do sistema e Gestor
    // de acessos): os recursos de toda pessoa, as telas de coexistência e as de acesso.
    expect(s.permissoes).toEqual(
      expect.arrayContaining([
        'acesso.inicio.ler',
        'acesso.preferencia.ler',
        'acesso.preferencia.editar',
        'acesso.sobre.ler',
        'acesso.senha.trocar', // M05
        'acesso.segundofator.gerir', // M05
        'config.schema.ler',
        'config.schema.verificar',
        'config.estabelecimento.ler',
        'config.assinatura.ler', // M03
        'config.gravacao.ler', // M04
        'config.conexao.ler', // M04
        'sistema.saude.ler', // M09
        'documento.emissao.criar',
        'documento.emissao.reemitir',
        'documento.etiqueta.imprimir',
        'acesso.grupo.ler', // M06
        'acesso.permissao.ler',
      ]),
    );
    // Segregação: sem perfil assistencial, nada clínico nem quebra de vidro; Gestor não lê a trilha.
    expect(s.permissoes).not.toContain('acesso.emergencia.solicitar');
    expect(s.permissoes).not.toContain('auditoria.trilha.ler');
    expect(s.perfil?.complementares).toEqual(['administrador-sistema', 'gestor-acessos']);
  });

  it('fora de dev/ci e sem sessão: 401', async () => {
    const prod = { ...env, AMBIENTE: 'homolog', ACESSO_COMBINACAO_SENHA: 'sha1-salt-senha' };
    const p = await criarApp(lerConfiguracao(prod), null, prod);
    await p.init();
    await p.getHttpAdapter().getInstance().ready();
    const r = await p.inject({ method: 'GET', url: '/api/sessao' });
    expect(r.statusCode).toBe(401);
    await p.close();
  });

  it('AMBIENTE ausente: nunca a fonte sintética (rotas de acesso 503)', async () => {
    const semAmbiente: Record<string, string> = { ...env };
    delete semAmbiente['AMBIENTE'];
    const p = await criarApp(lerConfiguracao(semAmbiente), null, semAmbiente);
    await p.init();
    await p.getHttpAdapter().getInstance().ready();
    const r = await p.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.USUARIO', senha: 'Sintetico#2026' },
    });
    expect(r.statusCode).toBe(503);
    expect((await p.inject({ method: 'GET', url: '/api/sessao' })).statusCode).toBe(401);
    await p.close();
  });
});

describe('GET /api/marca (pública; DP-49)', () => {
  it('nome do produto e marca vêm da configuração', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/marca' });
    expect(r.json()).toMatchObject({ produto: 'Produto de teste', marca: 'rede-sante', rede: 'rede-teste' });
  });
});

describe('troca de senha (W1-01) e segundo fator', () => {
  it('sem sessão: 401; entrada incompleta: 400; senha atual errada: 401 sem eco da senha nova', async () => {
    const semSessao = await app.inject({ method: 'POST', url: '/api/sessao/senha', payload: {} });
    expect(semSessao.statusCode).toBe(401);
    const { cookie, csrf } = await entrarHttp();
    const vazio = await app.inject({
      method: 'POST',
      url: '/api/sessao/senha',
      headers: { cookie, 'x-csrf': csrf },
      payload: {},
    });
    expect(vazio.statusCode).toBe(400);
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao/senha',
      headers: { cookie, 'x-csrf': csrf },
      payload: { senhaAtual: 'qualquer-1', senhaNova: 'Nova#2026x', confirmacao: 'Nova#2026x' },
    });
    // F2-L: a porta de senha em memória (fonte sintética) confere a senha atual antes de tudo.
    expect(r.statusCode).toBe(401);
    expect(tipoDoProblema(esquemaProblema.parse(r.json()))).toBe('nao-autenticado');
    expect(JSON.stringify(r.json())).not.toContain('Nova#2026x');
    // O segundo fator é do módulo de identidade, fora do boot mínimo da F2-L: a rota não existe.
    const f = await app.inject({
      method: 'POST',
      url: '/api/sessao/segundo-fator',
      headers: { cookie, 'x-csrf': csrf },
      payload: {},
    });
    expect(f.statusCode).toBe(404);
  });
});
