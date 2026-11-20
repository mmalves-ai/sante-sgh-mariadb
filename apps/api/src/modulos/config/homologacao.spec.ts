// M36: as telas de coexistência leem o painel da homologação gerado por `pnpm homologacao:roteiro` (só leitura;
// nenhum acesso ao banco). Arquivo ausente ou fora do esquema: null. Só com config.coexistencia.ler: a recepção
// recebe 403 (matriz perfil × permissão).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { caminhoHomologacao, fonteArquivoHomologacao } from './homologacao.js';

const raiz = resolve(import.meta.dirname, '../../../../..');
const tmp = mkdtempSync(join(tmpdir(), 'sgh-api-homologacao-'));
const painel = {
  formato: 1,
  geradoEm: '2026-10-23T00:00:00.000Z',
  versaoRoteiro: '2026-10-23.1',
  hospitais: [
    { codigo: 'pc', bloqueio: null, impressaoHomologada: 'a1b2c3d4e5f60718', impressoesConferidas: {} },
  ],
  producao: 'sem leitura',
  rodadas: [
    {
      onda: 0,
      rotulo: 'Onda 0',
      quem: 'TI',
      porHospital: { pc: { operacoes: 1, verdes: 1, conferidas: 0, comCenarioControlado: 0 } },
    },
  ],
  operacoes: [
    {
      nome: 'acesso.trocarSenha',
      onda: 0,
      santeApi: false,
      origens: { perfil: 1 },
      estados: { pc: 'verde' },
      conferencias: {},
      triggers: { catalogo: ['TRG_TBUSERS_AU'], vistos: null },
    },
  ],
  filaCenarioControlado: [],
  pentest: {
    situacao: 'nao-iniciado',
    abertosCriticosOuAltos: 0,
    porSeveridade: {},
    reteste: null,
    bloqueiaLiberacao: true,
  },
  problemas: [],
};
const arquivo = join(tmp, 'homologacao.json');
writeFileSync(arquivo, JSON.stringify(painel));

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
let app: NestFastifyApplication;
beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { homologacao: fonteArquivoHomologacao(arquivo) });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function entrar(login: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  return (r.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
}

describe('fonte do painel de homologação', () => {
  it('caminho padrão no repositório; SGH_HOMOLOGACAO muda; ausente ou inválido dá null', () => {
    expect(caminhoHomologacao('/r', {})).toBe('/r/docs/homologacao/homologacao.json');
    expect(caminhoHomologacao('/r', { SGH_HOMOLOGACAO: 'x.json' })).toBe('/r/x.json');
    expect(fonteArquivoHomologacao(join(tmp, 'nao-existe.json')).painel()).toBeNull();
    const ruim = join(tmp, 'ruim.json');
    writeFileSync(ruim, '{"formato":2}');
    expect(fonteArquivoHomologacao(ruim).painel()).toBeNull();
  });

  it('o painel versionado do repositório passa no esquema, sem liberada e com o pentest bloqueando', () => {
    const p = fonteArquivoHomologacao(caminhoHomologacao(raiz, {})).painel();
    expect(p).not.toBeNull();
    expect(p?.hospitais.map((h) => h.codigo)).toEqual(['pc', 'hs']);
    expect(p?.operacoes.some((o) => Object.values(o.estados).includes('liberada'))).toBe(false);
    expect(p?.pentest.bloqueiaLiberacao).toBe(true);
    // nenhum valor de linha: só nomes de estrutura, estados e contagens
    expect(JSON.stringify(p)).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}|@[a-z]+\./);
  });
});

describe('GET /api/config/homologacao', () => {
  it('administrador lê o painel; recepção recebe 403', async () => {
    const admin = await entrar('SINT.ADMIN');
    const r = await app.inject({ method: 'GET', url: '/api/config/homologacao', headers: { cookie: admin } });
    expect(r.statusCode).toBe(200);
    expect(r.json().painel.versaoRoteiro).toBe('2026-10-23.1');
    const recepcao = await entrar('SINT.RECEPCAO');
    const n = await app.inject({
      method: 'GET',
      url: '/api/config/homologacao',
      headers: { cookie: recepcao },
    });
    expect(n.statusCode).toBe(403);
  });
});
