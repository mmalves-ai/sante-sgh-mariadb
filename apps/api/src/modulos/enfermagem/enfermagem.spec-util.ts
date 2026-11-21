// Aplicação de teste da enfermagem beira-leito (M25) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM
// MEMÓRIA (nada conecta a banco): usada pelo enfermagem.spec.ts e pelos testes de integração da aplicação nomeados na
// ficha (aplicacao/*.int.spec.ts). Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { expect } from 'vitest';
import { criarAppComEnfermagem } from './app-enfermagem.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaEnfermagemMemoria } from './porta-memoria.js';

export { SENHA };

export interface Sessao {
  cookie: string;
  csrf: string;
}

export interface AppEnfermagem {
  app: NestFastifyApplication;
  trilha: RegistradorTrilhaMemoria;
  porta: PortaEnfermagemMemoria;
  entrar(login: string): Promise<Sessao>;
  get(s: Sessao, url: string): ReturnType<NestFastifyApplication['inject']>;
  post(
    s: Sessao,
    url: string,
    payload?: unknown,
    chave?: string,
  ): ReturnType<NestFastifyApplication['inject']>;
  fechar(): Promise<void>;
}

let seq = 0;

/** 2026-10-22 13:00 em São Paulo. */
export const RELOGIO_TESTE = '2026-10-22T16:00:00Z';

export async function criarAppEnfermagem(): Promise<AppEnfermagem> {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
  const trilha = new RegistradorTrilhaMemoria();
  // O relógio fixo do estabelecimento (13:00 em São Paulo, no meio do turno diurno): os estados não dependem da hora.
  const porta = new PortaEnfermagemMemoria({ agora: () => new Date(RELOGIO_TESTE) });
  const app = await criarAppComEnfermagem(env, { trilha, enfermagem: porta, vigiaEnfermagem: null });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const entrar = async (login: string): Promise<Sessao> => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha: SENHA },
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
  };
  return {
    app,
    trilha,
    porta,
    entrar,
    get: (s, url) => app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }),
    post: (s, url, payload = {}, chave) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: {
          cookie: s.cookie,
          'x-csrf': s.csrf,
          'idempotency-key': chave ?? `teste-m25-${++seq}-${Date.now()}`,
        },
        payload: payload as object,
      }),
    fechar: () => app.close(),
  };
}

/** Os horários da UTI sintética (a linha do tempo do turno). */
export async function horariosDaUti(a: AppEnfermagem, s: Sessao) {
  const r = await a.get(s, '/enfermagem/turno?unidade=UTI');
  expect(r.statusCode).toBe(200);
  return r.json() as {
    horarios: {
      id: number;
      descricao: string;
      estado: string;
      situacao: string;
      paciente: number;
      numero: number;
      tipo: string;
      altaVigilancia: boolean;
      hemocomponente: boolean;
      dose: number | null;
      previsto: string;
    }[];
    resumo: Record<string, number>;
    pacientes: { paciente: number; numero: number; atendimento: number }[];
  };
}

/** A checagem administrada com a pulseira do paciente (o mínimo da tela). */
export function checagemPadrao(paciente: number, numero: number, extra: Record<string, unknown> = {}) {
  return {
    desfecho: 'administrado',
    situacaoLida: 'P',
    pulseira: { lida: true, codigo: `P${paciente}|A${numero}` },
    avisosConferidos: true,
    ...extra,
  };
}
