import { esquemaSaude, esquemaVersao } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { criarApp } from './app.js';
import { lerConfiguracao } from './configuracao.js';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao({ PRODUTO_NOME: 'Produto de teste', AMBIENTE: 'ci' }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

describe('rotas públicas do M00', () => {
  it('GET /api/saude responde ok', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/saude' });
    expect(r.statusCode).toBe(200);
    expect(esquemaSaude.parse(r.json()).status).toBe('ok');
  });

  it('GET /api/versao devolve o nome configurado e a versão', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/versao' });
    expect(r.statusCode).toBe(200);
    const v = esquemaVersao.parse(r.json());
    expect(v.produto).toBe('Produto de teste');
    expect(v.identificacao.startsWith(v.versao)).toBe(true);
  });
});

describe('configuração', () => {
  it('sem PRODUTO_NOME usa nome técnico neutro, nunca uma marca', () => {
    expect(lerConfiguracao({}).produtoNome).toBe('SGH');
  });
});
