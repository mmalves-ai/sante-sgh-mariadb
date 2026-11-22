// W1-01 (parte 11b2): rotas do PIN e da troca rápida sobre a app inteira (sessão real com a fonte sintética, PIN em
// memória, trilha em memória). Prova: o próprio PIN só com CSRF e senha; a troca na estação com o CSRF da sessão
// anterior, cookies novos e a anterior BLOQUEADA; a recusa genérica idêntica para PIN errado e conta inexistente; o
// gestor vê a situação e retira com motivo e senha; nenhum PIN nem hash na resposta ou na trilha.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { NAO_MIGRADOS_F2L } from '../../app-base.module.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { MENSAGEM_TROCA_RECUSADA } from '../../sessao/troca-rapida.js';
import { reiniciarEstadoAcessoSintetico } from './fonte-sintetica.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const PIN = '384716';
let app: NestFastifyApplication;
let chave = 0;

interface Cookies {
  readonly mapa: Map<string, string>;
}
const cab = (c: Cookies, csrf = true) => ({
  host: 'localhost',
  cookie: [...c.mapa].map(([k, v]) => `${k}=${v}`).join('; '),
  ...(csrf ? { 'x-csrf': c.mapa.get('sgh_csrf') ?? '' } : {}),
  'idempotency-key': `teste-pin-${++chave}-${Date.now()}`,
});
function lerCookies(set: string | string[] | undefined): Cookies {
  const mapa = new Map<string, string>();
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [par] = c.split(';');
    const i = par?.indexOf('=') ?? -1;
    if (par && i > 0) mapa.set(par.slice(0, i), par.slice(i + 1));
  }
  return { mapa };
}
/** Entra com a senha; `posto` é o cookie do posto que o navegador da máquina já tem (o mesmo é devolvido). */
async function entrar(login: string, posto?: string): Promise<Cookies> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    headers: { host: 'localhost', ...(posto ? { cookie: `sgh_posto=${posto}` } : {}) },
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const c = lerCookies(r.headers['set-cookie']);
  expect(c.mapa.get('sgh_posto')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  if (posto) expect(c.mapa.get('sgh_posto')).toBe(posto);
  expect(String(r.headers['set-cookie'])).toMatch(
    /sgh_posto=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict/,
  );
  return c;
}

beforeAll(async () => {
  reiniciarEstadoAcessoSintetico();
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem: new ArmazemMemoria() });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  reiniciarEstadoAcessoSintetico();
});

// A troca rápida (PIN) ainda está fora da base da API (NAO_MIGRADOS_F2L: 501 com o motivo); o arquivo volta a rodar
// sozinho quando a base a montar (pedido do lote 02-04 ao integrador).
describe.skipIf(NAO_MIGRADOS_F2L.has('trocaRapida'))(
  'W1-01 (parte 11b2): PIN e troca rápida pela HTTP',
  () => {
    it('PIN próprio: CSRF e senha; recusa o trivial; troca na estação; recusa genérica; gestor retira', async () => {
      const b = await entrar('SINT.RECEPCAO');
      const sit0 = await app.inject({ method: 'GET', url: '/api/sessao/pin', headers: cab(b) });
      expect(sit0.statusCode).toBe(200);
      expect(sit0.json()).toMatchObject({ ligada: true, digitosPin: 6, definido: false, bloqueado: false });

      const semCsrf = await app.inject({
        method: 'POST',
        url: '/api/sessao/pin',
        headers: cab(b, false),
        payload: { pin: PIN, senha: SENHA },
      });
      expect(semCsrf.statusCode).toBe(403);
      const senhaErrada = await app.inject({
        method: 'POST',
        url: '/api/sessao/pin',
        headers: cab(b),
        payload: { pin: PIN, senha: 'Errada#2026' },
      });
      expect(senhaErrada.statusCode).toBe(401);
      const trivial = await app.inject({
        method: 'POST',
        url: '/api/sessao/pin',
        headers: cab(b),
        payload: { pin: '123456', senha: SENHA },
      });
      expect([trivial.statusCode, trivial.json().codigo]).toEqual([422, 'pin-trivial']);
      const formato = await app.inject({
        method: 'POST',
        url: '/api/sessao/pin',
        headers: cab(b),
        payload: { pin: '12a4', senha: SENHA },
      });
      expect(formato.statusCode).toBe(400);
      const def = await app.inject({
        method: 'POST',
        url: '/api/sessao/pin',
        headers: cab(b),
        payload: { pin: PIN, senha: SENHA },
      });
      expect(def.statusCode).toBe(200);
      expect(def.json()).toMatchObject({ definido: true, bloqueado: false });
      expect(def.body).not.toMatch(/argon2|384716/);

      // A estação: outra pessoa entra com a senha NO MESMO POSTO (mesmo navegador: cookie do posto); B troca com o PIN
      // (B entrou com a senha hoje neste posto).
      const a = await entrar('SINT.USUARIO', b.mapa.get('sgh_posto'));
      const trocaSemCsrf = await app.inject({
        method: 'POST',
        url: '/api/sessao/troca-rapida',
        headers: cab(a, false),
        payload: { login: 'SINT.RECEPCAO', pin: PIN },
      });
      expect(trocaSemCsrf.statusCode).toBe(403);
      const errado = await app.inject({
        method: 'POST',
        url: '/api/sessao/troca-rapida',
        headers: cab(a),
        payload: { login: 'SINT.RECEPCAO', pin: '905372' },
      });
      const inexistente = await app.inject({
        method: 'POST',
        url: '/api/sessao/troca-rapida',
        headers: cab(a),
        payload: { login: 'SINT.NINGUEM', pin: PIN },
      });
      expect(errado.statusCode).toBe(401);
      expect(inexistente.statusCode).toBe(401);
      const sem = (x: Record<string, unknown>) => ({
        ...x,
        instance: undefined,
        traceId: undefined,
        correlacao: undefined,
      });
      expect(sem(inexistente.json())).toEqual(sem(errado.json()));
      expect(errado.json().detail).toBe(MENSAGEM_TROCA_RECUSADA);

      const troca = await app.inject({
        method: 'POST',
        url: '/api/sessao/troca-rapida',
        headers: cab(a),
        payload: { login: 'SINT.RECEPCAO', pin: PIN },
      });
      expect(troca.statusCode).toBe(201);
      const nova = lerCookies(troca.headers['set-cookie']);
      expect(nova.mapa.get('sgh_sessao')).toBeTruthy();
      expect(nova.mapa.get('sgh_sessao')).not.toBe(a.mapa.get('sgh_sessao'));
      const quem = await app.inject({ method: 'GET', url: '/api/sessao', headers: cab(nova) });
      expect(quem.json().usuario.login).toBe('SINT.RECEPCAO');
      const anterior = await app.inject({ method: 'GET', url: '/api/sessao', headers: cab(a) });
      expect(JSON.stringify(anterior.json())).toMatch(/bloquead/i);

      // Gestor: situação e retirada com motivo e senha (reautenticação).
      const g = await entrar('SINT.GESTOR');
      const url = '/api/acesso/gestao/usuarios/SINT.RECEPCAO/pin';
      const vista = await app.inject({ method: 'GET', url, headers: cab(g) });
      expect(vista.statusCode).toBe(200);
      expect(vista.json()).toMatchObject({ definido: true, bloqueado: false });
      const semMotivo = await app.inject({
        method: 'POST',
        url: `${url}/retirar`,
        headers: cab(g),
        payload: { motivo: 'curto', senha: SENHA },
      });
      expect(semMotivo.statusCode).toBe(400);
      const retirado = await app.inject({
        method: 'POST',
        url: `${url}/retirar`,
        headers: cab(g),
        payload: { motivo: 'estação compartilhada trocada de setor', senha: SENHA },
      });
      expect(retirado.statusCode).toBe(200);
      expect(retirado.json()).toMatchObject({ anterior: 'definido', situacao: { definido: false } });
      const deNovo = await app.inject({
        method: 'POST',
        url: `${url}/retirar`,
        headers: cab(g),
        payload: { motivo: 'estação compartilhada trocada de setor', senha: SENHA },
      });
      expect(deNovo.statusCode).toBe(409);

      // Sem PIN nada na trilha: nem o PIN nem o hash.
      const tudo = JSON.stringify(trilha.eventos);
      expect(tudo).not.toMatch(/384716|905372|argon2/);
      expect(trilha.eventos.map((e) => e.evento)).toEqual(
        expect.arrayContaining(['acesso.pin.definido', 'sessao.troca-rapida', 'acesso.pin.retirado']),
      );
    });

    it('revisão (estação): outra máquina atrás do mesmo IP (sem o cookie do posto) não troca, nem sem sessão', async () => {
      const b = await entrar('SINT.ENFERMAGEM');
      const def = await app.inject({
        method: 'POST',
        url: '/api/sessao/pin',
        headers: cab(b),
        payload: { pin: PIN, senha: SENHA },
      });
      expect(def.statusCode).toBe(200);
      // Outra máquina: mesmo IP (o inject usa sempre 127.0.0.1), outra pessoa logada, sem o cookie do posto de B.
      const outra = await entrar('SINT.USUARIO');
      expect(outra.mapa.get('sgh_posto')).not.toBe(b.mapa.get('sgh_posto'));
      const naOutra = await app.inject({
        method: 'POST',
        url: '/api/sessao/troca-rapida',
        headers: cab(outra),
        payload: { login: 'SINT.ENFERMAGEM', pin: PIN },
      });
      expect(naOutra.statusCode).toBe(401);
      // Sem cookie nenhum (só login, PIN e estabelecimento no corpo): recusada.
      const semCookie = await app.inject({
        method: 'POST',
        url: '/api/sessao/troca-rapida',
        headers: { host: 'localhost' },
        payload: { login: 'SINT.ENFERMAGEM', pin: PIN, estabelecimento: 'aa' },
      });
      expect(semCookie.statusCode).toBe(401);
      expect(semCookie.json().detail).toBe(MENSAGEM_TROCA_RECUSADA);
      // Só o cookie do posto, sem a sessão anterior do posto: recusada.
      const soPosto = await app.inject({
        method: 'POST',
        url: '/api/sessao/troca-rapida',
        headers: { host: 'localhost', cookie: `sgh_posto=${b.mapa.get('sgh_posto')}` },
        payload: { login: 'SINT.ENFERMAGEM', pin: PIN, estabelecimento: 'aa' },
      });
      expect(soPosto.statusCode).toBe(401);
    });

    it('o usuário comum não vê nem retira o PIN de outro (permissão do gestor)', async () => {
      const u = await entrar('SINT.USUARIO');
      const r = await app.inject({
        method: 'GET',
        url: '/api/acesso/gestao/usuarios/SINT.RECEPCAO/pin',
        headers: cab(u),
      });
      expect(r.statusCode).toBe(403);
    });
  },
);
