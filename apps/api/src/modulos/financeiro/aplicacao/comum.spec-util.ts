// Apoio dos testes do financeiro pela HTTP (M32): a app com a sessão real sobre a fonte sintética, o módulo registrado
// (API_MODULOS=financeiro) e a porta EM MEMÓRIA (nada conecta a banco), o login dos usuários sintéticos da segregação
// e as chamadas com a Idempotency-Key.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { expect } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { armazemFinanceiroMemoria } from '../armazem.js';
import { moduloFinanceiro } from '../modulo.js';
import { PortaFinanceiroMemoria } from '../porta-memoria.js';

export interface Sessao {
  cookie: string;
  csrf: string;
}

export interface AppFinanceiro {
  app: NestFastifyApplication;
  trilha: RegistradorTrilhaMemoria;
  porta: PortaFinanceiroMemoria;
  armazem: ReturnType<typeof armazemFinanceiroMemoria>;
  entrar(login: string): Promise<Sessao>;
  get(s: Sessao, url: string): ReturnType<NestFastifyApplication['inject']>;
  post(
    s: Sessao,
    url: string,
    payload?: unknown,
    chave?: string,
  ): ReturnType<NestFastifyApplication['inject']>;
}

let seq = 0;

export async function appFinanceiro(): Promise<AppFinanceiro> {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'financeiro' };
  const trilha = new RegistradorTrilhaMemoria();
  const porta = new PortaFinanceiroMemoria({ estado: () => 'verde' });
  const armazem = armazemFinanceiroMemoria();
  const app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      financeiro: async () => ({ modulo: (ctx) => moduloFinanceiro(ctx, { porta, armazem }) }),
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    trilha,
    porta,
    armazem,
    async entrar(login) {
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
    },
    get: (s, url) => app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }),
    post: (s, url, payload = {}, chave) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: {
          cookie: s.cookie,
          'x-csrf': s.csrf,
          'idempotency-key': chave ?? `teste-m32-${++seq}-${Date.now()}`,
        },
        payload: payload as object,
      }),
  };
}

/** Um título sintético a lançar (fornecedor 5001, uma parcela, classificação 216.2.1). */
export function tituloSintetico(
  documento: number,
  hoje: string,
  valor = 1_234.56,
  extra: Record<string, unknown> = {},
) {
  return {
    tipo: 'F',
    credor: 5001,
    documento,
    emissao: hoje,
    valorDocumento: valor,
    referente: 'SINTETICO TESTE',
    parcelas: [{ parcela: 1, vencimento: hoje, valor }],
    classificacao: { grupo: 216, subgrupo: 2, item: 1 },
    ...extra,
  };
}

export const SISTEMA_ANTIGO = /SPDATA|legado|sistema antigo/i;
