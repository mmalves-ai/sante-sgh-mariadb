// M38 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco), os módulos
// config e cadastro registrados:
// - GET /api/onda0/telas: a situação das telas da onda para a sessão; a chave desligada para a pessoa a deixa fora do
//   escopo (regra 3);
// - o grupo da pessoa vai na sessão e conta no escopo `grupo` das chaves;
// - GET /api/sistema/sonda: 404 sem o segredo; com ele, as cinco sondas (o painel de leitos só com o módulo da
//   internação montado).
// A vigilância diária das assinaturas e a matriz de convivência saíram (ADR 0003).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ESCRITAS_TELAS_ONDA_0,
  MOTIVO_FORA_DO_ESCOPO_ONDA_0,
} from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { catalogoOperacoesProprio } from './catalogo-operacoes.js';
import { fonteConfiguracaoMemoria } from './configuracao-fonte.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { portaOnda0Memoria } from './onda0.js';

// Segredo sintético do teste (montado na hora; nunca um segredo real).
const TOKEN = ['sonda', 'sintetica', 'x'.repeat(32)].join('-');
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'config,cadastro' };
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  process.env['SONDA_TOKEN'] = TOKEN;
  process.env['SONDA_LOGIN'] = 'SINT.SONDA';
  process.env['SONDA_SENHA'] = SENHA;
  app = await criarApp(lerConfiguracao(env), null, env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  delete process.env['SONDA_TOKEN'];
  delete process.env['SONDA_LOGIN'];
  delete process.env['SONDA_SENHA'];
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

describe('onda 0: situação das telas', { timeout: 30_000 }, () => {
  it('todas as telas da onda com a chave; ligadas na sessão sintética; o grupo da pessoa vai na sessão', async () => {
    const s = await entrar('SINT.LEITOS');
    const sessao = (await get(s, '/api/sessao')).json();
    expect(sessao.grupoLegado).toBe('LEITOS');
    const r = await get(s, '/api/onda0/telas');
    expect(r.statusCode).toBe(200);
    const t = r.json();
    expect(t.hospital).toBe('aa');
    expect(t.telas).toHaveLength(13);
    const por = Object.fromEntries(t.telas.map((x: { id: string }) => [x.id, x]));
    expect(por['leitos']).toMatchObject({ situacao: 'ligada', escritaLiberada: null });
    expect(por['pacientes']).toMatchObject({ situacao: 'ligada', recurso: 'cadastro.paciente.consulta' });
    // dev/ci: as operações verdes gravam (fora de produção); a faixa "só consulta" não aparece.
    expect(por['pacientes'].escritaLiberada).toBe(true);
    expect(por['busca-global'].situacao).toBe('sem-chave');
  });

  it('revisão da D-PROF-39: Profissionais com a escrita liberada (as 12 gravações da tela existem no catálogo de operações)', async () => {
    const s = await entrar('SINT.ADMIN');
    const t = (await get(s, '/api/onda0/telas')).json();
    const prof = t.telas.find((x: { id: string }) => x.id === 'profissionais');
    expect(prof.escritaLiberada).toBe(true);
    // Toda operação listada para a tela existe no catálogo do executor (nome trocado faria a faixa voltar).
    const ops = ESCRITAS_TELAS_ONDA_0['profissionais'] ?? [];
    expect(ops.length).toBe(12);
    const catalogo = catalogoOperacoesProprio();
    for (const op of ops) expect(catalogo.estado(op, 'aa'), op).not.toBeNull();
  });

  it('desligada para a pessoa: a tela fica fora do escopo só para ela', async () => {
    const admin = await entrar('SINT.ADMIN');
    const r = await app.inject({
      method: 'POST',
      url: '/api/administracao/liberacao',
      headers: { cookie: admin.cookie, 'x-csrf': admin.csrf, 'idempotency-key': `m38-${++chave}` },
      payload: {
        chave: 'internacao.leitos.painel',
        tipo: 'recurso',
        escopo: 'pessoa',
        valores: ['SINT.LEITOS'],
        ligar: false,
        justificativa: 'Escopo sintético da onda 0 (teste)',
        senha: SENHA,
      },
    });
    expect(r.statusCode).toBe(200);
    const leitos = await entrar('SINT.LEITOS');
    const t = (await get(leitos, '/api/onda0/telas')).json();
    expect(t.telas.find((x: { id: string }) => x.id === 'leitos').situacao).toBe('fora-do-escopo');
    // A diretoria continua com a tela (a chave do estabelecimento segue ligada).
    const diretoria = await entrar('SINT.DIRETORIA');
    const td = (await get(diretoria, '/api/onda0/telas')).json();
    expect(td.telas.find((x: { id: string }) => x.id === 'leitos').situacao).not.toBe('fora-do-escopo');
  });
});

describe('onda 0: o servidor confere as chaves de tela (regra 3 e seção 12)', { timeout: 30_000 }, () => {
  const liberar = async (chaveTela: string, escopo: string, valores: string[], ligar: boolean) => {
    const admin = await entrar('SINT.ADMIN');
    const r = await app.inject({
      method: 'POST',
      url: '/api/administracao/liberacao',
      headers: { cookie: admin.cookie, 'x-csrf': admin.csrf, 'idempotency-key': `m38-${++chave}` },
      payload: {
        chave: chaveTela,
        tipo: 'recurso',
        escopo,
        valores,
        ligar,
        justificativa: 'Escopo sintético da onda 0 (teste)',
        senha: SENHA,
      },
    });
    expect(r.statusCode).toBe(200);
  };

  it('chave de domínios desligada para o grupo LEITOS: SINT.LEITOS recebe 403 fora do escopo; SINT.MASTER lê', async () => {
    const antes = await entrar('SINT.LEITOS');
    expect((await get(antes, '/api/cadastros/dominios')).statusCode).toBe(200);
    await liberar('config.dominio.consulta', 'grupo', ['LEITOS'], false);
    const leitos = await entrar('SINT.LEITOS');
    const r = await get(leitos, '/api/cadastros/dominios');
    expect(r.statusCode).toBe(403);
    expect(r.json().detail).toBe(MOTIVO_FORA_DO_ESCOPO_ONDA_0);
    expect(r.json().codigo ?? r.json().type).toBeTruthy();
    const t = (await get(leitos, '/api/onda0/telas')).json();
    expect(t.telas.find((x: { id: string }) => x.id === 'dominios').situacao).toBe('fora-do-escopo');
    // O grupo MASTER (o público da onda) segue lendo pela chave do estabelecimento.
    const master = await entrar('SINT.MASTER');
    expect((await get(master, '/api/cadastros/dominios')).statusCode).toBe(200);
    await liberar('config.dominio.consulta', 'grupo', ['LEITOS'], true);
    expect((await get(await entrar('SINT.LEITOS'), '/api/cadastros/dominios')).statusCode).toBe(200);
  });

  it('desligada para a pessoa: o histórico do paciente recusa fora do escopo; a busca segue pela agenda', async () => {
    await liberar('cadastro.historico.consulta', 'pessoa', ['SINT.RECEPCAO'], false);
    await liberar('cadastro.paciente.consulta', 'pessoa', ['SINT.RECEPCAO'], false);
    const recepcao = await entrar('SINT.RECEPCAO');
    const h = await get(recepcao, '/api/cadastros/pacientes/1/historico');
    expect(h.statusCode).toBe(403);
    expect(h.json().detail).toBe(MOTIVO_FORA_DO_ESCOPO_ONDA_0);
    // A busca do paciente também serve à agenda (chave ligada no estabelecimento sintético): não é recusada pela chave.
    expect((await get(recepcao, '/api/cadastros/pacientes?nome=SINTETICO')).statusCode).not.toBe(403);
    await liberar('cadastro.historico.consulta', 'pessoa', ['SINT.RECEPCAO'], true);
    await liberar('cadastro.paciente.consulta', 'pessoa', ['SINT.RECEPCAO'], true);
  });
});

describe('onda 0: a porta em memória', () => {
  it('só os estabelecimentos configurados; operação fora do catálogo não grava; o banco responde', async () => {
    const fonte = fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria());
    const p = portaOnda0Memoria(fonte, ['aa']);
    expect(p.estabelecimentos).toEqual(['aa']);
    expect(await p.podeEscrever('r', 'zz', 'X', 'cadastro.cadastrarPaciente')).toBe(false);
    expect(await p.podeEscrever('r', 'aa', 'X', 'nao.existe')).toBe(false);
    expect(await p.bancoResponde('r', 'aa')).toBe(true);
  });
});

describe('onda 0: sondas da implantação azul/verde', { timeout: 30_000 }, () => {
  it('sem o segredo, 404; com ele, as cinco sondas sem dado', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/sistema/sonda' })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/sistema/sonda', headers: { 'x-sonda-token': 'errado' } }))
        .statusCode,
    ).toBe(404);
    const r = await app.inject({
      method: 'GET',
      url: '/api/sistema/sonda',
      headers: { 'x-sonda-token': TOKEN },
    });
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s.sondas.map((x: { sonda: string }) => x.sonda)).toEqual([
      'saude',
      'versao',
      'login-sonda',
      'painel-leitos',
      'recusa-negocio',
    ]);
    // O painel de leitos é sondado pelo módulo da internação: sem ele montado, a sonda falha e a implantação não fica
    // pronta (as outras quatro respondem).
    expect(s.sondas.filter((x: { ok: boolean }) => !x.ok).map((x: { sonda: string }) => x.sonda)).toEqual([
      'painel-leitos',
    ]);
    expect(s.pronta).toBe(false);
    expect(s.sondas.find((x: { sonda: string }) => x.sonda === 'login-sonda').detalhe).toMatch(
      /nenhuma de paciente/,
    );
  });

  it('versão esperada diferente: a implantação não fica pronta', async () => {
    process.env['SONDA_VERSAO_ESPERADA'] = '0.0.0-outra';
    try {
      const r = await app.inject({
        method: 'GET',
        url: '/api/sistema/sonda',
        headers: { 'x-sonda-token': TOKEN },
      });
      expect(r.json().pronta).toBe(false);
      expect(r.json().sondas.find((x: { sonda: string }) => x.sonda === 'versao').ok).toBe(false);
    } finally {
      delete process.env['SONDA_VERSAO_ESPERADA'];
    }
  });
});
