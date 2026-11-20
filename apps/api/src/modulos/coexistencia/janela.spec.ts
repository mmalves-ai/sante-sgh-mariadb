// M58-F5 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): a janela
// de cada passo (roteiro com os tempos do ensaio, verificação do ensaio do roteiro, retirada restrita), a permissão de
// leitura e a recusa de ligar `entrada.utf8` pela tela de funcionalidades antes da conversão verificada (regra 6).
// E, sem HTTP, o leitor do janela.json (falha fechada) e a montagem com o UTF-8 executado e verificado na produção.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  esquemaRegistroDesligamento,
  esquemaVerificacaoJanela,
  type VerificacaoJanela,
} from '@sgh/contratos';
import { relatorioEnsaioVazio } from '@sgh/dominio-config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { fraseRetirada, lerRelatorioJanela, montarPainelJanela } from './aplicacao/janela.js';

const FIXTURES = resolve(import.meta.dirname, '__fixtures__');
const RAIZ_FIM = mkdtempSync(join(tmpdir(), 'm58j-fim-'));
cpSync(join(FIXTURES, 'fim'), RAIZ_FIM, { recursive: true });
const RAIZ_DESLIG = mkdtempSync(join(tmpdir(), 'm58j-deslig-'));
cpSync(join(FIXTURES, 'desligamento'), RAIZ_DESLIG, { recursive: true });
const RAIZ_ENSAIOS = mkdtempSync(join(tmpdir(), 'm58j-ensaios-'));
const F5 = relatorioEnsaioVazio(
  'aa',
  '2026-10-26',
  { versaoMotor: '3.0.14', ods: '12.0' },
  { versaoMotor: '5.0.3', ods: '13.1' },
);
F5.etapas.backup = { ...F5.etapas.backup, situacao: 'aprovada', segundos: 1800, bytes: 10 };
F5.etapas.restauracao = { ...F5.etapas.restauracao, situacao: 'aprovada', segundos: 1200 };
F5.etapas['volta-atras'] = { ...F5.etapas['volta-atras'], situacao: 'aprovada', segundos: 600 };
mkdirSync(join(RAIZ_ENSAIOS, 'aa'));
writeFileSync(join(RAIZ_ENSAIOS, 'aa', 'firebird5.json'), JSON.stringify(F5));

const H = 'd'.repeat(64);
const verificacao = (over: Partial<VerificacaoJanela> = {}): VerificacaoJanela =>
  esquemaVerificacaoJanela.parse({
    passo: 'firebird5',
    ambiente: 'ensaio',
    em: '2026-10-29T06:00:00.000Z',
    papel: 'coordenacao',
    plataforma: { versaoMotor: '5.0.3', charsetBanco: 'NONE', charsetParametro: 'CP1252' },
    schema: { esperada: '0123456789abcdef', obtida: '0123456789abcdef', diferencas: 0 },
    contagens: { tabelas: 2, iguais: 2, diferentes: [], ausentes: [], hashAntes: H, hashDepois: H },
    saude: { conectou: true, latenciaMs: 9, codecConfere: true },
    operacoes: { total: 2, verdes: 2, falhas: [] },
    ...over,
  });
writeFileSync(
  join(RAIZ_ENSAIOS, 'aa', 'janela.json'),
  JSON.stringify({ formato: 1, estabelecimento: 'aa', verificacoes: [verificacao()] }),
);

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  SGH_COEX_FIM: RAIZ_FIM,
  SGH_COEX_DESLIGAMENTO: RAIZ_DESLIG,
  SGH_M58_ENSAIOS: RAIZ_ENSAIOS,
};
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
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
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste-m58j-${++chave}-${Date.now()}` },
    payload: payload as Record<string, unknown>,
  });
const J = '/api/administracao/coexistencia/desligamento/janela';

describe('janela em produção pela HTTP (M58-F5)', { timeout: 60_000 }, () => {
  it('roteiro dos três passos com os tempos do ensaio, o ensaio do roteiro e a retirada restrita', async () => {
    const s = await entrar('SINT.ONDA5');
    const r = await get(s, J);
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.hospital).toBe('aa');
    expect(p.relatorio).toBe('docs/marcos/M58/aa/janela.json');
    expect(p.relatorioInvalido).toBeNull();
    expect(p.passos.map((x: { passo: string }) => x.passo)).toEqual(['desligamento', 'firebird5', 'utf8']);
    const f5 = p.passos[1];
    // backup 45 + restauração 30 min (com a margem), em blocos de 15: 75.
    expect(f5.janelaMinutos).toBe(75);
    expect(f5.voltaAtrasMinutos).toBe(15);
    expect(f5.roteiro[0]).toMatchObject({ etapa: 'confirmar-autorizacao', ordem: 1, responsavel: 'dono' });
    expect(f5.ensaio).toMatchObject({ ambiente: 'ensaio', aprovada: true });
    expect(f5.producao).toBeNull();
    expect(f5).toMatchObject({ autorizado: false, executado: false, ensaioAprovado: false });
    // Sem a conversão (F3), o roteiro do UTF-8 sai sem estimativa.
    expect(p.passos[2].janelaMinutos).toBeNull();
    expect(p.retirada.chave).toBe('entrada.utf8');
    expect(p.retirada.situacao).toBe('restrita');
    expect(p.retirada.motivos).toEqual(
      expect.arrayContaining(['utf8-nao-executado', 'verificacao-ausente', 'parametro-nao-utf8']),
    );
  });

  it('sem config.coexistencia.ler: 403', async () => {
    const r = await entrar('SINT.RECEPCAO');
    expect((await get(r, J)).statusCode).toBe(403);
  });

  it('ligar a entrada sem restrição antes da conversão verificada: 409 com o que falta; desligar segue', async () => {
    const s = await entrar('SINT.ADMIN');
    const pedido = (ligar: boolean) => ({
      chave: 'entrada.utf8',
      tipo: 'recurso',
      escopo: 'hospital',
      valores: ['*'],
      ligar,
      justificativa: 'Retirar a restrição de entrada (teste do M58-F5)',
      senha: SENHA,
    });
    const r = await post(s, '/api/administracao/liberacao', pedido(true));
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ codigo: 'entrada-utf8-sem-conversao' });
    expect(r.json().detail).toContain('ainda não foi executada');
    expect(r.json().detail).not.toMatch(/entrada\.utf8|legado\.charset/);
    const lista = (await get(s, '/api/administracao/liberacao')).json();
    const f = lista.funcionalidades.find((x: { chave: string }) => x.chave === 'entrada.utf8');
    expect(f).toMatchObject({ podeLigar: false });
    expect(f.motivoBloqueio).toContain('conversão verificada');
    expect([200, 409]).toContain((await post(s, '/api/administracao/liberacao', pedido(false))).statusCode);
  });
});

describe('janela sem HTTP (falha fechada e o caminho liberado)', () => {
  it('janela.json ausente, de outro estabelecimento, fora do esquema ou ilegível', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'm58j-rel-'));
    expect(lerRelatorioJanela(null, 'pc').invalido).toBe('pasta dos ensaios não configurada');
    expect(lerRelatorioJanela(raiz, 'pc').invalido).toBe('nenhuma verificação registrada');
    mkdirSync(join(raiz, 'pc'));
    const p = join(raiz, 'pc', 'janela.json');
    writeFileSync(p, JSON.stringify({ formato: 1, estabelecimento: 'hs', verificacoes: [] }));
    expect(lerRelatorioJanela(raiz, 'pc').invalido).toBe('relatório de outro estabelecimento');
    writeFileSync(p, JSON.stringify({ formato: 2, estabelecimento: 'pc', verificacoes: [] }));
    expect(lerRelatorioJanela(raiz, 'pc').invalido).toContain('fora do esquema');
    writeFileSync(p, '{');
    expect(lerRelatorioJanela(raiz, 'pc').invalido).toBe('relatório ilegível');
  });

  it('UTF-8 autorizado, executado e verificado na produção, banco e parâmetro em UTF-8: pode retirar', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'm58j-ok-'));
    mkdirSync(join(raiz, 'pc'));
    const prod = verificacao({
      passo: 'utf8',
      ambiente: 'producao',
      papel: 'ti',
      inicio: '2026-12-01T01:00:00.000Z',
      fim: '2026-12-01T05:00:00.000Z',
      plataforma: { versaoMotor: '5.0.3', charsetBanco: 'UTF8', charsetParametro: 'UTF8' },
    });
    writeFileSync(
      join(raiz, 'pc', 'janela.json'),
      JSON.stringify({ formato: 1, estabelecimento: 'pc', verificacoes: [prod] }),
    );
    const ref = { data: '2026-11-30', referencia: 'ESTADO.md, autorizações' };
    const registro = esquemaRegistroDesligamento.parse({
      formato: 1,
      estabelecimento: 'pc',
      passos: {
        utf8: {
          autorizacao: ref,
          ensaio: { data: '2026-11-01', relatorio: 'utf8.md', resultado: 'aprovado' },
          execucao: { data: '2026-12-01', referencia: 'janela.md' },
        },
      },
    });
    const base = {
      hospital: 'pc',
      em: new Date('2026-12-01T06:00:00Z'),
      raizEnsaios: raiz,
      registro,
      registroInvalido: null,
      charsetBanco: 'UTF8',
      charsetParametro: 'UTF8' as const,
      chaveLigada: false,
    };
    const p = montarPainelJanela(base);
    expect(p.passos[2]?.producao).toMatchObject({ aprovada: true, duracaoMinutos: 240 });
    expect(p.retirada).toMatchObject({ situacao: 'pode-retirar', motivos: [] });
    expect(montarPainelJanela({ ...base, chaveLigada: true }).retirada.situacao).toBe('retirada');
    expect(fraseRetirada(p.retirada.motivos)).toBeNull();
    expect(montarPainelJanela({ ...base, charsetParametro: 'CP1252' }).retirada.motivos).toEqual([
      'parametro-nao-utf8',
    ]);
  });
});
