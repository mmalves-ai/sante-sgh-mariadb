// W1-01 (parte 11a2): API do provisionamento pelo RH sobre a app inteira (fonte da gestão em memória, estado sintético
// com vínculos sintéticos): tarefas derivadas (criar com perfil sugerido pelo mapa, revisar a mudança, suspender só com o
// parâmetro ligado), recusas do domínio antes da senha, resolução imutável, suspender feita = bloqueio pelo executor,
// mapa cargo -> perfil por linha nova (igual e retirar sem sugestão recusados); trilha com motivo e sem a senha.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { estadoAcessoSintetico, reiniciarEstadoAcessoSintetico } from './fonte-sintetica.js';
import { RhAcessoController } from './rh.controller.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;
const cookies = new Map<string, string>();
const URL = '/api/acesso/gestao/rh';

const dia = (deslocamento: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(Date.now() + deslocamento * 86_400_000),
  );
const cab = () => ({
  cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
  'x-csrf': cookies.get('sgh_csrf') ?? '',
  'idempotency-key': `teste-rh-${++chave}-${Date.now()}`,
});
const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: cab(), payload });
const get = async <T>(url: string) => (await app.inject({ method: 'GET', url, headers: cab() })).json() as T;

beforeAll(async () => {
  reiniciarEstadoAcessoSintetico();
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem: new ArmazemMemoria() });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    headers: { host: 'localhost' },
    payload: { estabelecimento: 'aa', login: 'SINT.GESTOR', senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = r.headers['set-cookie'];
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [par] = c.split(';');
    const i = par?.indexOf('=') ?? -1;
    if (par && i > 0) cookies.set(par.slice(0, i), par.slice(i + 1));
  }
});
afterAll(async () => {
  await app.close();
  reiniciarEstadoAcessoSintetico();
});

interface Tarefa {
  tipo: string;
  vinculo: number;
  ref: string;
  login: string | null;
  perfilSugerido: string | null;
  detalhe: string[];
}
interface Lista {
  hoje: string;
  tarefas: Tarefa[];
  resolvidas: { tipo: string; vinculo: number; situacao: string; login: string | null; motivo: string }[];
  parametros: { suspenderAfastamento: boolean; diasMinimosAfastamento: number };
  bloqueio: { ligada: boolean };
}
interface Mapa {
  vigentes: Record<string, string>;
  historico: { cargo: string; perfil: string | null; situacao: string }[];
  perfis: string[];
  cargos: string[];
}

describe('API do provisionamento pelo RH (W1-01 parte 11a2)', () => {
  it('tarefas derivadas, mapa cargo -> perfil, resolução imutável e suspensão pelo executor', async () => {
    const est = estadoAcessoSintetico();
    const base = { funcao: null, setor: 'UTI', desligamento: null };
    est.rh.vinculos.push(
      {
        ...base,
        id: 1,
        nome: 'SINT ADMITIDO',
        cargo: 'Técnico de enfermagem',
        admissao: dia(-2),
        usuario: null,
        login: null,
      },
      {
        ...base,
        id: 2,
        nome: 'SINT PROMOVIDO',
        cargo: 'ENFERMEIRO',
        admissao: '2025-01-02',
        usuario: 2,
        login: 'SINT.MEDICO',
      },
      {
        ...base,
        id: 3,
        nome: 'SINT AFASTADO',
        cargo: 'RECEPCIONISTA',
        admissao: '2025-01-02',
        usuario: 3,
        login: 'SINT.RECEPCAO',
      },
    );
    est.rh.mudancas.push({
      id: 5,
      vinculo: 2,
      tipo: 'cargo',
      vigencia: dia(-1),
      antes: 'TECNICO',
      depois: 'ENFERMEIRO',
    });
    est.rh.afastamentos.push({
      vinculo: 3,
      ref: 'afastamento:1',
      natureza: 'afastamento',
      inicio: dia(-3),
      fim: null,
    });

    // Parâmetro padrão: sem a tarefa de suspender.
    const l0 = await get<Lista>(`${URL}/tarefas`);
    expect(l0.parametros).toEqual({ suspenderAfastamento: false, diasMinimosAfastamento: 15 });
    expect(l0.bloqueio.ligada).toBe(true);
    expect(l0.tarefas.map((t) => [t.tipo, t.vinculo, t.ref])).toEqual([
      ['criar-acesso', 1, 'admissao'],
      ['revisar-acesso', 2, '5'],
    ]);
    expect(l0.tarefas[0]?.perfilSugerido).toBeNull();
    expect(l0.tarefas[1]).toMatchObject({ login: 'SINT.MEDICO' });
    expect(l0.tarefas[1]?.detalhe[0]).toContain('TECNICO → ENFERMEIRO');

    // Mapa cargo -> perfil: linha nova; igual e perfil fora da lista recusados; a tarefa passa a sugerir.
    const m0 = await get<Mapa>(`${URL}/perfis-cargo`);
    expect(m0.cargos).toEqual(['ENFERMEIRO', 'RECEPCIONISTA', 'TECNICO DE ENFERMAGEM']);
    const perfil = m0.perfis[0]!;
    const mapa = {
      cargo: 'Técnico de enfermagem',
      perfil,
      motivo: 'perfil padrão da enfermagem',
      senha: SENHA,
    };
    expect(
      (await post(`${URL}/perfis-cargo`, { ...mapa, perfil: 'perfil-que-nao-existe' })).json(),
    ).toMatchObject({
      codigo: 'perfil-desconhecido',
    });
    expect(
      (await post(`${URL}/perfis-cargo`, { ...mapa, senha: 'senha-errada-123' })).statusCode,
    ).toBeGreaterThanOrEqual(400);
    const def = await post(`${URL}/perfis-cargo`, mapa);
    expect(def.statusCode).toBe(200);
    expect(def.json()).toMatchObject({ anterior: null, perfil, destino: 'memoria' });
    expect((await post(`${URL}/perfis-cargo`, mapa)).json()).toMatchObject({ codigo: 'sem-mudanca' });
    expect((await get<Mapa>(`${URL}/perfis-cargo`)).vigentes).toEqual({ 'TECNICO DE ENFERMAGEM': perfil });
    expect((await get<Lista>(`${URL}/tarefas`)).tarefas[0]?.perfilSugerido).toBe(perfil);

    // Resolver: recusas do domínio antes da senha.
    const criar = {
      tipo: 'criar-acesso',
      vinculo: 1,
      ref: 'admissao',
      situacao: 'feita',
      login: 'SINT.USUARIO',
      motivo: 'acesso criado pela ficha nova',
      senha: SENHA,
    };
    expect((await post(`${URL}/tarefas/resolver`, { ...criar, login: null })).json()).toMatchObject({
      codigo: 'login-obrigatorio',
    });
    expect((await post(`${URL}/tarefas/resolver`, { ...criar, motivo: 'curto' })).json()).toMatchObject({
      codigo: 'motivo-curto',
    });
    expect(
      (await post(`${URL}/tarefas/resolver`, { ...criar, login: 'SINT.NAOEXISTE' })).json(),
    ).toMatchObject({
      codigo: 'login-inexistente',
    });
    expect((await post(`${URL}/tarefas/resolver`, { ...criar, vinculo: 99 })).json()).toMatchObject({
      codigo: 'tarefa-inexistente',
    });
    expect(
      (await post(`${URL}/tarefas/resolver`, { ...criar, senha: 'senha-errada-123' })).statusCode,
    ).toBeGreaterThanOrEqual(400);
    const feita = await post(`${URL}/tarefas/resolver`, criar);
    expect(feita.statusCode).toBe(200);
    expect(feita.json()).toMatchObject({ bloqueado: false, destino: 'memoria' });
    // Imutável: a mesma tarefa não volta nem se resolve de novo.
    expect((await post(`${URL}/tarefas/resolver`, criar)).json()).toMatchObject({
      codigo: 'tarefa-inexistente',
    });
    const revisar = {
      ...criar,
      tipo: 'revisar-acesso',
      vinculo: 2,
      ref: '5',
      situacao: 'dispensada',
      motivo: 'mesmo perfil no cargo novo',
    };
    expect((await post(`${URL}/tarefas/resolver`, revisar)).json()).toMatchObject({
      codigo: 'login-indevido',
    });
    expect((await post(`${URL}/tarefas/resolver`, { ...revisar, login: null })).statusCode).toBe(200);
    const l1 = await get<Lista>(`${URL}/tarefas`);
    expect(l1.tarefas).toEqual([]);
    expect(l1.resolvidas.map((r) => [r.tipo, r.situacao, r.login])).toEqual([
      ['revisar-acesso', 'dispensada', null],
      ['criar-acesso', 'feita', 'SINT.USUARIO'],
    ]);

    // Parâmetro ligado: o afastamento em curso gera a tarefa; feita = bloqueio pelo executor.
    const c = app.get(RhAcessoController);
    const original = c.parametros.bind(c);
    c.parametros = () => Promise.resolve({ suspenderAfastamento: true, diasMinimosAfastamento: 15 });
    try {
      const l2 = await get<Lista>(`${URL}/tarefas`);
      expect(l2.tarefas.map((t) => [t.tipo, t.vinculo, t.ref, t.login])).toEqual([
        ['suspender-acesso', 3, 'afastamento:1', 'SINT.RECEPCAO'],
      ]);
      const sus = await post(`${URL}/tarefas/resolver`, {
        ...criar,
        tipo: 'suspender-acesso',
        vinculo: 3,
        ref: 'afastamento:1',
        login: null,
        motivo: 'afastamento sem data de retorno',
      });
      expect(sus.statusCode).toBe(200);
      expect(sus.json()).toMatchObject({ bloqueado: true });
      expect(est.bloqueio.get('SINT.RECEPCAO')).toBe(true);
      expect((await get<Lista>(`${URL}/tarefas`)).tarefas).toEqual([]);
    } finally {
      c.parametros = original;
    }

    // Retirar a sugestão: linha nova; retirar de novo recusado; histórico com as duas.
    const ret = await post(`${URL}/perfis-cargo`, {
      ...mapa,
      perfil: null,
      motivo: 'cargo sem perfil padrão',
    });
    expect(ret.json()).toMatchObject({ anterior: perfil, perfil: null });
    expect((await post(`${URL}/perfis-cargo`, { ...mapa, perfil: null })).json()).toMatchObject({
      codigo: 'sem-sugestao',
    });
    const m2 = await get<Mapa>(`${URL}/perfis-cargo`);
    expect(m2.vigentes).toEqual({});
    expect(m2.historico.map((h) => h.situacao)).toEqual(['retirado', 'vigente']);

    // Trilha: os eventos do RH e o bloqueio; nunca a senha.
    const eventos = trilha.eventos.map((x) => x.evento);
    expect(eventos).toContain('acesso.rh.tarefa-resolvida');
    expect(eventos).toContain('acesso.rh.perfil-cargo-definido');
    expect(JSON.stringify(trilha.eventos)).not.toContain(SENHA);
  });

  it('revisão (achado 1): depois de "criar acesso" feita, o login é o usuário do vínculo: mudança gera revisão e afastamento gera suspensão; login de outro vínculo recusado', async () => {
    const est = estadoAcessoSintetico();
    est.rh.vinculos.push({
      id: 10,
      nome: 'SINT ADMITIDA NOVA',
      cargo: 'RECEPCIONISTA',
      funcao: null,
      setor: 'UTI',
      admissao: dia(-5),
      desligamento: null,
      usuario: null,
      login: null,
    });
    const criar = {
      tipo: 'criar-acesso',
      vinculo: 10,
      ref: 'admissao',
      situacao: 'feita',
      login: 'SINT.MEDICO',
      motivo: 'acesso criado pela ficha nova',
      senha: SENHA,
    };
    // SINT.MEDICO já é o acesso do vínculo 2 (gestão de pessoas): recusado antes de gravar.
    expect((await post(`${URL}/tarefas/resolver`, criar)).json()).toMatchObject({
      codigo: 'login-de-outro-vinculo',
    });
    const feita = await post(`${URL}/tarefas/resolver`, { ...criar, login: 'SINT.COMUNICACAO' });
    expect(feita.statusCode).toBe(200);
    expect((await get<Lista>(`${URL}/tarefas`)).tarefas.filter((t) => t.vinculo === 10)).toEqual([]);

    // Troca de cargo do admitido: a revisão aparece, com o login criado.
    est.rh.mudancas.push({
      id: 50,
      vinculo: 10,
      tipo: 'cargo',
      vigencia: dia(-1),
      antes: 'RECEPCIONISTA',
      depois: 'ENFERMEIRO',
    });
    const l1 = await get<Lista>(`${URL}/tarefas`);
    expect(l1.tarefas.map((t) => [t.tipo, t.vinculo, t.ref, t.login])).toEqual([
      ['revisar-acesso', 10, '50', 'SINT.COMUNICACAO'],
    ]);

    // Afastamento com suspensão ligada: a tarefa aparece e "feita" bloqueia o login criado (não recusa 'sem-usuario').
    est.rh.afastamentos.push({
      vinculo: 10,
      ref: 'afastamento:9',
      natureza: 'afastamento',
      inicio: dia(-2),
      fim: null,
    });
    const c = app.get(RhAcessoController);
    const original = c.parametros.bind(c);
    c.parametros = () => Promise.resolve({ suspenderAfastamento: true, diasMinimosAfastamento: 15 });
    try {
      const l2 = await get<Lista>(`${URL}/tarefas`);
      expect(l2.tarefas.map((t) => [t.tipo, t.vinculo, t.login])).toEqual([
        ['revisar-acesso', 10, 'SINT.COMUNICACAO'],
        ['suspender-acesso', 10, 'SINT.COMUNICACAO'],
      ]);
      const sus = await post(`${URL}/tarefas/resolver`, {
        ...criar,
        tipo: 'suspender-acesso',
        ref: 'afastamento:9',
        login: null,
        motivo: 'afastamento sem data de retorno',
      });
      expect(sus.statusCode).toBe(200);
      expect(sus.json()).toMatchObject({ bloqueado: true });
      expect(est.bloqueio.get('SINT.COMUNICACAO')).toBe(true);
    } finally {
      c.parametros = original;
    }
  });
});
