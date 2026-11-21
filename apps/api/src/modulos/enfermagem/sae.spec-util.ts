// Aplicação de teste da etapa 4 do M45 pela HTTP (sessão real sobre a fonte sintética; portas EM MEMÓRIA; nada conecta a
// banco; dados sintéticos), com o relógio fixo em 2026-10-22 13:00 de São Paulo e, se pedido, uma chave desligada pelo
// administrador. Usada pelo sae.spec.ts, pelo prescricao-enfermeiro.http.spec.ts e pelo vacina-rnds.spec.ts.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { expect } from 'vitest';
import { criarAppComEnfermagem } from './app-enfermagem.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { PortaEnfermagemMemoria } from './porta-memoria.js';

export { SENHA };

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-22 13:00 em São Paulo (turno diurno). */
const agora = () => new Date('2026-10-22T16:00:00Z');

export interface Sessao {
  cookie: string;
  csrf: string;
}

export async function montarAppSae(o: { semChave?: string } = {}) {
  const trilha = new RegistradorTrilhaMemoria();
  const enfermagem = new PortaEnfermagemMemoria(
    { agora },
  );
  const configuracao = o.semChave
    ? fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== o.semChave),
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
        parametrosIniciais: parametrosIniciaisSinteticos,
      })
    : undefined;
  const app: NestFastifyApplication = await criarAppComEnfermagem(env, {
    trilha,
    enfermagem,
    vigiaEnfermagem: null,
    ...(configuracao ? { configuracao } : {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  return {
    app,
    trilha,
    async entrar(login: string): Promise<Sessao> {
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
    get: (s: Sessao, url: string) =>
      app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }),
    post: (s: Sessao, url: string, payload: unknown = {}, chave?: string) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: {
          cookie: s.cookie,
          'x-csrf': s.csrf,
          'idempotency-key': chave ?? `teste-m45e4-${++seq}-${Date.now()}`,
        },
        payload: payload as object,
      }),
  };
}
