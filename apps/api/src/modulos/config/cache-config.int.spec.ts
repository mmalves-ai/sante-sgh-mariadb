// Regra 10 do M08: cache de parâmetro e de chave no Valkey real (Compose sgh), invalidado POR EVENTO depois do
// commit — duas instâncias da API sobre o mesmo Valkey: a segunda vê o valor novo definido pela primeira logo
// depois do commit (não espera os 5 min do TTL); o atraso entre o commit e a invalidação é medido. Chaves com
// uma rede de teste única (apagadas no fim); fonte em memória (nada vai à cópia); usuário sintético.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { ArmazemValkey } from '../../sessao/valkey.js';
import { type FonteConfiguracao, fonteConfiguracaoMemoria } from './configuracao-fonte.js';
import { registroComConfig } from './modulo-teste.spec-util.js';

const URL_VALKEY = process.env['VALKEY_URL']?.trim() || 'redis://127.0.0.1:63718';
const REDE = `rede-int-${randomUUID().slice(0, 8)}`;
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', REDE_PADRAO: REDE, API_MODULOS: 'config' };

describe('cache de configuração no Valkey (regra 10)', () => {
  let armazem: ArmazemValkey;
  let a: NestFastifyApplication;
  let b: NestFastifyApplication;
  let configuracao: FonteConfiguracao;
  beforeAll(async () => {
    armazem = new ArmazemValkey(URL_VALKEY);
    const trilha = new RegistradorTrilhaMemoria();
    // A MESMA fonte (o "banco") e o MESMO armazém (Valkey) nas duas instâncias; caches separados por processo não existem.
    configuracao = fonteConfiguracaoMemoria(trilha);
    const registro = registroComConfig({ fonte: configuracao });
    a = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem, registro });
    b = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem, registro });
    for (const x of [a, b]) {
      await x.init();
      await x.getHttpAdapter().getInstance().ready();
    }
  });
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await armazem?.apagar(`sgh:${REDE}:cfg:aa:parametros-novos`);
    await armazem?.apagar(`sgh:${REDE}:cfg:aa:liberacao`);
    await armazem?.apagar(`sgh:${REDE}:cfg:aa:parametros-legado:SINT.ADMIN`);
    await armazem?.encerrar();
  });

  async function entrar(app: NestFastifyApplication) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.ADMIN', senha: SENHA },
    });
    const set = r.headers['set-cookie'] as string[];
    return {
      cookie: set.map((c) => c.split(';')[0]).join('; '),
      csrf:
        set
          .find((c) => c.startsWith('sgh_csrf='))
          ?.split(';')[0]
          ?.slice(9) ?? '',
    };
  }

  it('a definição na instância A invalida o cache que a instância B já tinha; atraso medido', async () => {
    const sa = await entrar(a);
    const sb = await entrar(b);
    const ler = async () =>
      (
        await b.inject({
          method: 'GET',
          url: '/api/administracao/parametros',
          headers: { cookie: sb.cookie },
        })
      )
        .json()
        .novos.find((p: { chave: string }) => p.chave === 'cadastro.itensPorPagina').explicacao.valor;
    expect(await ler()).toBe('25'); // B carrega e põe no Valkey
    expect(await armazem.obter(`sgh:${REDE}:cfg:aa:parametros-novos`)).not.toBeNull();
    const r = await a.inject({
      method: 'PUT',
      url: '/api/administracao/parametros/cadastro.itensPorPagina',
      headers: { cookie: sa.cookie, 'x-csrf': sa.csrf },
      payload: {
        nivel: 'estabelecimento',
        alvo: 'aa',
        valor: '40',
        justificativa: 'teste de integração do cache',
      },
    });
    expect(r.statusCode).toBe(200);
    const atraso = r.json().atrasoInvalidacaoMs as number;
    expect(atraso).toBeLessThan(1000);
    expect(await ler()).toBe('40'); // sem esperar o TTL de 5 min
    console.log(`[cache] invalidação depois do commit: ${atraso} ms (TTL de 300 s não precisou vencer)`);
  });

  it('chave de liberação: o painel de B vê a chave ligada por A logo depois do commit', async () => {
    const sa = await entrar(a);
    const sb = await entrar(b);
    const painel = async () =>
      (await b.inject({ method: 'GET', url: '/api/administracao/liberacao', headers: { cookie: sb.cookie } }))
        .json()
        .funcionalidades.find((f: { chave: string }) => f.chave === 'licitacao');
    expect((await painel()).ligadaNoEstabelecimento).toBe(false);
    // POL-3: a licitação só liga com a aprovação conjunta registrada (cumprida, com a evidência).
    await configuracao.gravarPrerequisito(
      REDE,
      {
        hospital: 'aa',
        recurso: 'licitacao',
        tipo: 'aprovacao',
        situacao: 'cumprido',
        validade: null,
        evidencia: 'ata sintética do teste de integração',
        autor: 'SINT.ADMIN',
      },
      {
        rede: REDE,
        hospital: 'aa',
        usuario: 'SINT.ADMIN',
        evento: 'config.prerequisito.registrado',
        recurso: 'config.prerequisito',
        operacao: 'config.gravarPrerequisito',
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: 'TESTE:127.0.0.1',
        correlacao: 'teste-cache-config',
      },
    );
    const r = await a.inject({
      method: 'POST',
      url: '/api/administracao/liberacao',
      headers: { cookie: sa.cookie, 'x-csrf': sa.csrf },
      payload: {
        chave: 'licitacao',
        tipo: 'recurso',
        escopo: 'hospital',
        valores: ['*'],
        ligar: true,
        justificativa: 'teste de integração do cache',
        senha: SENHA,
      },
    });
    expect(r.statusCode).toBe(200);
    expect((await painel()).ligadaNoEstabelecimento).toBe(true);
  });
});
