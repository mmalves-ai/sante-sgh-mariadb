// M38 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco):
// - GET /api/onda0/telas: a situação das telas da onda para a sessão; a chave desligada para a pessoa a deixa fora do
//   escopo (regra 3), e o painel de leitos recusa com o aviso próprio;
// - o grupo do legado vai na sessão e conta no escopo `grupo` das chaves;
// - GET /api/config/assinaturas/vigia: o painel da vigilância (só estrutura) com a permissão; período validado;
// - GET /api/sistema/sonda: 404 sem o segredo; com ele, as cinco sondas e a implantação pronta.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ESCRITAS_TELAS_ONDA_0,
  MOTIVO_FORA_DO_ESCOPO_ONDA_0,
  MOTIVO_TELA_DESLIGADA_ONDA_0,
} from '@sgh/contratos';
import { OPERACOES } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { portaOnda0Memoria, vigiaSintetica } from './onda0.js';

// Segredo sintético do teste (montado na hora; nunca um segredo real).
const TOKEN = ['sonda', 'sintetica', 'x'.repeat(32)].join('-');
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
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
  it('todas as telas da onda com a chave; ligadas na sessão sintética; o grupo do legado vai na sessão', async () => {
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

  it('revisão da D-PROF-39: Profissionais com a escrita liberada (as 12 gravações da tela existem no executor)', async () => {
    const s = await entrar('SINT.ADMIN');
    const t = (await get(s, '/api/onda0/telas')).json();
    const prof = t.telas.find((x: { id: string }) => x.id === 'profissionais');
    expect(prof.escritaLiberada).toBe(true);
    // Toda operação listada para a tela existe no catálogo do executor (nome trocado faria a faixa voltar).
    const ops = ESCRITAS_TELAS_ONDA_0['profissionais'] ?? [];
    expect(ops.length).toBe(12);
    for (const op of ops) expect(OPERACOES[op], op).toBeDefined();
  });

  it('desligada para a pessoa: fora do escopo; o painel de leitos recusa com o aviso da onda', async () => {
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
    const p = await get(leitos, '/api/internacao/leitos/painel');
    expect(p.statusCode).toBe(403);
    expect(p.json().detail).toBe(MOTIVO_FORA_DO_ESCOPO_ONDA_0);
    const lib = (await get(leitos, '/api/internacao/liberacao')).json();
    expect(lib.painel).toBe(false);
    expect(lib.motivos.painel).toBe(MOTIVO_FORA_DO_ESCOPO_ONDA_0);
    // A diretoria continua vendo o painel (a chave do estabelecimento segue ligada).
    const diretoria = await entrar('SINT.DIRETORIA');
    expect((await get(diretoria, '/api/internacao/leitos/painel')).statusCode).toBe(200);
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

  it('desligada no estabelecimento: 403 desligada para todos; o histórico do paciente também; a busca segue pela agenda', async () => {
    await liberar('cadastro.historico.consulta', 'pessoa', ['SINT.RECEPCAO'], false);
    await liberar('cadastro.paciente.consulta', 'pessoa', ['SINT.RECEPCAO'], false);
    const recepcao = await entrar('SINT.RECEPCAO');
    const h = await get(recepcao, '/api/cadastros/pacientes/1/historico');
    expect(h.statusCode).toBe(403);
    expect(h.json().detail).toBe(MOTIVO_FORA_DO_ESCOPO_ONDA_0);
    // A busca do paciente também serve à agenda (chave ligada no estabelecimento sintético): não é recusada pela chave.
    expect((await get(recepcao, '/api/cadastros/pacientes?nome=SINTETICO')).statusCode).not.toBe(403);
    await liberar('config.matriz.consulta', 'hospital', ['*'], false);
    const admin = await entrar('SINT.ADMIN');
    const m = await get(admin, '/api/administracao/coexistencia/matriz');
    expect(m.statusCode).toBe(403);
    expect(m.json().detail).toBe(MOTIVO_TELA_DESLIGADA_ONDA_0);
    await liberar('config.matriz.consulta', 'hospital', ['*'], true);
    expect((await get(admin, '/api/administracao/coexistencia/matriz')).statusCode).toBe(200);
    await liberar('cadastro.historico.consulta', 'pessoa', ['SINT.RECEPCAO'], true);
    await liberar('cadastro.paciente.consulta', 'pessoa', ['SINT.RECEPCAO'], true);
  });
});

describe('onda 0: vigilância diária na tela de testes de assinatura', { timeout: 30_000 }, () => {
  it('administrador lê o período (só estrutura); recepção recebe 403; período e estabelecimento validados', async () => {
    const admin = await entrar('SINT.ADMIN');
    const r = await get(admin, '/api/config/assinaturas/vigia');
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v.hospital).toBe('aa');
    // Só o estabelecimento ativo (a permissão vale nele): o outro, pela troca de estabelecimento.
    expect(v.estabelecimentos).toEqual(['aa']);
    expect(v.execucoes).toHaveLength(2);
    expect(v.execucoes[1].resultado.elementos[0]).toEqual({
      tipo: 'classe',
      tabela: 'TBCABTRILHA',
      coluna: 'FUSO_HORARIO_LOCAL',
      classe: 'constante',
      ocorrencias: 1,
    });
    expect((await get(admin, '/api/config/assinaturas/vigia?hospital=zz')).statusCode).toBe(400);
    const outro = await get(admin, '/api/config/assinaturas/vigia?hospital=bb');
    expect(outro.statusCode).toBe(403);
    expect(JSON.stringify(outro.json())).not.toContain('FUSO_HORARIO_LOCAL');
    expect((await get(admin, '/api/config/assinaturas/vigia?de=2026-11-10&ate=2026-11-01')).statusCode).toBe(
      400,
    );
    expect((await get(admin, '/api/config/assinaturas/vigia?de=2026-01-01&ate=2026-11-01')).statusCode).toBe(
      400,
    );
    const recepcao = await entrar('SINT.RECEPCAO');
    expect((await get(recepcao, '/api/config/assinaturas/vigia')).statusCode).toBe(403);
  });

  it('a porta em memória: só os estabelecimentos configurados e o período pedido', async () => {
    const p = portaOnda0Memoria(null, ['aa']);
    expect(await p.vigia('zz', '2000-01-01', '2999-01-01')).toEqual([]);
    const ontem = vigiaSintetica('aa')[0]!.resultado.data;
    expect((await p.vigia('aa', ontem, ontem)).map((x) => x.resultado.divergentes)).toEqual([0]);
    expect(await p.podeEscrever('r', 'aa', 'X', 'nao.existe')).toBe(false);
    expect(await p.bancoResponde('r', 'aa')).toBe(true);
  });
});

describe('onda 0: sondas da implantação azul/verde', { timeout: 30_000 }, () => {
  it('sem o segredo, 404; com ele, as cinco sondas sem dado e a implantação pronta', async () => {
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
    expect(s.sondas.filter((x: { ok: boolean }) => !x.ok)).toEqual([]);
    expect(s.pronta).toBe(true);
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
