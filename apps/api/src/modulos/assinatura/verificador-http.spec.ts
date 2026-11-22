// M49, etapa 3 (correção): o verificador público pela API inteira (app.inject), atrás do proxy. A API confia só no
// salto do loopback (confiarNoProxy): o req.ip é o endereço que o proxy pôs no X-Forwarded-For, então o limite de
// taxa vale por visitante (não um limite único para todos) e a origem gravada é a do visitante, mascarada. Um
// endereço que o próprio cliente escreve antes no cabeçalho não é aceito. Endereços de documentação (RFC 5737/3849).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { confiarNoProxy, criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste } from '../../sessao/teste.spec-util.js';
import { modulo } from './modulo.js';
import { PortaAssinaturaMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'assinatura' };
const CODIGO = 'NaoExisteNenhum_0123456789';
let app: NestFastifyApplication;
let porta: PortaAssinaturaMemoria;

beforeAll(async () => {
  porta = new PortaAssinaturaMemoria();
  app = await criarApp(lerConfiguracao(env), null, env, {
    registro: {
      assinatura: async () => ({ modulo: (ctx) => modulo(ctx, { porta, estabelecimentos: ['pc'] }) }),
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

const consultar = (xff: string) =>
  app.inject({
    method: 'GET',
    url: `/api/publico/verificar/${CODIGO}`,
    headers: { 'x-forwarded-for': xff },
  });

describe('verificador público atrás do proxy', () => {
  it('confia só no salto 0 vindo do loopback', () => {
    expect(confiarNoProxy('127.0.0.1', 0)).toBe(true);
    expect(confiarNoProxy('::1', 0)).toBe(true);
    expect(confiarNoProxy('::ffff:127.0.0.1', 0)).toBe(true);
    expect(confiarNoProxy('127.0.0.1', 1)).toBe(false);
    expect(confiarNoProxy('203.0.113.1', 0)).toBe(false);
  });

  it('limite por visitante (X-Forwarded-For do proxy) e a origem mascarada certa na linha', async () => {
    for (let i = 0; i < 20; i++) expect((await consultar('203.0.113.77')).statusCode).toBe(200);
    expect((await consultar('203.0.113.77')).statusCode).toBe(429);
    // Outro visitante segue consultando: o limite não é um só para todos.
    const outro = await consultar('198.51.100.5');
    expect(outro.statusCode).toBe(200);
    expect(outro.json()).toMatchObject({ situacao: 'nao-encontrado' });
    const origens = new Set(porta.verificacoes.map((v) => v.origemMascarada));
    expect(origens).toEqual(new Set(['203.0.113.0', '198.51.100.0']));
    expect(porta.trilhas.at(-1)?.estacao).toBe('PUBLICO:198.51.100.0');
    expect(JSON.stringify(porta.verificacoes)).not.toContain('127.0.0');
  });

  it('o endereço escrito pelo cliente antes do do proxy não conta (vale o último, o que o proxy viu)', async () => {
    // O visitante já barrado tenta se passar por outro: o proxy acrescenta o endereço real no fim.
    expect((await consultar('192.0.2.200, 203.0.113.77')).statusCode).toBe(429);
  });
});
