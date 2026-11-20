// Aplicação de teste da anestesia (M46, etapa 1) pela HTTP: a sessão real sobre a fonte sintética, o centro cirúrgico e a
// anestesia EM MEMÓRIA (nada conecta a banco; dados SINTÉTICOS), o relógio fixo em 2026-10-21 09:00 e, se pedido, a chave
// `bloco.ficha` desligada pelo administrador. Usada pelo anestesia.spec.ts e pelo aplicacao/ficha.autorizacao.int.spec.ts.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { expect } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { PortaAnestesiaMemoria } from './anestesia-porta-memoria.js';
import { PortaCirurgiaMemoria } from './porta-memoria.js';

export { SENHA };
export const HOJE = '2026-10-21';
export const AMANHA = '2026-10-22';

export interface Sessao {
  cookie: string;
  csrf: string;
}

export async function montarAppAnestesia(o: { semChave?: boolean } = {}) {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
  const trilha = new RegistradorTrilhaMemoria();
  const cadastro = new PortaCadastroMemoria();
  const cirurgia = new PortaCirurgiaMemoria(
    null,
    (c, ids) => cadastro.lerPacientes(c, ids),
    () => ({ hoje: HOJE, hhmm: '0900' }),
  );
  const anestesia = new PortaAnestesiaMemoria(cirurgia);
  const configuracao = o.semChave
    ? fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== 'bloco.ficha'),
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
        parametrosIniciais: parametrosIniciaisSinteticos,
      })
    : undefined;
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    cadastro,
    cirurgia,
    anestesia,
    ...(configuracao ? { configuracao } : {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  const A = '/api/cirurgia/anestesia';
  return {
    app,
    trilha,
    anestesia,
    cirurgia,
    novaChave: () => `teste-m46-${++seq}-${Date.now()}`,
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
      app.inject({ method: 'GET', url: `${A}${url}`, headers: { cookie: s.cookie } }),
    /** POST com a chave no cabeçalho e no corpo (a mesma). */
    post(s: Sessao, url: string, payload: Record<string, unknown> = {}, chave?: string) {
      const k = chave ?? `teste-m46-${++seq}-${Date.now()}`;
      return app.inject({
        method: 'POST',
        url: `${A}${url}`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': k },
        payload: { chave: k, ...payload },
      });
    },
    fechar: () => app.close(),
  };
}
export type AppAnestesia = Awaited<ReturnType<typeof montarAppAnestesia>>;

/** Os quatro sinais obrigatórios num instante (valores SINTÉTICOS dentro da faixa). */
export const sinais = (momento: string) =>
  [
    ['pas', 120],
    ['pad', 70],
    ['fc', 80],
    ['spo2', 98],
  ].map(([tipo, valor]) => ({ parte: 'sinal', momento, tipo, valor }));
