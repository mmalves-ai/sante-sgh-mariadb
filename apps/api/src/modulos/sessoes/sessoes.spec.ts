// M50, etapa 6 (agenda de sessões e recursos) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA
// com o relógio fixo (nada conecta a banco): a grade das cadeiras e salas, a prévia com as datas e os conflitos, a série
// gravada com a trilha, a cadeira e o paciente ocupados recusados, o recurso que não aceita a complexidade, a faixa
// etária ou a primeira sessão no passado, e a situação de cada sessão (a falta futura recusada, o cancelamento com o
// motivo, a versão antiga recusada e as restantes da série canceladas). Quem não tem a permissão não lê nem grava.
import { EVENTOS_AUDITAVEIS as E } from '@sgh/contratos';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { moduloSessoes } from './modulo.js';
import { PortaSessoesMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'sessoes' };
const trilha = new RegistradorTrilhaMemoria();
const NASC: Record<number, string> = { 1001: '1980-03-15', 1003: '1992-07-01', 1007: '2001-09-09' };
// 01/03/2027 às 07:00 (local, UTC-3).
const sessoes = new PortaSessoesMemoria(
  async (_c, ids) =>
    ids
      .filter((id) => id in NASC)
      .map((id) => ({
        id,
        prontuario: id - 500,
        nome: `PACIENTE SINTETICO ${id}`,
        nomeSocial: null,
        nascimento: NASC[id]!,
      })),
  () => new Date('2027-03-01T10:00:00Z'),
);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: { sessoes: async () => ({ modulo: (ctx) => moduloSessoes(ctx, { porta: sessoes }) }) },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode, r.body).toBe(201);
  const set = r.headers['set-cookie'] as string[];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m50-6-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });
const eventos = (codigo: string) => trilha.eventos.filter((l) => l.evento === codigo).length;

const SERIE = {
  paciente: 1001,
  recurso: 7001,
  complexidade: 2,
  duracao: 2,
  duracaoMin: 90,
  planoTipo: 'quimioterapia',
  plano: 'PROTOCOLO SINTETICO C1 D1',
  inicio: '2027-03-01',
  hora: '0800',
  sessoes: 4,
  intervaloDias: 7,
  pularFimDeSemana: true,
};

describe('agenda de sessões e recursos (M50, etapa 6)', () => {
  let terapias: Sessao;
  let social: Sessao;

  beforeAll(async () => {
    terapias = await entrar('SINT.SESSOES');
    social = await entrar('SINT.SOCIAL');
  });

  it('a gravação ligada na sintética; sem a opção do agendamento, nada', async () => {
    const g = await get(terapias, '/sessoes/gravacao');
    expect(g.statusCode, g.body).toBe(200);
    expect(g.json()).toMatchObject({ ligada: true, operacoes: { agendar: { pode: true } } });
    expect((await get(social, '/sessoes/grade')).statusCode).toBe(403);
    expect((await post(social, '/sessoes', SERIE)).statusCode).toBe(403);
  });

  it('a grade: as quatro cadeiras e salas com a faixa etária, os domínios e o período', async () => {
    const r = await get(terapias, '/sessoes/grade?de=2027-03-01&dias=7');
    expect(r.statusCode, r.body).toBe(200);
    const g = r.json();
    expect(g).toMatchObject({ de: '2027-03-01', ate: '2027-03-08', cortada: false });
    expect(g.recursos.map((x: { identificacao: string }) => x.identificacao)).toEqual([
      'CADEIRA 01',
      'CADEIRA PEDIATRICA',
      'CADEIRA 03 ALTA',
      'SALA 2',
    ]);
    expect(g.recursos[1].faixa).toEqual({ de: 0, ate: 17 });
    expect(g.recursos[0].faixa).toBeNull();
    expect(g.complexidades.length).toBeGreaterThan(1);
    expect((await get(terapias, '/sessoes/grade?agenda=702')).json().recursos).toHaveLength(1);
    expect(eventos(E.sessaoGradeLida.codigo)).toBeGreaterThan(0);
  });

  it('a prévia: as datas da série; as recusas do recurso viram aviso, não erro', async () => {
    const p = await post(terapias, '/sessoes/previa', SERIE);
    expect(p.statusCode, p.body).toBe(200);
    expect(p.json()).toMatchObject({ ok: true, recusa: null });
    expect(p.json().datas.map((d: { inicio: string }) => d.inicio)).toEqual([
      '2027-03-01T08:00',
      '2027-03-08T08:00',
      '2027-03-15T08:00',
      '2027-03-22T08:00',
    ]);
    const ped = await post(terapias, '/sessoes/previa', { ...SERIE, recurso: 7002 });
    expect(ped.json()).toMatchObject({ ok: false, recusa: { codigo: 'fora-da-faixa-etaria' } });
    const alta = await post(terapias, '/sessoes/previa', { ...SERIE, recurso: 7003 });
    expect(alta.json()).toMatchObject({ ok: false, recusa: { codigo: 'complexidade-nao-aceita' } });
    const passado = await post(terapias, '/sessoes/previa', { ...SERIE, inicio: '2027-02-28' });
    expect(passado.json()).toMatchObject({ ok: false, recusa: { codigo: 'data-passada' } });
    expect((await post(terapias, '/sessoes/previa', { ...SERIE, paciente: 999_999 })).statusCode).toBe(404);
    expect((await post(terapias, '/sessoes/previa', { ...SERIE, recurso: 99 })).statusCode).toBe(404);
    expect((await post(terapias, '/sessoes/previa', { ...SERIE, complexidade: 9 })).statusCode).toBe(400);
  });

  let serie = 0;
  let ids: number[] = [];
  it('agenda a série com a trilha; a cadeira e o paciente ocupados são recusados (prévia e gravação)', async () => {
    const antes = eventos(E.sessaoAgendada.codigo);
    const r = await post(terapias, '/sessoes', SERIE);
    expect(r.statusCode, r.body).toBe(201);
    serie = r.json().serie;
    ids = r.json().sessoes;
    expect(ids).toHaveLength(4);
    expect(eventos(E.sessaoAgendada.codigo)).toBe(antes + 1);
    const outro = { ...SERIE, paciente: 1003, hora: '0830', sessoes: 1 };
    const pr = await post(terapias, '/sessoes/previa', outro);
    expect(pr.json()).toMatchObject({ ok: false, datas: [{ conflito: 'recurso' }] });
    const ocupada = await post(terapias, '/sessoes', outro);
    expect(ocupada.statusCode).toBe(409);
    expect(ocupada.json()).toMatchObject({ codigo: 'recurso-ocupado' });
    const mesmoPaciente = await post(terapias, '/sessoes', {
      ...SERIE,
      recurso: 7004,
      complexidade: 1,
      duracao: 1,
      sessoes: 1,
      hora: '0900',
    });
    expect(mesmoPaciente.statusCode).toBe(409);
    expect(mesmoPaciente.json()).toMatchObject({ codigo: 'paciente-ocupado' });
    const livre = await post(terapias, '/sessoes', { ...outro, hora: '0930' });
    expect(livre.statusCode, livre.body).toBe(201);
    const g = (await get(terapias, '/sessoes/grade?de=2027-03-01&dias=14')).json();
    // [01/03, 15/03): as sessões 1 e 2 da série e a do outro paciente às 09:30.
    expect(g.sessoes).toHaveLength(3);
    expect(g.sessoes[0]).toMatchObject({
      nome: 'PACIENTE SINTETICO 1001',
      ordem: 1,
      total: 4,
      situacao: 'agendada',
    });
  });

  it('a situação: a falta futura recusada; a realizada de hoje; o cancelamento com motivo; a versão antiga; as restantes', async () => {
    const futura = await post(terapias, `/sessoes/${ids[1]}/situacao`, {
      sessao: ids[1],
      acao: 'falta',
      motivo: 'NAO VEIO',
      versao: 1,
    });
    expect(futura.statusCode).toBe(409);
    expect(futura.json()).toMatchObject({ codigo: 'sessao-futura' });
    const hoje = await post(terapias, `/sessoes/${ids[0]}/situacao`, {
      sessao: ids[0],
      acao: 'realizar',
      versao: 1,
    });
    expect(hoje.statusCode, hoje.body).toBe(200);
    const semMotivo = await post(terapias, `/sessoes/${ids[1]}/situacao`, {
      sessao: ids[1],
      acao: 'cancelar',
      versao: 1,
    });
    expect(semMotivo.statusCode).toBe(400);
    const cancela = await post(terapias, `/sessoes/${ids[1]}/situacao`, {
      sessao: ids[1],
      acao: 'cancelar',
      motivo: 'INTERCORRENCIA SINTETICA',
      versao: 1,
    });
    expect(cancela.statusCode, cancela.body).toBe(200);
    const antiga = await post(terapias, `/sessoes/${ids[2]}/situacao`, {
      sessao: ids[2],
      acao: 'cancelar',
      motivo: 'VERSAO ANTIGA',
      versao: 9,
    });
    expect(antiga.statusCode).toBe(409);
    const restantes = await post(terapias, `/sessoes/${ids[2]}/situacao`, {
      sessao: ids[2],
      acao: 'cancelar-restantes',
      motivo: 'PLANO SUSPENSO',
      versao: 1,
    });
    expect(restantes.statusCode, restantes.body).toBe(200);
    expect(restantes.json().mensagem).toContain('2 sessão(ões)');
    const ja = await post(terapias, `/sessoes/${ids[0]}/situacao`, {
      sessao: ids[0],
      acao: 'cancelar',
      motivo: 'DE NOVO',
      versao: 2,
    });
    expect(ja.json()).toMatchObject({ codigo: 'sessao-encerrada' });
    expect(
      (await post(terapias, `/sessoes/${ids[0]}/situacao`, { sessao: ids[1], acao: 'realizar', versao: 1 }))
        .statusCode,
    ).toBe(400);
    const p = (await get(terapias, '/sessoes/pacientes/1001')).json();
    expect(p.sessoes.map((x: { situacao: string }) => x.situacao)).toEqual([
      'realizada',
      'cancelada',
      'cancelada',
      'cancelada',
    ]);
    expect(p.sessoes.every((x: { serie: number }) => x.serie === serie)).toBe(true);
    expect((await get(terapias, '/sessoes/pacientes/999999')).statusCode).toBe(404);
    // O cancelamento libera a cadeira: outra série cabe no horário cancelado.
    const reaproveita = await post(terapias, '/sessoes', {
      ...SERIE,
      paciente: 1007,
      inicio: '2027-03-08',
      sessoes: 1,
    });
    expect(reaproveita.statusCode, reaproveita.body).toBe(201);
  });
});
