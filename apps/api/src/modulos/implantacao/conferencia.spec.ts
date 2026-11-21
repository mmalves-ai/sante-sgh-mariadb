// M60 (etapa 2) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a banco): a
// conferência da instalação do estabelecimento ativo, as recusas (sem sessão, sem permissão) e, no serviço, a
// instalação errada em produção (falhas), a codificação fora de utf8mb4, o banco sem o registro das migrações e a
// porta indisponível (503). A app é a migrada (F2.2), com o módulo da implantação registrado pelas opções do teste.
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
import { ServicoConferenciaInstalacao } from './aplicacao/conferencia.js';
import { migracoesDoPacote } from './conferencia.controller.js';
import { modulo } from './modulo.js';
import { type ConexaoBanco, type PortaImplantacao, portaImplantacaoIndisponivel } from './porta.js';

const H = (c: string) => c.repeat(64);
const PACOTE = [
  { numero: 1, hash: H('a') },
  { numero: 600, hash: H('b') },
];
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'implantacao' };
let app: NestFastifyApplication;
const URL_CONF = '/api/administracao/implantacao/conferencia';

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha: new RegistradorTrilhaMemoria(),
    registro: {
      implantacao: async () => ({ modulo: (ctx) => modulo(ctx, { scriptsDoPacote: () => PACOTE }) }),
    },
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
    expect(c.conexao).toMatchObject({ autenticacao: 'ed25519', canalCifrado: true, charsetConexao: 'utf8mb4' });
    expect(c.itens.find((i) => i.codigo === 'motor')?.detalhe).toMatch(/^MariaDB 12\./);
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
const BOA: ConexaoBanco = {
  versaoMotor: '12.3.1-MariaDB',
  charsetBanco: 'utf8mb4',
  charsetConexao: 'utf8mb4',
  autenticacao: 'ed25519',
  canalCifrado: true,
  canalComprimido: false,
  protocolo: 'TCP',
  conta: 'sgh_app',
  papel: 'sgh_aplicacao',
};
const portaCom = (c: Partial<ConexaoBanco>, p: Partial<PortaImplantacao> = {}): PortaImplantacao => ({
  destino: 'banco',
  relogioBanco: () => Promise.resolve(null),
  estrutura: () => Promise.resolve({ resumo: 'a'.repeat(64), tabelas: 1 }),
  conexao: () => Promise.resolve({ ...BOA, ...c }),
  migracoesRegistradas: () => Promise.resolve(PACOTE),
  ...p,
});

describe('M60.2: o serviço da conferência', () => {
  it('instalação errada em produção: root, sem cifra, autenticação antiga, sem papel, migração pendente e versão trocada são falhas', async () => {
    const porta = portaCom(
      { autenticacao: 'mysql_native_password', canalCifrado: false, conta: 'root', papel: null },
      { migracoesRegistradas: () => Promise.resolve([{ numero: 1, hash: H('a') }]) },
    );
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
    expect(c.itens.find((i) => i.codigo === 'canal-cifrado')?.detalhe).toMatch(/TLS/);
  });

  it('a instalação certa: todos os itens ok; motor fora dos homologados é só alerta', async () => {
    const base = { ambiente: 'producao', scriptsDoPacote: () => PACOTE, versao, identificacaoEsperada: null };
    const ok = await new ServicoConferenciaInstalacao({ ...base, porta: portaCom({}) }).conferir(sessao);
    expect(ok.situacao).toBe('ok');
    const antigo = await new ServicoConferenciaInstalacao({
      ...base,
      porta: portaCom({ versaoMotor: '10.6.18-MariaDB' }),
    }).conferir(sessao);
    expect(antigo.itens.find((i) => i.codigo === 'motor')).toMatchObject({ situacao: 'alerta' });
    expect(antigo.situacao).toBe('alerta');
  });

  it('a conta sem o direito de ler o registro das migrações: a conferência segue (item das migrações em falha)', async () => {
    const s = new ServicoConferenciaInstalacao({
      porta: portaCom({ papel: null }, { migracoesRegistradas: () => Promise.reject(new Error('SELECT command denied')) }),
      ambiente: 'producao',
      scriptsDoPacote: () => PACOTE,
      versao,
      identificacaoEsperada: null,
    });
    const c = await s.conferir(sessao);
    expect(c.situacao).toBe('falha');
    expect(c.conexao.conta).toBe('sgh_app');
    expect(c.scripts.registroLido).toBe(false);
    const falhas = c.itens.filter((i) => i.situacao === 'falha').map((i) => i.codigo);
    expect(falhas).toEqual(['papel-aplicacao', 'scripts']);
  });

  it('o banco sem o registro das migrações: alerta com o motivo, nada de pendência inventada', async () => {
    const s = new ServicoConferenciaInstalacao({
      porta: portaCom({}, { migracoesRegistradas: () => Promise.resolve(null) }),
      ambiente: 'producao',
      scriptsDoPacote: () => PACOTE,
      versao,
      identificacaoEsperada: null,
    });
    const c = await s.conferir(sessao);
    expect(c.situacao).toBe('alerta');
    expect(c.scripts).toMatchObject({ registroLido: false, pendentesTotal: 0 });
    expect(c.itens.find((i) => i.codigo === 'scripts')?.detalhe).toMatch(/não registra as migrações/);
  });

  it('a leitura da conexão recusada segue como erro (o banco não respondeu)', async () => {
    const s = new ServicoConferenciaInstalacao({
      porta: portaCom({}, { conexao: () => Promise.reject(new Error('connect ECONNREFUSED')) }),
      ambiente: 'producao',
      scriptsDoPacote: () => PACOTE,
      versao,
      identificacaoEsperada: null,
    });
    await expect(s.conferir(sessao)).rejects.toThrow(/ECONNREFUSED/);
  });

  it('texto fora de utf8mb4 no banco ou na conexão é falha', async () => {
    for (const c of [{ charsetBanco: 'latin1' }, { charsetConexao: 'utf8mb3' }, { charsetConexao: null }]) {
      const r = await new ServicoConferenciaInstalacao({
        porta: portaCom(c),
        ambiente: 'dev',
        scriptsDoPacote: () => PACOTE,
        versao,
        identificacaoEsperada: null,
      }).conferir(sessao);
      expect(r.conexao.charsetParametro).toBe('UTF8');
      expect(r.itens.find((i) => i.codigo === 'charset')?.situacao).toBe('falha');
    }
  });

  it('as migrações do pacote: numeradas pela ordem de db/migracoes, com o SHA-256 de cada arquivo', () => {
    const m = migracoesDoPacote(`${process.cwd().replace(/\/apps\/api$/, '')}/db/migracoes`);
    expect(m.length).toBeGreaterThan(10);
    expect(m[0]?.numero).toBe(1);
    expect(m.every((x) => /^[0-9a-f]{64}$/.test(x.hash))).toBe(true);
    expect(migracoesDoPacote('/caminho/que/nao/existe')).toEqual([]);
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
