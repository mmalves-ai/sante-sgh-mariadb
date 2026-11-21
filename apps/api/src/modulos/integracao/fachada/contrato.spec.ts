// M58-F4 (ficha, regra 8): verificação do provedor no estilo Pact. O consumidor (os Squads da Hal-AI) espera, em cada
// operação servida pela fachada, a forma da resposta de exemplo da especificação OpenAPI da versão 0.23.0 da API
// original (fachada-contrato.json); aqui cada operação servida é chamada pela HTTP (porta EM MEMÓRIA, sessão real
// sobre a fonte sintética) e a resposta é conferida contra essa forma: 0 contrato quebrado. Inclui o 404 do convênio
// e o 503 da saúde do banco quando a fachada responde por ele. As 71 operações não servidas vão à API original pelo
// repasse (o contrato delas é o da própria API original).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { CATALOGO_FACHADA, CONTRATO_SANTE_API, type FormaRespostaFachada } from '@sgh/contratos';
import { quebrasDeContrato, recortarForma } from '@sgh/dominio-integracao';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { moduloIntegracao } from '../modulo.js';
import { PortaFachadaMemoria } from './porta-memoria.js';

const TOKEN = 't'.repeat(40);
const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  FACHADA_API_TOKEN: TOKEN,
  API_MODULOS: 'integracao',
};
const trilha = new RegistradorTrilhaMemoria();
const porta = new PortaFachadaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: { integracao: async () => ({ modulo: (ctx) => moduloIntegracao(ctx, { fachada: porta }) }) },
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
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const configurar = (s: Sessao, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: '/api/administracao/integracoes/fachada/configuracao',
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      'idempotency-key': `teste-m58f4-${++chave}-${Date.now()}`,
    },
    payload: payload as Record<string, unknown>,
  });
const F = '/api/fachada/sante-api/aa';
const fachada = (method: 'GET' | 'POST', url: string, payload?: unknown, token: string | null = TOKEN) =>
  app.inject({
    method,
    url: `${F}${url}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

const forma = (id: string, status: string): FormaRespostaFachada => {
  const [metodo, caminho] = id.split(' ');
  const f = CONTRATO_SANTE_API.operacoes.find((o) => o.metodo === metodo && o.caminho === caminho)?.respostas[
    status
  ];
  if (f === undefined) throw new Error(`sem exemplo ${status} para ${id}`);
  return f;
};

describe('contrato da fachada (verificação do provedor)', { timeout: 120_000 }, () => {
  it('cada operação servida responde na forma do contrato da API original: 0 quebra', async () => {
    const s = await entrar('SINT.ONDA5');
    for (const chave of ['integracao.fachada.ligada', 'integracao.fachada.escrita'])
      expect(
        (await configurar(s, { chave, valor: 'sim', justificativa: 'verificação do contrato', senha: SENHA }))
          .statusCode,
      ).toBe(200);

    const proposta = await fachada('POST', '/acoes/convenios/situacao', {
      convenio: 20,
      operacao: 'suspender',
    });
    const { propostaId } = proposta.json() as { propostaId: string };
    const confirmada = await fachada('POST', '/acoes/confirmar', { propostaId });
    // O exemplo da confirmação na especificação é de outra ação: confere-se o envelope comum a toda confirmação.
    const envelopeConfirmacao = recortarForma(forma('POST /acoes/confirmar', '200'), [
      'propostaId',
      'acao',
      'aplicada',
      'aplicadaEm',
      'convenio',
    ]);
    const casos: {
      id: string;
      esperado: number;
      status: number;
      corpo: unknown;
      esperada: FormaRespostaFachada;
    }[] = [];
    const caso = (
      id: string,
      r: Awaited<ReturnType<typeof fachada>>,
      status = 200,
      f?: FormaRespostaFachada,
    ) =>
      casos.push({
        id,
        esperado: status,
        status: r.statusCode,
        corpo: r.json(),
        esperada: f ?? forma(id, String(status)),
      });
    caso('GET /health', await fachada('GET', '/health', undefined, null));
    caso('GET /health/db', await fachada('GET', '/health/db'));
    caso('GET /convenios', await fachada('GET', '/convenios?q=sintetico&limite=10'));
    caso('GET /convenios/{codigo}', await fachada('GET', '/convenios/10'));
    caso('GET /convenios/{codigo}', await fachada('GET', '/convenios/999'), 404);
    caso('GET /acoes/status', await fachada('GET', '/acoes/status'));
    caso('POST /acoes/convenios/situacao', proposta);
    caso('POST /acoes/confirmar', confirmada, 200, envelopeConfirmacao);

    // Toda operação servida tem ao menos um caso; nenhum caso quebra o contrato.
    const servidas = CATALOGO_FACHADA.filter((o) => o.servidaPeloSante).map((o) => o.id);
    expect(new Set(casos.map((c) => c.id))).toEqual(new Set(servidas));
    const quebras = casos.flatMap((c) => {
      return [
        ...(c.status === c.esperado ? [] : [`${c.id}: status ${c.status}, esperado ${c.esperado}`]),
        ...quebrasDeContrato(c.esperada, c.corpo).map((q) => `${c.id}: ${q}`),
      ];
    });
    expect(quebras).toEqual([]);
  });
});
