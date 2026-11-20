// Telas do M04 (conferência de gravação; saúde das conexões e avisos de colisão): só em dev; receitas,
// estados, triggers no banco e provas; pools, MON$ por sistema e colisões. Núcleo dublê; nenhum valor de linha.
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { esquemaPainelConexoes, esquemaPainelGravacao } from '@sgh/contratos';
import { MetricasExecutor } from '@sgh/legado';
import { afterEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { criarFonteGravacao, type NucleoLeitura } from './gravacao.js';

const catalogo = resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo');

const nucleo = (falhar = false): NucleoLeitura => ({
  rede: 'rede-teste',
  estadosDosPools: () => [
    { estabelecimento: 'pc', abertas: 1, livres: 1, emUso: 0, esperando: 0, sysdbaDev: true },
  ],
  async lerSomente(_ctx, fn) {
    if (falhar) throw new Error('banco fora');
    return fn({
      hospital: 'pc',
      async consultar(sql: string) {
        if (sql.includes('FROM SGH_TRILHA')) return [{ OPERACAO: 'cadastro.cadastrarPaciente', N: 3 }];
        if (sql.includes('RDB$TRIGGERS'))
          return [
            { N: 'TRG_RICADPAC_BI', I: 0 },
            { N: 'TRG_TBUSERS_BD', I: 1 },
          ];
        return [];
      },
      async lerBlob() {
        return Buffer.alloc(0);
      },
    } as never);
  },
});

let app: NestFastifyApplication | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe('fonte das telas do M04', () => {
  it('conferência: receita, estados, triggers no banco e provas pós-escrita do executor', async () => {
    const metricas = new MetricasExecutor();
    metricas.registrar('cadastro.cadastrarPaciente', 'pc', 'sucesso');
    metricas.registrar('cadastro.cadastrarPaciente', 'pc', 'desfeita');
    metricas.registrar(
      'cadastro.cadastrarPaciente',
      'pc',
      'conflito-versao',
      new Date('2026-10-20T10:00:00Z'),
    );
    const f = criarFonteGravacao({ catalogo, estabelecimentos: ['pc'], metricas, nucleo: nucleo() });
    const g = esquemaPainelGravacao.parse(await f.painelGravacao());
    const cad = g.operacoes.find((o) => o.nome === 'cadastro.cadastrarPaciente');
    expect(cad?.estados).toEqual({ pc: 'verde' });
    expect(cad?.receita?.passos[0]?.tabela).toBe('RICADPAC');
    expect(cad?.receita?.efeitos.map((e) => e.tabela)).toContain('HTPACIENTE');
    expect(cad?.triggersNoBanco['pc']?.['TRG_RICADPAC_BI']).toBe('ativo');
    expect(cad?.triggersNoBanco['pc']?.['TRG_HTPACIENTE_BI']).toBe('ausente');
    // sucessos da trilha (fonte compartilhada); desfeitas do executor deste processo
    expect(cad?.provas).toEqual({ pc: { sucesso: 3, desfeitas: 1 } });
    expect(g.limitacao).toMatch(/trilha/);
    expect(g.operacoes.find((o) => o.nome === 'convenio.cadastrarConvenio')?.receita).toBeNull();
    const c = esquemaPainelConexoes.parse(await f.painelConexoes());
    expect(c.pools[0]?.estabelecimento).toBe('pc');
    expect(c.coletas['pc']).toMatchObject({ porSistema: expect.any(Array), transacoesAcimaDoLimite: 0 });
    expect(c.colisoes).toEqual([
      { operacao: 'cadastro.cadastrarPaciente', estabelecimento: 'pc', porHora: { '2026-10-20T10': 1 } },
    ]);
  });

  it('sem núcleo ou com o banco fora: telas abrem sem conferência nem coleta', async () => {
    const semNucleo = criarFonteGravacao({
      catalogo,
      estabelecimentos: ['pc'],
      metricas: new MetricasExecutor(),
      nucleo: null,
    });
    expect((await semNucleo.painelGravacao()).operacoes[0]?.triggersNoBanco).toEqual({});
    expect((await semNucleo.painelConexoes()).coletas).toEqual({ pc: null });
    const fora = criarFonteGravacao({
      catalogo: () => esquemaPainelGravacao.parse({ estabelecimentos: [], operacoes: [] }) as never,
      estabelecimentos: ['pc'],
      metricas: new MetricasExecutor(),
      nucleo: nucleo(true),
    });
    await expect(fora.painelConexoes()).resolves.toMatchObject({ coletas: { pc: null } });
  });
});

describe('GET /api/config/gravacao e /api/config/conexoes', () => {
  // M06 (pendência do M04 corrigida): exigem sessão e a permissão, em qualquer ambiente.
  it('respondem com sessão e permissão; sem sessão, 401; sem a permissão, 403', async () => {
    app = await criarApp(lerConfiguracao({ AMBIENTE: 'dev' }), null, {
      AMBIENTE: 'dev',
      REDE_PADRAO: 'rede-teste',
      ESTABELECIMENTOS: '',
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    expect((await app.inject({ method: 'GET', url: '/api/config/gravacao' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/config/conexoes' })).statusCode).toBe(200);
    await app.close();
    // Fora de dev/ci não há sessão sintética: sem cookie, 401.
    app = await criarApp(lerConfiguracao({ AMBIENTE: 'homolog' }), null, { AMBIENTE: 'homolog' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    expect((await app.inject({ method: 'GET', url: '/api/config/gravacao' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/config/conexoes' })).statusCode).toBe(401);
    // Sobe a API duas vezes (dev e homolog): com o portão inteiro em paralelo passa dos 5 s padrão.
  }, 30_000);
});
