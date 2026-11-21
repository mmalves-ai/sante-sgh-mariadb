// Aplicação de teste da portaria (M50, etapa 5) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM
// MEMÓRIA (nada conecta a banco): usada pelo portaria.spec.ts e pelo teste de autorização do porteiro
// (aplicacao/porteiro.autorizacao.int.spec.ts). Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { expect } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { moduloPortaria } from './modulo.js';
import { type OpcoesPortariaMemoria, PortaPortariaMemoria, REGRAS_SINTETICAS } from './porta-memoria.js';

export interface Sessao {
  cookie: string;
  csrf: string;
}

export interface AppPortaria {
  app: NestFastifyApplication;
  trilha: RegistradorTrilhaMemoria;
  porta: PortaPortariaMemoria;
  relogio: { agora: Date };
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

/** As regras dos testes: o estabelecimento das 14 h às 20 h; a UTI com 1 visitante; a INT-2 das 16 h às 18 h. */
export const REGRAS_TESTE: NonNullable<OpcoesPortariaMemoria['regras']> = [
  { ...REGRAS_SINTETICAS[0]!, horaInicio: '14:00', horaFim: '20:00' },
  { ...REGRAS_SINTETICAS[1]!, horaInicio: '14:00', horaFim: '20:00' },
  { ...REGRAS_SINTETICAS[0]!, unidade: 'INT-2', horaInicio: '16:00', horaFim: '18:00', observacao: null },
];

export async function criarAppPortaria(o: { agora?: Date } = {}): Promise<AppPortaria> {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'portaria' };
  const trilha = new RegistradorTrilhaMemoria();
  // 15:00 do relógio do estabelecimento (o processo dos testes roda em UTC).
  const relogio = { agora: o.agora ?? new Date(2026, 9, 25, 15, 0, 0) };
  const porta = new PortaPortariaMemoria({ agora: () => relogio.agora, regras: REGRAS_TESTE });
  const app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: { portaria: async () => ({ modulo: (ctx) => moduloPortaria(ctx, { porta }) }) },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const entrar = async (login: string): Promise<Sessao> => {
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
  };
  return {
    app,
    trilha,
    porta,
    relogio,
    entrar,
    get: (s, url) => app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }),
    post: (s, url, payload = {}, chave) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: {
          cookie: s.cookie,
          'x-csrf': s.csrf,
          'idempotency-key': chave ?? `teste-m50-5-${++seq}-${Date.now()}`,
        },
        payload: payload as object,
      }),
    fechar: () => app.close(),
  };
}

/** Um visitante sintético (o documento "outro" diferencia; o nascimento adulto). */
export async function cadastrar(
  a: AppPortaria,
  s: Sessao,
  documento: string,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const r = await a.post(s, '/portaria/visitantes', {
    nome: `Visitante Sintetico ${documento}`,
    tipoDocumento: 'outro',
    documento,
    nascimento: '1980-05-01',
    tipoVisitante: 6,
    ...extra,
  });
  expect(r.statusCode, r.body).toBe(201);
  return (r.json() as { id: number }).id;
}

/** A visita ao paciente com o crachá. */
export const visita = (
  a: AppPortaria,
  s: Sessao,
  visitante: number,
  internacao: number,
  extra: Record<string, unknown> = {},
) =>
  a.post(s, '/portaria/visitas', {
    visitante,
    destino: { tipo: 'paciente', internacao },
    identificacao: 2,
    ...extra,
  });
