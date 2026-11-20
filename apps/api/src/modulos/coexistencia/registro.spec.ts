// W0-09 (programa CRUD completo; script 1123; D-RETRO-REGISTRO-F6) pela HTTP, com a sessão real sobre a fonte sintética
// e as portas EM MEMÓRIA: o registro do fim e o da retrocompatibilidade gravados pela tela. Com o modo 'tela' (padrão),
// cada gravação pede a senha de novo e o motivo, valida o esquema do registro, vira versão nova (só inclusão) com a
// linha da trilha e passa a valer no painel sobre o arquivo; `conteudo: null` volta ao arquivo. Com o modo 'excecao',
// a gravação é recusada (409) e a versão gravada não vale.
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PORTA_COEXISTENCIA } from './porta.js';
import { ServicoRegistroCoex } from './aplicacao/registro.js';
import type { PortaCoexistenciaMemoria } from './porta-memoria.js';

const FIXTURES = resolve(import.meta.dirname, '__fixtures__');
const RAIZ_FIM = mkdtempSync(join(tmpdir(), 'w009-fim-'));
cpSync(join(FIXTURES, 'fim'), RAIZ_FIM, { recursive: true });
const RAIZ_RETRO = mkdtempSync(join(tmpdir(), 'w009-retro-'));
cpSync(join(FIXTURES, 'retrocompatibilidade'), RAIZ_RETRO, { recursive: true });
const RAIZ_DESLIG = mkdtempSync(join(tmpdir(), 'w009-deslig-'));
cpSync(join(FIXTURES, 'desligamento'), RAIZ_DESLIG, { recursive: true });
const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  SGH_COEX_FIM: RAIZ_FIM,
  SGH_COEX_DESLIGAMENTO: RAIZ_DESLIG,
  SGH_COEX_RETROCOMPAT: RAIZ_RETRO,
  SGH_TREINAMENTO: resolve(import.meta.dirname, '../../../../../docs/prontidao/treinamento'),
};
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let porta: PortaCoexistenciaMemoria;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  porta = app.get(PORTA_COEXISTENCIA) as PortaCoexistenciaMemoria;
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
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-w009-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: h(s), payload: payload as Record<string, unknown> });
const R = '/api/administracao/coexistencia/registros';
const RETRO = '/api/administracao/coexistencia/retrocompatibilidade';
const MOTIVO = 'Decisão do dono registrada na reunião de hoje';
const MANTIDA = {
  formato: 1,
  estabelecimento: 'aa',
  decisao: { situacao: 'mantida', data: '2026-11-18', referencia: 'ata sintética do comitê' },
  passos: {},
};

describe('W0-09: registro do fim e da retrocompatibilidade pela tela', () => {
  it('modo tela: senha, motivo e esquema; versão nova vale no painel com a trilha; null volta ao arquivo', async () => {
    const s = await entrar('SINT.ONDA5');
    const antes = (await get(s, `${R}/retrocompatibilidade`)).json();
    expect(antes).toMatchObject({ modo: 'tela', fonte: 'arquivo', versaoVigente: null, historico: [] });
    expect((await get(s, RETRO)).json().decisaoRegistrada).toBe('pendente');
    expect(
      (await post(s, `${R}/retrocompatibilidade`, { conteudo: MANTIDA, motivo: MOTIVO })).statusCode,
    ).toBe(401);
    expect((await post(s, `${R}/retrocompatibilidade`, { conteudo: MANTIDA, senha: SENHA })).statusCode).toBe(
      400,
    );
    expect(
      (
        await post(s, `${R}/retrocompatibilidade`, {
          conteudo: { ...MANTIDA, decisao: { situacao: 'inventada' } },
          motivo: MOTIVO,
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(s, `${R}/retrocompatibilidade`, {
          conteudo: { ...MANTIDA, estabelecimento: 'zz' },
          motivo: MOTIVO,
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await post(s, `${R}/inventado`, { conteudo: null, motivo: MOTIVO, senha: SENHA })).statusCode,
    ).toBe(404);
    expect(
      (await post(s, `${R}/retrocompatibilidade`, { conteudo: null, motivo: MOTIVO, senha: SENHA })).json()
        .codigo,
    ).toBe('registro-ja-no-arquivo');

    const nTrilha = trilha.eventos.length;
    const r = await post(s, `${R}/retrocompatibilidade`, { conteudo: MANTIDA, motivo: MOTIVO, senha: SENHA });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      fonte: 'tela',
      versaoVigente: 1,
      historico: [{ versao: 1, motivo: MOTIVO }],
    });
    const t = trilha.eventos.slice(nTrilha).find((x) => x.evento === 'coexistencia.registro.gravado');
    expect(t).toMatchObject({ usuario: 'SINT.ONDA5', tabelaAlvo: 'SGH_CFG_COEX_REGISTRO' });
    expect(t?.chaveNaturalAlvo).toBe('aa:retrocompatibilidade:1');
    expect((await get(s, RETRO)).json()).toMatchObject({
      decisaoRegistrada: 'mantida',
      registroInvalido: null,
    });

    const v = await post(s, `${R}/retrocompatibilidade`, { conteudo: null, motivo: MOTIVO, senha: SENHA });
    expect(v.json()).toMatchObject({
      fonte: 'arquivo',
      versaoVigente: null,
      historico: [
        { versao: 2, retornoAoArquivo: true },
        { versao: 1, retornoAoArquivo: false },
      ],
    });
    expect((await get(s, RETRO)).json().decisaoRegistrada).toBe('pendente');
  });

  it('o registro do fim gravado vale no painel do fim; sem a permissão crítica, 403', async () => {
    const s = await entrar('SINT.ONDA5');
    const fim = {
      formato: 1,
      estabelecimento: 'aa',
      contasCombinadas: [],
      dp6: { previstaPara: '2027-04-01' },
    };
    const r = await post(s, `${R}/fim`, { conteudo: fim, motivo: MOTIVO, senha: SENHA });
    expect(r.statusCode).toBe(200);
    expect(r.json().conteudo).toMatchObject({ estabelecimento: 'aa', dp6: { previstaPara: '2027-04-01' } });
    expect((await get(s, '/api/administracao/coexistencia/migracao/fim')).statusCode).toBe(200);
    const recepcao = await entrar('SINT.RECEPCAO');
    expect(
      (await post(recepcao, `${R}/fim`, { conteudo: null, motivo: MOTIVO, senha: SENHA })).statusCode,
    ).toBe(403);
  });

  it("modo 'excecao' (D-RETRO-REGISTRO-F6): recusa a gravação com 409 e a versão gravada não vale", async () => {
    const servico = new ServicoRegistroCoex(porta, () => Promise.resolve('excecao'));
    const c = { rede: '', hospital: 'aa' };
    expect(await servico.vigente(c, 'fim')).toBeNull();
    const sessao = { porta: c, hospital: 'aa', rede: '', login: 'SINT.ONDA5' } as never;
    const lido = await servico.ler(sessao, 'fim');
    expect(lido).toMatchObject({ modo: 'excecao', fonte: 'arquivo', conteudo: null });
    expect(lido.historico.length).toBeGreaterThan(0);
    await expect(
      servico.gravar(sessao, 'fim', { conteudo: null, motivo: MOTIVO, senha: 'x' }),
    ).rejects.toMatchObject({
      extras: { codigo: 'registro-por-versionado' },
    });
  });
});
