// Tela "Saúde das conexões" (M04): pools do processo, conexões e transações abertas no banco do cliente e os avisos
// de colisão contados pelo Executor. Núcleo dublê; só contagens, nenhum valor de linha. A "conferência de gravação"
// do sistema de origem (gatilhos e receitas) saiu (ADR 0003): o produto não grava por gatilho.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { esquemaPainelConexoes } from '@sgh/contratos';
import { MetricasExecutor } from '@sgh/nucleo';
import { afterEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { criarFonteGravacao, type NucleoLeitura } from './gravacao.js';
import { registroComConfig } from './modulo-teste.spec-util.js';

const nucleo = (falhar = false): NucleoLeitura => ({
  estadosDosPools: () => [{ banco: 'cliente_teste', ativas: 1, ociosas: 2, total: 3 }],
  async lerSomente(_ctx, fn) {
    if (falhar) throw new Error('banco fora');
    return fn({
      cliente: 'teste',
      async consultar(sql: string) {
        if (sql.includes('INNODB_TRX')) return [{ sistema: 'api', transacoes: 2, longas: 1, esperas: 1 }];
        if (sql.includes('PROCESSLIST')) return [{ sistema: 'api', conexoes: 4 }];
        return [];
      },
      async uma() {
        return null;
      },
    } as never);
  },
});

let app: NestFastifyApplication | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe('fonte da saúde das conexões', () => {
  it('pools, coleta do banco do cliente e colisões do Executor (conflito de versão e trava)', async () => {
    const metricas = new MetricasExecutor();
    metricas.registrar('cadastro.cadastrarPaciente', 'sucesso');
    metricas.registrar('cadastro.cadastrarPaciente', 'conflito-versao');
    metricas.registrar('cadastro.cadastrarPaciente', 'trava');
    metricas.registrar('agenda.marcar', 'sucesso');
    const f = criarFonteGravacao({ cliente: 'teste', rede: 'rede-teste', metricas, nucleo: nucleo() });
    const c = esquemaPainelConexoes.parse(await f.painelConexoes());
    expect(c.pools).toEqual([
      { estabelecimento: 'cliente_teste', abertas: 3, livres: 2, emUso: 1, esperando: 0, sysdbaDev: false },
    ]);
    expect(c.coletas['teste']).toMatchObject({
      porSistema: [{ sistema: 'api', conexoes: 4, transacoes: 2 }],
      transacoesAcimaDoLimite: 1,
      esperasPorTrava: 1,
      alertas: 2,
    });
    expect(c.colisoes).toEqual([
      { operacao: 'cadastro.cadastrarPaciente', estabelecimento: 'teste', porHora: { total: 2 } },
    ]);
  });

  it('sem núcleo ou com o banco fora: a tela abre sem coleta', async () => {
    const semNucleo = criarFonteGravacao({
      cliente: 'teste',
      rede: 'rede-teste',
      metricas: new MetricasExecutor(),
      nucleo: null,
    });
    expect((await semNucleo.painelConexoes()).coletas).toEqual({ teste: null });
    expect((await semNucleo.painelConexoes()).pools).toEqual([]);
    const fora = criarFonteGravacao({
      cliente: 'teste',
      rede: 'rede-teste',
      metricas: new MetricasExecutor(),
      nucleo: nucleo(true),
    });
    await expect(fora.painelConexoes()).resolves.toMatchObject({ coletas: { teste: null } });
  });
});

describe('GET /api/config/conexoes', () => {
  // Exige sessão e a permissão, em qualquer ambiente.
  it('responde com sessão e permissão; fora de dev/ci sem sessão, 401', async () => {
    const dev = { AMBIENTE: 'dev', REDE_PADRAO: 'rede-teste', ESTABELECIMENTOS: '', API_MODULOS: 'config' };
    app = await criarApp(lerConfiguracao(dev), null, dev, { registro: registroComConfig() });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const r = await app.inject({ method: 'GET', url: '/api/config/conexoes' });
    expect(r.statusCode).toBe(200);
    expect(esquemaPainelConexoes.parse(r.json()).pools).toEqual([]);
    // A conferência de gravação do sistema de origem saiu: a rota não existe.
    expect((await app.inject({ method: 'GET', url: '/api/config/gravacao' })).statusCode).toBe(404);
    await app.close();
    // Fora de dev/ci não há sessão sintética: sem cookie, 401.
    const homolog = { AMBIENTE: 'homolog', API_MODULOS: 'config' };
    app = await criarApp(lerConfiguracao(homolog), null, homolog, { registro: registroComConfig() });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    expect((await app.inject({ method: 'GET', url: '/api/config/conexoes' })).statusCode).toBe(401);
    // Sobe a API duas vezes (dev e homolog): com o portão inteiro em paralelo passa dos 5 s padrão.
  }, 30_000);
});
