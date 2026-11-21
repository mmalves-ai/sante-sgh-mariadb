// Rotas do M59-F4 (/api/administracao/acesso/grupos/saneamento): permissões (ler com acesso.grupo.ler; agir com
// acesso.grupo.sanear), auditoria da leitura, validação da entrada, Idempotency-Key e senha nas ações críticas.
// App com a fonte sintética e a porta em memória (dados sintéticos).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { CHAVE_AUDITAR } from '../../../autorizacao/decoradores.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { moduloAcesso } from '../modulo.js';
import { PortaSaneamentoMemoria } from './porta-memoria.js';
import { SaneamentoController } from './saneamento.controller.js';

const BASE = '/api/administracao/acesso/grupos/saneamento';

describe(`rotas ${BASE}`, () => {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'acesso' };
  let app: NestFastifyApplication;
  const trilha = new RegistradorTrilhaMemoria();
  const porta = new PortaSaneamentoMemoria()
    .comGrupo('MASTER', [1, 2, 3])
    .comGrupo('FATURAMENTO', [1])
    .comUsuario({
      login: 'SINT.SANEAR',
      idUsuario: 900,
      nome: 'Pessoa Sintetica',
      grupo: 'MASTER',
      ativo: true,
      bloqueado: false,
      ultimoAcesso: null,
    });
  beforeAll(async () => {
    app = await criarApp(lerConfiguracao(env), null, env, {
      trilha,
      registro: { acesso: async () => ({ modulo: (ctx) => moduloAcesso(ctx, { saneamento: porta }) }) },
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
  });
  const entrar = async (login: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha: SENHA },
    });
    expect(r.statusCode).toBe(201);
    const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
    const cookie = set.map((c) => c.split(';')[0]).join('; ');
    csrf.set(
      cookie,
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
    );
    return cookie;
  };
  const csrf = new Map<string, string>();
  const com = (cookie: string, extra: Record<string, string> = {}) => ({
    cookie,
    'x-csrf': csrf.get(cookie) ?? '',
    ...extra,
  });

  it('quem tem acesso.grupo.ler lê o painel (auditado); sem a permissão, 403', async () => {
    const evento = EVENTOS_AUDITAVEIS.saneamentoConsultado.codigo;
    const cookie = await entrar('SINT.GESTOR');
    const antes = trilha.eventos.length;
    const r = await app.inject({ method: 'GET', url: BASE, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().grupos[0]).toMatchObject({ grupo: 'MASTER', ativos: 1 });
    expect(trilha.eventos.slice(antes).filter((e) => e.evento === evento)).toHaveLength(1);
    for (const h of ['painel', 'plano', 'simular', 'usuarios'] as const)
      expect(Reflect.getMetadata(CHAVE_AUDITAR, SaneamentoController.prototype[h]), h).toBe(evento);
    const negado = await app.inject({
      method: 'GET',
      url: BASE,
      headers: { cookie: await entrar('SINT.RECEPCAO') },
    });
    expect(negado.statusCode).toBe(403);
  });

  it('usuários do grupo e simulação; entrada inválida é 400', async () => {
    const cookie = await entrar('SINT.GESTOR');
    const u = await app.inject({ method: 'GET', url: `${BASE}/grupos/MASTER/usuarios`, headers: { cookie } });
    expect(u.statusCode).toBe(200);
    expect(u.json().usuarios.map((x: { login: string }) => x.login)).toEqual(['SINT.SANEAR']);
    const s = await app.inject({
      method: 'GET',
      url: `${BASE}/simulacao?login=SINT.SANEAR&destino=FATURAMENTO`,
      headers: { cookie },
    });
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({ antes: 3, depois: 1, perdidasTotal: 2 });
    const ruim = await app.inject({
      method: 'GET',
      url: `${BASE}/simulacao?login=SINT.SANEAR`,
      headers: { cookie },
    });
    expect(ruim.statusCode).toBe(400);
    const naoGenerico = await app.inject({
      method: 'GET',
      url: `${BASE}/grupos/FATURAMENTO/usuarios`,
      headers: { cookie },
    });
    expect(naoGenerico.statusCode).toBe(400);
    expect(naoGenerico.json().codigo).toBe('grupo-nao-generico');
  });

  it('decidir, aplicar e dissolver: só com acesso.grupo.sanear; aplicar pede a Idempotency-Key e a senha', async () => {
    const auditor = await entrar('SINT.AUDITOR');
    const semPermissao = await app.inject({
      method: 'POST',
      url: `${BASE}/plano`,
      headers: com(auditor),
      payload: {
        login: 'SINT.SANEAR',
        decisao: 'bloquear',
        grupoDestino: null,
        motivo: 'Sem entrar há meses',
      },
    });
    expect(semPermissao.statusCode).toBe(403);
    const cookie = await entrar('SINT.SANEAR.GESTOR');
    const invalida = await app.inject({
      method: 'POST',
      url: `${BASE}/plano`,
      headers: com(cookie),
      payload: { login: 'SINT.SANEAR', decisao: 'trocar-grupo', grupoDestino: null, motivo: 'Sem destino' },
    });
    expect(invalida.statusCode, invalida.body).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: `${BASE}/plano`,
      headers: com(cookie),
      payload: {
        login: 'SINT.SANEAR',
        decisao: 'bloquear',
        grupoDestino: null,
        motivo: 'Sem entrar há meses',
      },
    });
    expect(ok.statusCode).toBe(201);
    const id = ok.json().id as string;
    const semChave = await app.inject({
      method: 'POST',
      url: `${BASE}/plano/${id}/aplicar`,
      headers: com(cookie),
      payload: { senha: SENHA },
    });
    expect(semChave.statusCode).toBe(400);
    const idRuim = await app.inject({
      method: 'POST',
      url: `${BASE}/plano/abc/descartar`,
      headers: com(cookie),
      payload: {},
    });
    expect(idRuim.statusCode).toBe(400);
    const descarte = await app.inject({
      method: 'POST',
      url: `${BASE}/plano/${id}/descartar`,
      headers: com(cookie),
      payload: {},
    });
    expect(descarte.statusCode).toBe(200);
    expect(descarte.json().situacao).toBe('descartado');
    const plano = await app.inject({ method: 'GET', url: `${BASE}/plano?grupo=MASTER`, headers: { cookie } });
    expect(plano.json().itens).toHaveLength(1);
    const master = await app.inject({
      method: 'POST',
      url: `${BASE}/grupos/MASTER/dissolver`,
      headers: com(cookie, { 'idempotency-key': 'chave-rota-0001' }),
      payload: { dados: { motivo: 'Dissolver o master' }, senha: SENHA },
    });
    expect(master.statusCode, master.body).toBe(409);
    expect(master.json().codigo).toBe('master-nao-dissolve');
  });
});
