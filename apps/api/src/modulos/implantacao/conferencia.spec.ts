// M60 (etapa 2) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a banco): a
// conferência da instalação do estabelecimento ativo, as recusas (sem sessão, sem permissão) e, no serviço, a
// instalação errada em produção (falhas), o parâmetro de codificação desencontrado e a porta indisponível (503).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  esquemaConferenciaInstalacao,
  ITENS_CONFERENCIA_INSTALACAO,
  ROTA_SONDA_INSTALACAO,
} from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { FonteConfiguracao } from '../config/public-api.js';
import { ServicoConferenciaInstalacao } from './aplicacao/conferencia.js';
import { portaImplantacaoIndisponivel } from './porta-legado.js';
import type { PortaImplantacao } from './porta.js';

const H = (c: string) => c.repeat(64);
const PACOTE = [
  { numero: 1, hash: H('a') },
  { numero: 600, hash: H('b') },
];
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
let app: NestFastifyApplication;
const URL_CONF = '/api/administracao/implantacao/conferencia';

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha: new RegistradorTrilhaMemoria(),
    scriptsDoPacote: () => PACOTE,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
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

describe('M60.2: conferência da instalação pela HTTP', { timeout: 60_000 }, () => {
  it('o administrador vê a instalação sintética correta: todos os itens ok e os scripts do pacote aplicados', async () => {
    const r = await app.inject({
      method: 'GET',
      url: URL_CONF,
      headers: { cookie: await entrar('SINT.ADMIN') },
    });
    expect(r.statusCode).toBe(200);
    const c = esquemaConferenciaInstalacao.parse(r.json());
    expect(c.hospital).toBe('aa');
    expect(c.ambiente).toBe('dev');
    expect(c.itens.map((i) => i.codigo)).toEqual([...ITENS_CONFERENCIA_INSTALACAO]);
    expect(c.situacao).toBe('ok');
    expect(c.scripts).toMatchObject({ noPacote: 2, aplicados: 2, ultimoNoPacote: '0600', pendentesTotal: 0 });
    expect(c.conexao).toMatchObject({ autenticacao: 'Srp256', canalCifrado: true, charsetConexao: 'NONE' });
    // Nada de senha nem endereço na resposta.
    expect(r.body).not.toMatch(/senha|password|127\.0\.0\.1/i);
  });

  it('sonda da instalação: sem o segredo é 404; com ele, a mesma conferência sem sessão; estabelecimento desconhecido é 400', async () => {
    const antes = { t: process.env['SONDA_TOKEN'], e: process.env['ESTABELECIMENTOS'] };
    process.env['SONDA_TOKEN'] = 's'.repeat(40);
    process.env['ESTABELECIMENTOS'] = 'aa';
    try {
      expect((await app.inject({ method: 'GET', url: ROTA_SONDA_INSTALACAO })).statusCode).toBe(404);
      const errado = { 'x-sonda-token': 'x'.repeat(40) };
      expect(
        (await app.inject({ method: 'GET', url: ROTA_SONDA_INSTALACAO, headers: errado })).statusCode,
      ).toBe(404);
      const certo = { 'x-sonda-token': 's'.repeat(40) };
      const r = await app.inject({ method: 'GET', url: ROTA_SONDA_INSTALACAO, headers: certo });
      expect(r.statusCode).toBe(200);
      const c = esquemaConferenciaInstalacao.parse(r.json());
      expect(c).toMatchObject({ hospital: 'aa', situacao: 'ok' });
      expect(r.body).not.toMatch(/senha|password|127\.0\.0\.1/i);
      const outro = await app.inject({
        method: 'GET',
        url: `${ROTA_SONDA_INSTALACAO}?hospital=zz`,
        headers: certo,
      });
      expect(outro.statusCode).toBe(400);
    } finally {
      for (const [k, v] of [
        ['SONDA_TOKEN', antes.t],
        ['ESTABELECIMENTOS', antes.e],
      ] as const)
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
  });

  it('sem a permissão dos painéis de saúde é 403', async () => {
    const r = await app.inject({
      method: 'GET',
      url: URL_CONF,
      headers: { cookie: await entrar('SINT.LEITOS') },
    });
    expect(r.statusCode).toBe(403);
  });
});

const sessao = { rede: 'r', hospital: 'pc' } as unknown as SessaoCadastro;
const versao = () => ({
  produto: 'Produto',
  versao: '0.1.0',
  commit: 'abcdef1',
  construidoEm: '2026-10-27T00:00:00.000Z',
  identificacao: '0.1.0+abcdef1',
});

describe('M60.2: o serviço da conferência', () => {
  it('instalação errada em produção: SYSDBA, sem cifra, sem papel, script pendente e versão trocada são falhas', async () => {
    const porta: PortaImplantacao = {
      destino: 'legado',
      relogioBanco: () => Promise.resolve(null),
      conexao: () =>
        Promise.resolve({
          versaoMotor: '3.0.14',
          charsetBanco: 'NONE',
          charsetConexaoId: 0,
          autenticacao: 'Legacy_Auth',
          canalCifrado: false,
          canalComprimido: null,
          protocolo: 'TCPv4',
          conta: 'SYSDBA',
          papel: null,
        }),
      scriptsRegistrados: () => Promise.resolve([{ numero: 1, hash: H('a') }]),
    };
    const s = new ServicoConferenciaInstalacao({
      porta,
      ambiente: 'producao',
      scriptsDoPacote: () => PACOTE,
      versao,
      identificacaoEsperada: '0.2.0+fedcba9',
      agora: () => Date.parse('2026-10-27T12:00:00Z'),
    });
    const c = await s.conferir(sessao);
    expect(c.situacao).toBe('falha');
    expect(c.em).toBe('2026-10-27T12:00:00.000Z');
    const falhas = c.itens.filter((i) => i.situacao === 'falha').map((i) => i.codigo);
    expect(falhas).toEqual([
      'autenticacao',
      'canal-cifrado',
      'conta-propria',
      'papel-aplicacao',
      'scripts',
      'versao',
    ]);
    expect(c.scripts.pendentes).toEqual(['0600']);
  });

  it('a conta sem o papel: o registro dos scripts recusado não derruba a conferência (item dos scripts e do papel em falha)', async () => {
    const porta: PortaImplantacao = {
      destino: 'legado',
      relogioBanco: () => Promise.resolve(null),
      conexao: () =>
        Promise.resolve({
          versaoMotor: '3.0.14',
          charsetBanco: 'NONE',
          charsetConexaoId: 0,
          autenticacao: 'Srp256',
          canalCifrado: true,
          canalComprimido: null,
          protocolo: 'TCPv4',
          conta: 'SGH_APP',
          papel: null,
        }),
      scriptsRegistrados: () => Promise.reject(new Error('no permission for SELECT access to TABLE')),
    };
    for (const registrados of [porta.scriptsRegistrados, () => Promise.resolve(null)]) {
      const s = new ServicoConferenciaInstalacao({
        porta: { ...porta, scriptsRegistrados: registrados },
        ambiente: 'producao',
        scriptsDoPacote: () => PACOTE,
        versao,
        identificacaoEsperada: null,
      });
      const c = await s.conferir(sessao);
      expect(c.situacao).toBe('falha');
      expect(c.conexao.conta).toBe('SGH_APP');
      expect(c.scripts.registroLido).toBe(false);
      const falhas = c.itens.filter((i) => i.situacao === 'falha').map((i) => i.codigo);
      expect(falhas).toEqual(['papel-aplicacao', 'scripts']);
      expect(c.itens.find((i) => i.codigo === 'scripts')?.detalhe).toMatch(/conceda o papel/);
    }
  });

  it('a leitura da conexão recusada segue como erro (o banco não respondeu)', async () => {
    const s = new ServicoConferenciaInstalacao({
      porta: {
        destino: 'legado',
        relogioBanco: () => Promise.resolve(null),
        conexao: () => Promise.reject(new Error('Unable to complete network request')),
        scriptsRegistrados: () => Promise.resolve([]),
      },
      ambiente: 'producao',
      scriptsDoPacote: () => PACOTE,
      versao,
      identificacaoEsperada: null,
    });
    await expect(s.conferir(sessao)).rejects.toThrow(/network/);
  });

  it('o parâmetro de codificação em UTF8 sobre um banco NONE é falha (a fonte de configuração decide)', async () => {
    const porta: PortaImplantacao = {
      destino: 'memoria',
      relogioBanco: () => Promise.resolve(null),
      conexao: () =>
        Promise.resolve({
          versaoMotor: '3.0.14',
          charsetBanco: 'NONE',
          charsetConexaoId: 99,
          autenticacao: 'Srp',
          canalCifrado: true,
          canalComprimido: true,
          protocolo: 'TCPv4',
          conta: 'SGH_APP',
          papel: 'SGH_APLICACAO',
        }),
      scriptsRegistrados: () => Promise.resolve(PACOTE),
    };
    const fonte = {
      valoresParametro: () =>
        Promise.resolve([
          {
            id: '1',
            chave: 'legado.charset',
            nivel: 'estabelecimento',
            alvo: 'pc',
            valor: 'UTF8',
            vigenteDesde: '2026-01-01',
            vigenteAte: null,
            justificativa: 'teste',
            autor: 'teste',
          },
        ]),
    } as unknown as FonteConfiguracao;
    const s = new ServicoConferenciaInstalacao({
      porta,
      ambiente: 'dev',
      scriptsDoPacote: () => PACOTE,
      versao,
      identificacaoEsperada: null,
      configuracao: fonte,
    });
    const c = await s.conferir(sessao);
    expect(c.conexao.charsetParametro).toBe('UTF8');
    expect(c.conexao.charsetConexao).toBe('id 99');
    expect(c.itens.find((i) => i.codigo === 'charset')?.situacao).toBe('falha');
  });

  it('sem o banco configurado a porta recusa com 503 (falha fechada)', async () => {
    const erro = await portaImplantacaoIndisponivel()
      .conexao({ rede: 'r', hospital: 'pc' })
      .then(
        () => null,
        (e: unknown) => e as { getStatus(): number },
      );
    expect(erro?.getStatus()).toBe(503);
  });
});
