// Suporte técnico e "login como" pela HTTP (ADR 0021), sobre a fonte SINTÉTICA e o banco da plataforma EM
// MEMÓRIA, com as contas SINTÉTICAS da plataforma (nenhuma conexão real, nenhum dado de pessoa). Prova:
// login próprio e cookies; quem entra e onde (plataforma em todos, suporte só nos atribuídos, sem atribuição
// nada); a sessão é a do ALVO com as permissões reais (sem bloqueio de uso: o alvo pode tudo, o "como" também);
// auditoria com o ator real (escrita, leitura agregada, trilha); escrita sem a linha de auditoria não acontece;
// prazo absoluto; guarda fail-closed; revogação e função retirada encerram na hora; volta e sair.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS, esquemaSessao } from '@sgh/contratos';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, REDE, SENHA } from '../../sessao/teste.spec-util.js';
import {
  CONTAS_PLATAFORMA_SINTETICAS as C,
  RepositorioPlataformaMemoria,
  SENHA_PLATAFORMA_SINTETICA,
} from './repositorio.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', SUPORTE_SESSAO_MINUTOS: '60' };
const trilha = new RegistradorTrilhaMemoria();
const armazem = new ArmazemMemoria();
/** Avança o relógio de todos os serviços (Date falso; os temporizadores continuam reais). */
function avancar(ms: number): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + ms);
}
let repo: RepositorioPlataformaMemoria;
let app: NestFastifyApplication;
let chave = 0;
const BASE = '/api/cadastros/dominios/cadastro/religiao';

beforeAll(async () => {
  // Cifra barata nos testes (os parâmetros vão na própria cifra; a conferência usa os dela).
  repo = RepositorioPlataformaMemoria.sintetico(REDE, ['aa', 'bb'], (s) =>
    cifrarSenha(s, { memoria: 8_192, passes: 1, paralelismo: 1 }),
  );
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem, plataforma: repo });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  repo.falhar = false;
});
afterEach(() => {
  vi.useRealTimers();
});

interface Navegador {
  cookies: Map<string, string>;
}
const novo = (): Navegador => ({ cookies: new Map() });
function guardar(n: Navegador, set: string | string[] | undefined): void {
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [par] = c.split(';');
    const i = par?.indexOf('=') ?? -1;
    if (!par || i < 0) continue;
    const nome = par.slice(0, i);
    const valor = par.slice(i + 1);
    if (/Max-Age=0/.test(c) || valor === '') n.cookies.delete(nome);
    else n.cookies.set(nome, valor);
  }
}
const cookie = (n: Navegador) => [...n.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
const plat = (n: Navegador) => ({ cookie: cookie(n), 'x-csrf-plataforma': n.cookies.get('sgh_pcsrf') ?? '' });
const spdata = (n: Navegador) => ({
  cookie: cookie(n),
  'x-csrf': n.cookies.get('sgh_csrf') ?? '',
  'idempotency-key': `teste-suporte-${++chave}-${Date.now()}`,
});

async function entrarPlataforma(email: string, senha = SENHA_PLATAFORMA_SINTETICA): Promise<Navegador> {
  const n = novo();
  const r = await app.inject({ method: 'POST', url: '/api/plataforma/sessao', payload: { email, senha } });
  expect(r.statusCode).toBe(200);
  guardar(n, r.headers['set-cookie']);
  return n;
}

async function entrarComo(n: Navegador, estabelecimento: string, login: string, motivo?: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/plataforma/como',
    headers: plat(n),
    payload: { estabelecimento, login, ...(motivo ? { motivo } : {}) },
  });
  guardar(n, r.headers['set-cookie']);
  return r;
}

describe('contas sintéticas da plataforma (só dev/ci)', () => {
  it('prontas já na primeira consulta (a semeadura é adiada até o primeiro uso)', async () => {
    const r = RepositorioPlataformaMemoria.sintetico(REDE, ['aa'], (s) =>
      cifrarSenha(s, { memoria: 8_192, passes: 1, paralelismo: 1 }),
    );
    expect((await r.contaPorEmail(C.plataforma))?.papel).toBe('PLATAFORMA');
    expect(await r.atribuicoes()).toHaveLength(1);
  });
});

describe('conta da plataforma: login próprio', () => {
  it('senha errada: 401 genérico; certa: cookie HttpOnly próprio e CSRF próprio; corpo sem token', async () => {
    const errada = await app.inject({
      method: 'POST',
      url: '/api/plataforma/sessao',
      payload: { email: C.plataforma, senha: 'errada-errada-errada' },
    });
    expect(errada.statusCode).toBe(401);
    const inexistente = await app.inject({
      method: 'POST',
      url: '/api/plataforma/sessao',
      payload: { email: 'ninguem@sintetico.invalid', senha: 'errada-errada-errada' },
    });
    expect(inexistente.statusCode).toBe(401);
    expect(inexistente.json().detail).toBe(errada.json().detail);
    const r = await app.inject({
      method: 'POST',
      url: '/api/plataforma/sessao',
      payload: { email: C.plataforma, senha: SENHA_PLATAFORMA_SINTETICA },
    });
    expect(r.statusCode).toBe(200);
    const set = r.headers['set-cookie'] as string[];
    expect(set.find((c) => c.startsWith('sgh_plataforma='))).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    expect(set.find((c) => c.startsWith('sgh_pcsrf='))).not.toMatch(/HttpOnly/);
    expect(JSON.stringify(r.json())).not.toMatch(/cifra|argon|senha|totp/i);
    expect(r.json()).toMatchObject({
      podeDesignar: true,
      podeEntrarComo: true,
      segundoFatorObrigatorio: false,
    });
  });

  it('a sessão do SPDATA não abre as rotas da plataforma (e vice-versa)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.ADMIN', senha: SENHA },
    });
    const n = novo();
    guardar(n, r.headers['set-cookie']);
    expect(
      (await app.inject({ method: 'GET', url: '/api/plataforma/eu', headers: { cookie: cookie(n) } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/api/plataforma/suportes', headers: { cookie: cookie(n) } }))
        .statusCode,
    ).toBe(401);
  });

  it('escrita da plataforma sem o CSRF próprio: 403', async () => {
    const n = await entrarPlataforma(C.plataforma);
    const r = await app.inject({
      method: 'POST',
      url: '/api/plataforma/suportes',
      headers: { cookie: cookie(n) },
      payload: { email: 'x@sintetico.invalid' },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('quem entra e onde (sem lista de bloqueio)', () => {
  it('suporte sem estabelecimento: sem o ícone; o "como" responde 403', async () => {
    const n = await entrarPlataforma(C.suporteSemAtribuicao);
    const eu = await app.inject({ method: 'GET', url: '/api/plataforma/eu', headers: plat(n) });
    expect(eu.json()).toMatchObject({ podeEntrarComo: false, podeDesignar: false });
    expect(
      (await app.inject({ method: 'GET', url: '/api/plataforma/como/estabelecimentos', headers: plat(n) }))
        .statusCode,
    ).toBe(403);
    expect((await entrarComo(n, 'aa', 'SINT.USUARIO')).statusCode).toBe(403);
    // A designação é da plataforma: o suporte não a vê.
    expect(
      (await app.inject({ method: 'GET', url: '/api/plataforma/suportes', headers: plat(n) })).statusCode,
    ).toBe(403);
  });

  it('suporte atribuído: só o estabelecimento atribuído (lista, grupos, usuários e entrada)', async () => {
    const n = await entrarPlataforma(C.suporte);
    const ests = await app.inject({
      method: 'GET',
      url: '/api/plataforma/como/estabelecimentos',
      headers: plat(n),
    });
    expect(ests.json().map((e: { codigo: string }) => e.codigo)).toEqual(['aa']);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/plataforma/como/grupos?estabelecimento=bb',
          headers: plat(n),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/plataforma/como/usuarios?estabelecimento=bb&grupo=MEDICOS',
          headers: plat(n),
        })
      ).statusCode,
    ).toBe(403);
    expect((await entrarComo(n, 'bb', 'SINT.USUARIO')).statusCode).toBe(403);
    const grupos = await app.inject({
      method: 'GET',
      url: '/api/plataforma/como/grupos?estabelecimento=aa',
      headers: plat(n),
    });
    expect(grupos.statusCode).toBe(200);
    const usuarios = await app.inject({
      method: 'GET',
      url: '/api/plataforma/como/usuarios?estabelecimento=aa&grupo=MEDICOS',
      headers: plat(n),
    });
    expect(usuarios.json()).toEqual([{ login: 'SINT.MEDICO', nome: 'Usuário sintético (desenvolvimento)' }]);
    // Logins bloqueados não aparecem.
    const sint = await app.inject({
      method: 'GET',
      url: '/api/plataforma/como/usuarios?estabelecimento=aa&grupo=SINTETICO',
      headers: plat(n),
    });
    expect(sint.json().map((u: { login: string }) => u.login)).not.toContain('SINT.BLOQUEADO');
    expect((await entrarComo(n, 'aa', 'SINT.BLOQUEADO')).statusCode).toBe(404);
  });

  it('plataforma: qualquer estabelecimento configurado ("todos os bancos")', async () => {
    const n = await entrarPlataforma(C.plataforma);
    const ests = await app.inject({
      method: 'GET',
      url: '/api/plataforma/como/estabelecimentos',
      headers: plat(n),
    });
    expect(ests.json().map((e: { codigo: string }) => e.codigo)).toEqual(['aa', 'bb']);
    expect((await entrarComo(n, 'bb', 'SINT.ADMIN')).statusCode).toBe(201);
  });
});

describe('a sessão "como" é a do alvo, com o ator real na auditoria', () => {
  it('permissões reais do alvo; faixa com o ator; alvo pode tudo (escrita aceita e registrada)', async () => {
    const direto = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.ADMIN', senha: SENHA },
    });
    const permissoesDoAlvo = esquemaSessao.parse(direto.json()).permissoes;
    const n = await entrarPlataforma(C.plataforma);
    const r = await entrarComo(n, 'aa', 'SINT.ADMIN', 'CHAMADO-123');
    expect(r.statusCode).toBe(201);
    const s = esquemaSessao.parse(r.json());
    expect(s.usuario.login).toBe('SINT.ADMIN');
    expect(s.permissoes).toEqual(permissoesDoAlvo);
    expect(s.como).toMatchObject({
      ator: { tipo: 'plataforma', email: C.plataforma },
      motivo: 'CHAMADO-123',
    });
    // GET /api/sessao com os dois cookies: a do alvo, com a marca.
    const atual = await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: cookie(n) } });
    expect(esquemaSessao.parse(atual.json()).como?.alvo.login).toBe('SINT.ADMIN');
    // Escrita do alvo (CRUD genérico do M08) feita no "como": aceita.
    const antes = trilha.eventos.length;
    const inc = await app.inject({
      method: 'POST',
      url: `${BASE}/itens`,
      headers: spdata(n),
      payload: { valores: { codigo: 77, nome: 'Religião sintética do suporte' } },
    });
    expect(inc.statusCode).toBe(201);
    // Trilha: USUARIO = alvo, com o ator real marcado (a ORIGEM no banco).
    const ev = trilha.eventos.slice(antes).find((e) => e.tabelaAlvo === 'MEMORIA');
    expect(ev?.usuario).toBe('SINT.ADMIN');
    expect(ev?.como).toMatchObject({ atorTipo: 'plataforma', alvo: 'SINT.ADMIN' });
    expect(ev?.estacao).toMatch(/:SUPORTE$/);
    // Auditoria da sessão: a escrita (método, caminho, status) e a leitura agregada, sem query string.
    await app.inject({ method: 'GET', url: `${BASE}/itens?busca=segredo`, headers: { cookie: cookie(n) } });
    await app.inject({ method: 'GET', url: `${BASE}/itens?busca=outra`, headers: { cookie: cookie(n) } });
    const sessoes = await app.inject({
      method: 'GET',
      url: '/api/plataforma/auditoria/sessoes',
      headers: plat(n),
    });
    const sessao = sessoes.json().find((x: { motivo: string | null }) => x.motivo === 'CHAMADO-123');
    const det = await app.inject({
      method: 'GET',
      url: `/api/plataforma/auditoria/sessoes/${sessao.id}`,
      headers: plat(n),
    });
    const d = det.json();
    expect(d.acoes).toEqual([
      expect.objectContaining({ metodo: 'POST', caminho: `${BASE}/itens`, status: 'ok', http: 201 }),
    ]);
    const leitura = d.leituras.find((l: { caminho: string }) => l.caminho === `${BASE}/itens`);
    expect(leitura.quantidade).toBe(2);
    expect(JSON.stringify(d)).not.toMatch(/segredo|outra/);
  });

  it('escrita sem a linha da auditoria não acontece (503) e nada é gravado', async () => {
    const n = await entrarPlataforma(C.plataforma);
    expect((await entrarComo(n, 'aa', 'SINT.ADMIN')).statusCode).toBe(201);
    // A guarda já confere com cache; a falha vale para o registro da escrita.
    const antes = trilha.eventos.length;
    const registrar = repo.registrarAcao.bind(repo);
    repo.registrarAcao = () => Promise.reject(new Error('banco fora (simulado)'));
    try {
      const r = await app.inject({
        method: 'POST',
        url: `${BASE}/itens`,
        headers: spdata(n),
        payload: { valores: { codigo: 78, nome: 'Não pode gravar' } },
      });
      expect(r.statusCode).toBe(503);
      expect(trilha.eventos.slice(antes).some((e) => e.tabelaAlvo === 'MEMORIA')).toBe(false);
    } finally {
      repo.registrarAcao = registrar;
    }
  });

  it('guarda fail-closed: banco da plataforma fora, a sessão "como" responde 503 (nunca libera)', async () => {
    const n = await entrarPlataforma(C.plataforma);
    expect((await entrarComo(n, 'aa', 'SINT.ADMIN')).statusCode).toBe(201);
    avancar(20_000); // passa do cache de 15 s
    repo.falhar = true;
    const r = await app.inject({ method: 'GET', url: `${BASE}/itens`, headers: { cookie: cookie(n) } });
    expect(r.statusCode).toBe(503);
    const s = await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: cookie(n) } });
    expect(s.statusCode).toBe(503);
  });

  it('prazo absoluto: passou de SUPORTE_SESSAO_MINUTOS, acabou (atividade não renova)', async () => {
    const n = await entrarPlataforma(C.plataforma);
    expect((await entrarComo(n, 'aa', 'SINT.USUARIO')).statusCode).toBe(201);
    for (let i = 0; i < 5; i++) {
      avancar(11 * 60_000);
      // A inatividade da política (30 min) não chega a vencer: a sessão segue até o prazo absoluto.
      expect(
        (await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: cookie(n) } })).statusCode,
      ).toBe(200);
    }
    avancar(6 * 60_000); // 61 min
    expect(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: cookie(n) } })).statusCode,
    ).toBe(401);
  });

  it('revogar encerra na hora; desativar o suporte encerra as sessões dele', async () => {
    const p = await entrarPlataforma(C.plataforma);
    expect((await entrarComo(p, 'aa', 'SINT.USUARIO')).statusCode).toBe(201);
    const lista = await app.inject({
      method: 'GET',
      url: '/api/plataforma/auditoria/sessoes',
      headers: plat(p),
    });
    const aberta = lista
      .json()
      .find((s: { aberta: boolean; alvoLogin: string }) => s.aberta && s.alvoLogin === 'SINT.USUARIO');
    const enc = await app.inject({
      method: 'POST',
      url: `/api/plataforma/auditoria/sessoes/${aberta.id}/encerrar`,
      headers: { ...plat(p), 'content-type': 'application/json' },
      payload: {},
    });
    expect(enc.statusCode).toBe(204);
    expect(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: cookie(p) } })).statusCode,
    ).toBe(401);

    const s = await entrarPlataforma(C.suporte);
    expect((await entrarComo(s, 'aa', 'SINT.USUARIO')).statusCode).toBe(201);
    const contas = await app.inject({ method: 'GET', url: '/api/plataforma/suportes', headers: plat(p) });
    const sup = contas.json().find((c: { email: string }) => c.email === C.suporte);
    const off = await app.inject({
      method: 'PUT',
      url: `/api/plataforma/suportes/${sup.id}`,
      headers: plat(p),
      payload: { ativo: false },
    });
    expect(off.statusCode).toBe(204);
    expect(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: cookie(s) } })).statusCode,
    ).toBe(401);
    // Desativado: nem a conta da plataforma vale mais.
    expect(
      (await app.inject({ method: 'GET', url: '/api/plataforma/eu', headers: plat(s) })).statusCode,
    ).toBe(401);
    await app.inject({
      method: 'PUT',
      url: `/api/plataforma/suportes/${sup.id}`,
      headers: plat(p),
      payload: { ativo: true },
    });
    // As mudanças de função ficam na auditoria das contas.
    const ev = await app.inject({ method: 'GET', url: '/api/plataforma/auditoria/contas', headers: plat(p) });
    expect(
      ev.json().filter((e: { evento: string }) => e.evento === 'suporte.funcao.alterada').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('atribuição retirada encerra a sessão naquele estabelecimento; atribuir bb libera bb', async () => {
    const p = await entrarPlataforma(C.plataforma);
    const contas = await app.inject({ method: 'GET', url: '/api/plataforma/suportes', headers: plat(p) });
    const sup = contas.json().find((c: { email: string }) => c.email === C.suporte);
    const s = await entrarPlataforma(C.suporte);
    expect((await entrarComo(s, 'aa', 'SINT.USUARIO')).statusCode).toBe(201);
    const r = await app.inject({
      method: 'PUT',
      url: `/api/plataforma/suportes/${sup.id}/atribuicoes`,
      headers: plat(p),
      payload: { estabelecimentos: ['bb'] },
    });
    expect(r.json()).toEqual({ ligados: ['bb'], desligados: ['aa'] });
    expect(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: cookie(s) } })).statusCode,
    ).toBe(401);
    expect((await entrarComo(s, 'aa', 'SINT.USUARIO')).statusCode).toBe(403);
    expect((await entrarComo(s, 'bb', 'SINT.USUARIO')).statusCode).toBe(201);
    await app.inject({
      method: 'PUT',
      url: `/api/plataforma/suportes/${sup.id}/atribuicoes`,
      headers: plat(p),
      payload: { estabelecimentos: ['aa'] },
    });
  });

  it('sair (DELETE /api/sessao) e "voltar" encerram o "como"; a conta da plataforma continua', async () => {
    const n = await entrarPlataforma(C.plataforma);
    expect((await entrarComo(n, 'aa', 'SINT.USUARIO')).statusCode).toBe(201);
    const sair = await app.inject({ method: 'DELETE', url: '/api/sessao', headers: spdata(n) });
    expect(sair.statusCode).toBe(204);
    guardar(n, sair.headers['set-cookie']);
    expect(
      (await app.inject({ method: 'GET', url: '/api/plataforma/eu', headers: plat(n) })).statusCode,
    ).toBe(200);
    expect((await entrarComo(n, 'aa', 'SINT.USUARIO')).statusCode).toBe(201);
    const voltar = await app.inject({ method: 'DELETE', url: '/api/plataforma/como', headers: plat(n) });
    expect(voltar.statusCode).toBe(204);
    guardar(n, voltar.headers['set-cookie']);
    expect(n.cookies.has('sgh_sessao')).toBe(false);
    const lista = await app.inject({
      method: 'GET',
      url: '/api/plataforma/auditoria/sessoes',
      headers: plat(n),
    });
    const encerradas = lista
      .json()
      .filter((s: { encerramento: string | null }) => s.encerramento === 'voltou');
    expect(encerradas.length).toBeGreaterThanOrEqual(2);
  });

  it('reautenticação dentro do "como" confere a senha do ATOR (nunca a do alvo)', async () => {
    const n = await entrarPlataforma(C.plataforma);
    expect((await entrarComo(n, 'aa', 'SINT.USUARIO')).statusCode).toBe(201);
    const doAlvo = await app.inject({
      method: 'POST',
      url: '/api/sessao/reautenticar',
      headers: spdata(n),
      payload: { senha: SENHA },
    });
    expect(doAlvo.statusCode).toBe(401);
    const doAtor = await app.inject({
      method: 'POST',
      url: '/api/sessao/reautenticar',
      headers: spdata(n),
      payload: { senha: SENHA_PLATAFORMA_SINTETICA },
    });
    expect(doAtor.statusCode).toBe(200);
  });

  it('convite: o suporte define a própria senha (token de uso único) e entra', async () => {
    const p = await entrarPlataforma(C.plataforma);
    const r = await app.inject({
      method: 'POST',
      url: '/api/plataforma/suportes',
      headers: plat(p),
      payload: { email: 'novo.suporte@sintetico.invalid' },
    });
    expect(r.statusCode).toBe(201);
    const { token } = r.json().convite as { token: string };
    const senha = 'Senha#Sintetica#2026';
    expect(
      (await app.inject({ method: 'POST', url: '/api/plataforma/convite', payload: { token, senha } }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: 'POST', url: '/api/plataforma/convite', payload: { token, senha } }))
        .statusCode,
    ).toBe(404);
    await entrarPlataforma('novo.suporte@sintetico.invalid', senha);
  });
});

describe('revisão de segurança do "como" (credencial, alvo, volta, substituição, negação)', () => {
  /** Suporte novo (convite aceito, atribuído a aa) para não mexer nas contas sintéticas dos outros testes. */
  async function suporteNovo(p: Navegador, email: string, senha: string): Promise<string> {
    const r = await app.inject({
      method: 'POST',
      url: '/api/plataforma/suportes',
      headers: plat(p),
      payload: { email },
    });
    expect(r.statusCode).toBe(201);
    const { id, convite } = r.json() as { id: string; convite: { token: string } };
    await app.inject({
      method: 'POST',
      url: '/api/plataforma/convite',
      payload: { token: convite.token, senha },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/plataforma/suportes/${id}/atribuicoes`,
      headers: plat(p),
      payload: { estabelecimentos: ['aa'] },
    });
    return id;
  }

  it('novo convite derruba a sessão da plataforma e a sessão "como" já abertas da conta', async () => {
    const p = await entrarPlataforma(C.plataforma);
    const senha = 'Senha#Vazada#Sintetica#1';
    const id = await suporteNovo(p, 'vazado@sintetico.invalid', senha);
    const invasor = await entrarPlataforma('vazado@sintetico.invalid', senha);
    expect((await entrarComo(invasor, 'aa', 'SINT.USUARIO')).statusCode).toBe(201);
    const cv = await app.inject({
      method: 'POST',
      url: `/api/plataforma/suportes/${id}/convite`,
      headers: plat(p),
      payload: {},
    });
    expect(cv.statusCode).toBe(201);
    expect(
      (await app.inject({ method: 'GET', url: '/api/plataforma/eu', headers: plat(invasor) })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: cookie(invasor) } }))
        .statusCode,
    ).toBe(401);
    expect([...repo.sessoes.values()].filter((s) => s.idConta === id && s.fim === null)).toEqual([]);
    expect(
      [...repo.sessoes.values()].some((s) => s.idConta === id && s.encerramento === 'convite-reemitido'),
    ).toBe(true);
    // Credencial redefinida no banco (como faz o plataforma:criar-admin --redefinir): a sessão antiga cai.
    const token = (cv.json() as { token: string }).token;
    await app.inject({ method: 'POST', url: '/api/plataforma/convite', payload: { token, senha } });
    const outra = await entrarPlataforma('vazado@sintetico.invalid', senha);
    await repo.alterarConta(id, { cifra: 'cifra-trocada-no-terminal' }, null);
    expect(
      (await app.inject({ method: 'GET', url: '/api/plataforma/eu', headers: plat(outra) })).statusCode,
    ).toBe(401);
  });

  it('alvo fora da regra do modal (grupo inativo ou sem grupo): 404 sem sessão de suporte nem aviso', async () => {
    const { FonteAcessoSintetica } = await import('../acesso/fonte-sintetica.js');
    const n = await entrarPlataforma(C.plataforma);
    const sessoesAntes = repo.sessoes.size;
    const avisosAntes = repo.avisos.length;
    const espiao = vi.spyOn(FonteAcessoSintetica.prototype, 'contaAlvo');
    const base = {
      login: 'SINT.SERVICO',
      id: 900999,
      nomeExibicao: 'Conta de serviço',
      ativo: true,
      bloqueado: false,
    };
    espiao.mockResolvedValueOnce({ ...base, grupo: null, grupoAtivo: false });
    espiao.mockResolvedValueOnce({ ...base, grupo: 'DESATIVADO', grupoAtivo: false });
    try {
      expect((await entrarComo(n, 'aa', 'SINT.SERVICO')).statusCode).toBe(404);
      expect((await entrarComo(n, 'aa', 'SINT.SERVICO')).statusCode).toBe(404);
      expect((await entrarComo(n, 'aa', 'NINGUEM.EXISTE')).statusCode).toBe(404);
    } finally {
      espiao.mockRestore();
    }
    expect(repo.sessoes.size).toBe(sessoesAntes);
    expect(repo.avisos.length).toBe(avisosAntes);
    expect(repo.eventos.filter((e) => e.evento === 'suporte.como.recusado').length).toBeGreaterThanOrEqual(3);
  });

  it('o aviso ao Auditor sai depois da sessão do alvo, com a carga completa (estabelecimento, usuário, início e fim)', async () => {
    const n = await entrarPlataforma(C.plataforma);
    expect((await entrarComo(n, 'bb', 'SINT.MEDICO', 'CHAMADO-9')).statusCode).toBe(201);
    const aviso = repo.avisos.at(-1);
    expect(aviso?.tipo).toBe('alerta-suporte');
    expect(aviso?.carga).toMatchObject({
      estabelecimento: 'bb',
      atorTipo: 'plataforma',
      motivo: 'CHAMADO-9',
      idUsuario: expect.stringMatching(/^\d+$/),
      inicio: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      fim: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
  });

  it('"Voltar" com a sessão da plataforma vencida encerra o "como" pelo CSRF do SPDATA', async () => {
    const n = await entrarPlataforma(C.plataforma);
    expect((await entrarComo(n, 'aa', 'SINT.GESTOR')).statusCode).toBe(201);
    for (let i = 0; i < 3; i++) {
      avancar(11 * 60_000);
      expect(
        (await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: cookie(n) } })).statusCode,
      ).toBe(200);
    }
    // 33 min: a da plataforma venceu (30 min sem uso dela); o "como" segue vivo.
    expect(
      (await app.inject({ method: 'GET', url: '/api/plataforma/eu', headers: plat(n) })).statusCode,
    ).toBe(401);
    const semCsrf = await app.inject({ method: 'DELETE', url: '/api/plataforma/como', headers: plat(n) });
    expect(semCsrf.statusCode).toBe(403);
    const voltar = await app.inject({
      method: 'DELETE',
      url: '/api/plataforma/como',
      headers: { ...plat(n), 'x-csrf': n.cookies.get('sgh_csrf') ?? '' },
    });
    expect(voltar.statusCode).toBe(204);
    guardar(n, voltar.headers['set-cookie']);
    expect(n.cookies.has('sgh_sessao')).toBe(false);
    const s = [...repo.sessoes.values()].filter((x) => x.alvoLogin === 'SINT.GESTOR').at(-1);
    expect(s?.encerramento).toBe('voltou');
  });

  it('login normal no navegador em "como" encerra a sessão de suporte (substituida)', async () => {
    const n = await entrarPlataforma(C.plataforma);
    expect((await entrarComo(n, 'aa', 'SINT.AUDITOR')).statusCode).toBe(201);
    const id = [...repo.sessoes.values()].filter((x) => x.alvoLogin === 'SINT.AUDITOR').at(-1)?.id ?? '';
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      headers: { cookie: cookie(n) },
      payload: { estabelecimento: 'aa', login: 'SINT.USUARIO', senha: SENHA },
    });
    expect(r.statusCode).toBe(201);
    expect(repo.sessoes.get(id)).toMatchObject({ encerramento: 'substituida', fim: expect.any(Date) });
  });

  it('negação de permissão no "como" vai à trilha com o ator real (marca do "como")', async () => {
    const n = await entrarPlataforma(C.plataforma);
    expect((await entrarComo(n, 'aa', 'SINT.RECEPCAO')).statusCode).toBe(201);
    const antes = trilha.eventos.length;
    const r = await app.inject({ method: 'GET', url: '/api/acesso/grupos', headers: { cookie: cookie(n) } });
    expect(r.statusCode).toBe(403);
    const ev = trilha.eventos
      .slice(antes)
      .find((e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo);
    expect(ev?.usuario).toBe('SINT.RECEPCAO');
    expect(ev?.como).toMatchObject({ atorTipo: 'plataforma', alvo: 'SINT.RECEPCAO' });
  });

  it('a execução do Corrigir exige o resumo da prévia; a prévia o devolve', async () => {
    const n = await entrarPlataforma(C.plataforma);
    expect((await entrarComo(n, 'aa', 'SINT.USUARIO')).statusCode).toBe(201);
    const s = [...repo.sessoes.values()].at(-1)!;
    const corpo = { estabelecimento: 'aa', sessao: s.id };
    const sem = await app.inject({
      method: 'POST',
      url: '/api/plataforma/auditoria/correcoes',
      headers: plat(n),
      payload: { ...corpo, previa: false, confirmarConflito: true },
    });
    expect(sem.statusCode).toBe(400);
    const previa = await app.inject({
      method: 'POST',
      url: '/api/plataforma/auditoria/correcoes',
      headers: plat(n),
      payload: { ...corpo, previa: true },
    });
    expect(previa.json().resumo).toMatch(/^[0-9a-f]{64}$/);
    const com = await app.inject({
      method: 'POST',
      url: '/api/plataforma/auditoria/correcoes',
      headers: plat(n),
      payload: { ...corpo, previa: false, resumo: previa.json().resumo },
    });
    expect(com.statusCode).toBe(200);
  });
});
