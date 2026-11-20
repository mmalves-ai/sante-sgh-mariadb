// M06, regra 8: quebra de vidro pela HTTP com a sessão real (fonte sintética, sem banco): sem vínculo o
// médico recebe a oferta; a abertura exige a senha de novo (reautenticação) e CSRF, grava na trilha
// (memória) e manda o alerta (dublê da fila); depois, o prontuário sintético abre "por emergência" e a
// leitura é auditada. A recepção (sem conselho, sem a permissão) só recebe a negativa.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS, tipoDoProblema } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste } from '../../sessao/teste.spec-util.js';
import type { AlertaAuditor, AlertaEmergencia } from './alerta.js';
import { PACIENTE_DEMONSTRACAO } from './emergencia.controller.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const alertas: AlertaEmergencia[] = [];
const alerta: AlertaAuditor = {
  emergenciaAberta: (a) => {
    alertas.push(a);
    return Promise.resolve('enfileirado');
  },
};
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, alerta });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

async function entrar(login: string): Promise<{ cookie: string; csrf: string }> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: 'Sintetico#2026' },
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

const URL_DEMO = `/api/acesso/emergencias/demonstracao/pacientes/${PACIENTE_DEMONSTRACAO.id}`;
const pedido = (senha: string) => ({
  idPaciente: PACIENTE_DEMONSTRACAO.id,
  motivo: 'intercorrencia-outro-setor',
  justificativa: 'Intercorrência no corredor; atendimento imediato',
  senha,
});

describe('quebra de vidro (regra 8)', () => {
  it('médico: oferta, reautenticação, abertura auditada com alerta, e leitura por emergência', async () => {
    const s = await entrar('SINT.MEDICO');
    const negado = await app.inject({ method: 'GET', url: URL_DEMO, headers: { cookie: s.cookie } });
    expect(negado.statusCode).toBe(403);
    expect(tipoDoProblema(negado.json())).toBe('sem-vinculo');
    expect(negado.json()).toMatchObject({ quebraDeVidro: true });
    const semCsrf = await app.inject({
      method: 'POST',
      url: '/api/acesso/emergencias',
      headers: { cookie: s.cookie },
      payload: pedido('Sintetico#2026'),
    });
    expect(semCsrf.statusCode).toBe(403);
    const senhaErrada = await app.inject({
      method: 'POST',
      url: '/api/acesso/emergencias',
      headers: { cookie: s.cookie, 'x-csrf': s.csrf },
      payload: pedido('errada'),
    });
    expect(senhaErrada.statusCode).toBe(401);
    const curta = await app.inject({
      method: 'POST',
      url: '/api/acesso/emergencias',
      headers: { cookie: s.cookie, 'x-csrf': s.csrf },
      payload: { ...pedido('Sintetico#2026'), justificativa: 'curta' },
    });
    expect(curta.statusCode).toBe(400);
    trilha.eventos.length = 0;
    const r = await app.inject({
      method: 'POST',
      url: '/api/acesso/emergencias',
      headers: { cookie: s.cookie, 'x-csrf': s.csrf },
      payload: pedido('Sintetico#2026'),
    });
    expect(r.statusCode).toBe(201);
    const aberta = r.json() as { id: string; fim: string; alerta: string };
    expect(aberta.alerta).toBe('enfileirado');
    expect(alertas.at(-1)).toMatchObject({
      hospital: 'aa',
      idEmergencia: aberta.id,
      motivo: 'intercorrencia-outro-setor',
    });
    expect(JSON.stringify(alertas)).not.toMatch(/Intercorrência no corredor|Fictício/);
    const lido = await app.inject({ method: 'GET', url: URL_DEMO, headers: { cookie: s.cookie } });
    expect(lido.statusCode).toBe(200);
    expect(lido.json()).toMatchObject({ porEmergencia: true });
    const eventos = trilha.eventos.map((e) => e.evento);
    expect(eventos).toEqual(
      expect.arrayContaining([
        EVENTOS_AUDITAVEIS.emergenciaAberta.codigo,
        EVENTOS_AUDITAVEIS.consultaRes.codigo,
      ]),
    );
    expect(JSON.stringify(trilha.eventos)).not.toMatch(/Intercorrência no corredor|Sintetico#2026/);
  });

  it('recepção: sem a permissão nem conselho, só a negativa (sem oferta) e a abertura é recusada', async () => {
    const s = await entrar('SINT.RECEPCAO');
    const negado = await app.inject({ method: 'GET', url: URL_DEMO, headers: { cookie: s.cookie } });
    expect(negado.statusCode).toBe(403);
    expect(tipoDoProblema(negado.json())).toBe('sem-vinculo');
    expect(negado.json()).toMatchObject({ quebraDeVidro: false });
    const r = await app.inject({
      method: 'POST',
      url: '/api/acesso/emergencias',
      headers: { cookie: s.cookie, 'x-csrf': s.csrf },
      payload: pedido('Sintetico#2026'),
    });
    expect(r.statusCode).toBe(403);
  });
});
