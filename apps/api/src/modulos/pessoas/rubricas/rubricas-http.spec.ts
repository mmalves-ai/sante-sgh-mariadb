// M53.2 pela HTTP (D-ABRIR-532), com a sessão real sobre a fonte sintética e a porta das rubricas EM MEMÓRIA (nada
// conecta a banco): cada parte da tela pela permissão da sua opção no outro sistema. Quem só tem os eventos (367) abre o
// apoio e as rubricas, não as tabelas legais; quem só tem a tabela de cálculo (370) abre o apoio e as tabelas legais, não
// as rubricas; quem só consulta a folha mensal (351) abre o apoio (a área) e nada mais; o DP da folha abre tudo.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Module } from '@nestjs/common';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { PORTA_RUBRICAS } from './porta-rubricas.js';
import { PortaRubricasMemoria } from './porta-rubricas-memoria.js';
import { RubricasController } from './rubricas.controller.js';

// O controller das rubricas entra pelo `registro` do criarApp com a porta em memória (o módulo pessoas do registro é
// montado por outro lote).
@Module({})
class ModuloRubricasTeste {}

describe('rubricas pela HTTP', () => {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'pessoas' };
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await criarApp(lerConfiguracao(env), null, env, {
      trilha: new RegistradorTrilhaMemoria(),
      registro: {
        pessoas: async () => ({
          modulo: () => ({
            module: ModuloRubricasTeste,
            controllers: [RubricasController],
            providers: [{ provide: PORTA_RUBRICAS, useValue: new PortaRubricasMemoria() }],
          }),
        }),
      },
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 120_000);
  afterAll(async () => {
    await app.close();
  });

  async function entrar(login: string): Promise<string> {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha: SENHA },
    });
    expect(r.statusCode).toBe(201);
    const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
    return set.map((c) => c.split(';')[0]).join('; ');
  }
  const P = '/api/pessoas/folha';
  const ROTAS = [
    `${P}/rubricas/apoio`,
    `${P}/rubricas?competencia=2026-01`,
    `${P}/tabelas-legais?competencia=2026-01`,
  ] as const;

  async function situacoes(login: string): Promise<number[]> {
    const cookie = await entrar(login);
    const r: number[] = [];
    for (const url of ROTAS)
      r.push((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode);
    return r;
  }

  describe('rubricas e tabelas legais: cada parte pela sua permissão', { timeout: 180_000 }, () => {
    it('apoio, rubricas e tabelas legais por usuário', async () => {
      expect(await situacoes('SINT.DP.FOLHA')).toEqual([200, 200, 200]);
      expect(await situacoes('SINT.FOLHA.EVENTOS')).toEqual([200, 200, 403]);
      expect(await situacoes('SINT.FOLHA.TABELAS')).toEqual([200, 403, 200]);
      expect(await situacoes('SINT.FOLHA.CONSULTA')).toEqual([200, 403, 403]);
    });
    it('o apoio diz as abas: só a tabela de cálculo vê a tabela legal e o cadastro dela', async () => {
      const cookie = await entrar('SINT.FOLHA.TABELAS');
      const a = (await app.inject({ method: 'GET', url: ROTAS[0], headers: { cookie } })).json();
      expect(a.lerRubricas).toBe(false);
      expect(a.tabelaLegal.ler).toBe(true);
      expect(a.cadastros).toEqual(['pessoas.tabelaLegalFolha']);
    });
  });
});
