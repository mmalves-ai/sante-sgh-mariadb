// 02-AGE 48 na porta da agenda em MEMÓRIA (fonte sintética do E2E): a lista de espera grava o grupo de prioridade
// legal pela mesma regra do domínio da porta própria (grupo informado inexistente recusado), a fila sai na ordem do
// domínio (urgência clínica, grupo legal, antiguidade) e a oferta confere a vaga (compatível; fora da ordem só com
// motivo). Pacientes e agendas SINTÉTICOS.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { moduloAgenda, pacientesSinteticos } from './modulo.js';
import { PortaAgendaMemoria } from './porta-memoria.js';

const HOJE = '2026-10-21';
const AMANHA = '2026-10-22';
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'agenda' };
const porta = new PortaAgendaMemoria(
  null,
  async (_c, ids) => pacientesSinteticos(ids),
  () => ({ hoje: HOJE, hora: '07:00' }),
);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha: new RegistradorTrilhaMemoria(),
    registro: { agenda: async () => ({ modulo: (ctx) => moduloAgenda(ctx, { porta }) }) },
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
async function entrar(): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login: 'SINT.AGENDA', senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
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
const A = '/api/agenda/consultas';
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `${A}${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: `${A}${url}`,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `espera-mem-${++chave}-${Date.now()}` },
    payload: payload as object,
  });

interface ItemFila {
  id: number;
  idPaciente: number;
  prioridade: string;
  prioridadeLegal: { id: number; descricao: string; peso: number } | null;
  posicao: number | null;
  situacao: string;
}

describe('lista de espera com prioridade legal (porta em memória)', () => {
  it('grava o grupo, recusa grupo inexistente e ordena pela regra do domínio', async () => {
    const s = await entrar();
    const semGrupo = await post(s, '/espera', { paciente: 1003, agenda: 903, prioridade: 'normal' });
    expect(semGrupo.statusCode).toBe(201);
    const ruim = await post(s, '/espera', {
      paciente: 1001,
      agenda: 903,
      prioridade: 'normal',
      prioridadeLegal: 99,
    });
    expect(ruim.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      (await get(s, '/espera')).json().itens.filter((x: ItemFila) => x.idPaciente === 1001),
    ).toHaveLength(0);
    const gestante = await post(s, '/espera', {
      paciente: 1001,
      agenda: 903,
      prioridade: 'normal',
      prioridadeLegal: 3,
    });
    expect(gestante.statusCode).toBe(201);
    const l = (await get(s, '/espera')).json().itens as ItemFila[];
    const g = l.find((x) => x.idPaciente === 1001);
    const n = l.find((x) => x.idPaciente === 1003);
    expect(g).toMatchObject({
      prioridade: 'preferencial',
      prioridadeLegal: { id: 3, descricao: 'Gestante', peso: 2 },
      posicao: 1,
    });
    expect(n).toMatchObject({ prioridade: 'normal', prioridadeLegal: null, posicao: 2 });
  });

  it('a oferta recusa vaga incompatível e fora da ordem sem motivo; com motivo, oferta', async () => {
    const s = await entrar();
    const l = (await get(s, '/espera')).json().itens as ItemFila[];
    const segundo = l.find((x) => x.idPaciente === 1003 && x.situacao === 'aguardando');
    expect(segundo?.posicao).toBe(2);
    const vaga = { data: AMANHA, hora: '08:00' };
    const incompativel = await post(s, `/espera/${segundo?.id}/ofertar`, { ...vaga, agenda: 904 });
    expect(incompativel.json().codigo).toBe('vaga-incompativel');
    const semMotivo = await post(s, `/espera/${segundo?.id}/ofertar`, { ...vaga, agenda: 903 });
    expect(semMotivo.json().codigo).toBe('oferta-fora-da-ordem');
    const depois = (await get(s, '/espera')).json().itens as ItemFila[];
    expect(depois.find((x) => x.id === segundo?.id)?.situacao).toBe('aguardando');
    const comMotivo = await post(s, `/espera/${segundo?.id}/ofertar`, {
      ...vaga,
      agenda: 903,
      motivo: 'Paciente sintético com retorno de exame',
    });
    expect(comMotivo.statusCode).toBe(200);
    const fim = (await get(s, '/espera')).json().itens as ItemFila[];
    expect(fim.find((x) => x.id === segundo?.id)?.situacao).toBe('ofertado');
    // O primeiro da fila recebe a vaga sem motivo.
    const primeiro = fim.find((x) => x.idPaciente === 1001 && x.situacao === 'aguardando');
    const ok = await post(s, `/espera/${primeiro?.id}/ofertar`, { ...vaga, agenda: 903, hora: '08:15' });
    expect(ok.statusCode).toBe(200);
  });
});
