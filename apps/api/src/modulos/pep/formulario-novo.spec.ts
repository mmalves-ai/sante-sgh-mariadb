// M45, etapa 1 (construtor de formulários novos) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM
// MEMÓRIA (nada conecta a banco): o rascunho com o código nunca repetido e o controle otimista, os casos recalculados no
// servidor, a revisão só com a definição sem problema e os casos verdes, a aprovação por outra pessoa (quatro olhos), a
// publicação com a senha e o hash visto (ponte só no novo enquanto a chave está desligada), o publicado imutável e a
// nova versão a partir dele, a aposentadoria com o motivo, o banco de perguntas e as especialidades; cada gravação com o
// evento na trilha; quem não tem a permissão não grava. Dados sintéticos.
import { CHAVE_PONTE_FORMULARIO_NOVO } from '@sgh/contratos';
import { CASOS_FORMULARIO_NOVO_SINTETICO, FORMULARIO_NOVO_SINTETICO } from '@sgh/dominio-pep';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { PortaFormularioNovoMemoria } from './formulario-novo-porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const formularioNovo = new PortaFormularioNovoMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, formularioNovo, vigia: null });
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
  expect(r.statusCode, r.body).toBe(201);
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
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m45-fn-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api/pep/admin/formularios-novos${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/pep/admin/formularios-novos${url}`,
    headers: h(s),
    payload: payload as object,
  });

const DEF = FORMULARIO_NOVO_SINTETICO;
const CASOS = CASOS_FORMULARIO_NOVO_SINTETICO;
const eventos = (codigo: string) => trilha.eventos.filter((l) => l.evento === codigo).length;

describe('construtor de formulários novos (M45, etapa 1)', () => {
  let adm: Sessao;
  let com: Sessao;
  let id = 0;
  let linha = '';

  it('a lista: liberada na sintética, a ponte desligada com o motivo; sem permissão não vê', async () => {
    adm = await entrar('SINT.ADMIN.PEP');
    com = await entrar('SINT.COMISSAO.PRONT');
    const r = await get(adm, '');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().ligada).toBe(true);
    expect(r.json().ponte.ligada).toBe(false);
    expect(r.json().ponte.motivo).toMatch(/modelo do prontuário/);
    expect(r.json().ponte.motivo).not.toMatch(/SPDATA|legado/i);
    const rec = await entrar('SINT.RECEPCAO');
    expect((await get(rec, '')).statusCode).toBe(403);
  });

  it('salvar: o rascunho com os casos; o código do prontuário em uso é recusado; a comissão não edita', async () => {
    const usado = await post(adm, '', {
      id: null,
      baseadoEm: null,
      definicao: { ...DEF, codigo: 'ENF021' },
      casos: [],
      versaoEsperada: null,
    });
    expect(usado.statusCode).toBe(409);
    expect(usado.json().codigo).toBe('codigo-em-uso');
    expect(
      (await post(com, '', { id: null, baseadoEm: null, definicao: DEF, casos: CASOS, versaoEsperada: null }))
        .statusCode,
    ).toBe(403);
    const antes = eventos('pep.formularioNovo.salvo');
    const r = await post(adm, '', {
      id: null,
      baseadoEm: null,
      definicao: DEF,
      casos: CASOS,
      versaoEsperada: null,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ versao: 1, estado: 'rascunho' });
    id = r.json().id;
    linha = r.json().versaoLinha;
    expect(eventos('pep.formularioNovo.salvo')).toBe(antes + 1);
    const outro = await post(adm, '', {
      id: null,
      baseadoEm: null,
      definicao: DEF,
      casos: [],
      versaoEsperada: null,
    });
    expect(outro.json().codigo).toBe('codigo-em-uso');
  });

  it('o detalhe recalcula os casos no servidor; a versão vista vale (concorrência)', async () => {
    const d = (await get(adm, `/${id}`)).json();
    expect(d.resultados.map((x: { passou: boolean }) => x.passou)).toEqual([true, true]);
    expect(d.contentHashAtual).toMatch(/^[0-9a-f]{64}$/);
    expect(d.integro).toBeNull();
    const velho = await post(adm, '', {
      id,
      baseadoEm: null,
      definicao: DEF,
      casos: CASOS,
      versaoEsperada: 'outra',
    });
    expect(velho.json().codigo).toBe('versao-concorrente');
    // Um caso que não passa: vai ao rascunho, mas a revisão o recusa.
    const errado = [...CASOS, { ...CASOS[0]!, nome: 'errado', esperado: { total: 99 } }];
    const r = await post(adm, '', {
      id,
      baseadoEm: null,
      definicao: DEF,
      casos: errado,
      versaoEsperada: linha,
    });
    expect(r.statusCode, r.body).toBe(201);
    linha = r.json().versaoLinha;
    const rec = await post(adm, `/${id}/revisao`, { versaoEsperada: linha });
    expect(rec.json().codigo).toBe('casos-vermelhos');
    const ok = await post(adm, '', {
      id,
      baseadoEm: null,
      definicao: DEF,
      casos: CASOS,
      versaoEsperada: linha,
    });
    linha = ok.json().versaoLinha;
  });

  it('revisão e decisão: quem escreveu não aprova; a comissão aprova com parecer; sem a permissão, 403', async () => {
    const r = await post(adm, `/${id}/revisao`, { versaoEsperada: linha });
    expect(r.statusCode, r.body).toBe(201);
    linha = r.json().versaoLinha;
    // O administrador também confirma (a mesma opção), mas escreveu a versão: os quatro olhos recusam.
    const propria = await post(adm, `/${id}/decisao`, {
      versaoEsperada: linha,
      decisao: 'aprovar',
      parecer: 'Aprovo a escala',
    });
    expect(propria.json().codigo).toBe('aprovador-e-autor');
    const tecnico = await entrar('SINT.RECEPCAO');
    expect(
      (
        await post(tecnico, `/${id}/decisao`, {
          versaoEsperada: linha,
          decisao: 'aprovar',
          parecer: 'Aprovo a escala',
        })
      ).statusCode,
    ).toBe(403);
    const editar = await post(adm, '', {
      id,
      baseadoEm: null,
      definicao: DEF,
      casos: CASOS,
      versaoEsperada: linha,
    });
    expect(editar.json().codigo).toBe('estado-invalido');
    const ap = await post(com, `/${id}/decisao`, {
      versaoEsperada: linha,
      decisao: 'aprovar',
      parecer: 'Aprovada pela comissão',
    });
    expect(ap.statusCode, ap.body).toBe(201);
    linha = ap.json().versaoLinha;
    expect(eventos('pep.formularioNovo.revisao')).toBe(2);
  });

  it('publicar: a senha, o hash visto; só no novo enquanto a ponte está desligada; depois, imutável', async () => {
    const d = (await get(com, `/${id}`)).json();
    expect(
      (
        await post(com, `/${id}/publicar`, {
          versaoEsperada: linha,
          contentHashEsperado: d.contentHashAtual,
          senha: 'errada',
        })
      ).statusCode,
    ).toBe(401);
    const hash = await post(com, `/${id}/publicar`, {
      versaoEsperada: linha,
      contentHashEsperado: 'f'.repeat(64),
      senha: SENHA,
    });
    expect(hash.json().codigo).toBe('hash-divergente');
    // D-APROV-45: o administrador também tem a opção de publicar, mas escreveu a versão: os quatro olhos recusam.
    const autor = await post(adm, `/${id}/publicar`, {
      versaoEsperada: linha,
      contentHashEsperado: d.contentHashAtual,
      senha: SENHA,
    });
    expect(autor.statusCode, autor.body).toBe(409);
    expect(autor.json().codigo).toBe('publicador-e-autor');
    const r = await post(com, `/${id}/publicar`, {
      versaoEsperada: linha,
      contentHashEsperado: d.contentHashAtual,
      senha: SENHA,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ estado: 'publicado', ponte: 'so-sante' });
    expect(r.json().mensagem).not.toMatch(/SPDATA|legado/i);
    expect(eventos('pep.formularioNovo.publicado')).toBe(1);
    const p = (await get(adm, `/${id}`)).json();
    expect(p.integro).toBe(true);
    expect(p.contentHash).toBe(d.contentHashAtual);
    expect(p.eventos.map((e: { tipo: string }) => e.tipo)).toEqual([
      'salvo',
      'salvo',
      'salvo',
      'revisao',
      'aprovado',
      'publicado',
    ]);
    const mexer = await post(adm, '', {
      id,
      baseadoEm: null,
      definicao: DEF,
      casos: CASOS,
      versaoEsperada: p.versaoLinha,
    });
    expect(mexer.json().codigo).toBe('imutavel');
  });

  it('nova versão a partir da publicada (corrigir é publicar nova versão); aposentar com o motivo e a senha', async () => {
    const nova = await post(adm, '', {
      id: null,
      baseadoEm: id,
      definicao: { ...DEF, titulo: `${DEF.titulo} revista` },
      casos: CASOS,
      versaoEsperada: null,
    });
    expect(nova.statusCode, nova.body).toBe(201);
    expect(nova.json().versao).toBe(2);
    const outra = await post(adm, '', {
      id: null,
      baseadoEm: id,
      definicao: DEF,
      casos: CASOS,
      versaoEsperada: null,
    });
    expect(outra.json().codigo).toBe('versao-aberta');
    expect(
      (await post(com, `/${id}/aposentar`, { motivo: 'Substituída pela versão 2', senha: SENHA })).statusCode,
    ).toBe(403);
    const ap = await post(adm, `/${id}/aposentar`, { motivo: 'Substituída pela versão 2', senha: SENHA });
    expect(ap.statusCode, ap.body).toBe(201);
    expect(ap.json().estado).toBe('aposentado');
    const de2 = await post(adm, `/${nova.json().id}/aposentar`, {
      motivo: 'Ainda em rascunho aqui',
      senha: SENHA,
    });
    expect(de2.json().codigo).toBe('estado-invalido');
    const lista = (await get(adm, '')).json().versoes;
    expect(lista.map((v: { versao: number; estado: string }) => `${v.versao}:${v.estado}`)).toEqual([
      '2:rascunho',
      '1:aposentado',
    ]);
  });

  it('banco de perguntas, especialidades, avaliação e prévia do registro-resumo (puros)', async () => {
    const b = await get(adm, '/banco-perguntas?termo=pes&tipo=decimal');
    expect(b.json()).toEqual([
      { id: 9001, titulo: 'Peso', tipo: 'decimal', unidade: 'kg', opcoes: [], usoEmModelos: 12 },
    ]);
    expect((await get(adm, '/banco-perguntas?termo=p')).statusCode).toBe(400);
    expect((await get(adm, '/especialidades')).json().length).toBeGreaterThan(0);
    const av = await post(adm, '/avaliar', { definicao: DEF, casos: CASOS });
    expect(av.statusCode).toBe(200);
    expect(av.json().problemas).toEqual([]);
    const ruim = await post(adm, '/avaliar', {
      definicao: { ...DEF, perguntas: [{ ...DEF.perguntas[0]!, itens: [] }] },
      casos: [],
    });
    expect(ruim.json().problemas.map((p: { codigo: string }) => p.codigo)).toContain('secao-vazia');
    const pr = await post(adm, '/previa-resumo', {
      definicao: DEF,
      versao: 1,
      respostas: { mobilidade: 'acamado', riscos: ['friccao'], conduta: 'Mudança de decúbito' },
    });
    expect(pr.statusCode, pr.body).toBe(200);
    expect(pr.json().texto).toContain('1.3 - Total: 3');
    expect(pr.json().rtf).toContain("Mudan\\'e7a de dec\\'fabito");
    const nunca = await post(adm, '/previa-resumo', {
      definicao: DEF,
      versao: 1,
      respostas: { mobilidade: 'voa' },
    });
    expect(nunca.json().codigo).toBe('resposta-invalida');
  });
});

// Com a ponte ligada, o executor tem de poder gravar: a recusa dele (a operação ainda especificada, POL-3) recusa a
// publicação com o motivo, e a versão segue em revisão (não vira uma publicada só no Sante SGH, imutável e sem o modelo).
describe('publicar com a ponte ligada e o executor recusando (operação especificada)', () => {
  const MOTIVO = 'A criação do modelo do prontuário aguarda o cenário controlado (operação especificada).';
  class PortaExecutorRecusa extends PortaFormularioNovoMemoria {
    override async podeGravar() {
      return { pode: false, codigo: 'operacao-especificada', motivo: MOTIVO };
    }
  }
  const trilha2 = new RegistradorTrilhaMemoria();
  let app2: NestFastifyApplication;
  beforeAll(async () => {
    const configuracao = fonteConfiguracaoMemoria(trilha2, {
      chavesIniciais: () => [
        ...chavesIniciaisSinteticas(),
        {
          id: 'teste-ponte-m45',
          tipo: 'recurso',
          chave: CHAVE_PONTE_FORMULARIO_NOVO,
          escopo: 'hospital',
          valor: '*',
          ligada: true,
          ligadaAntes: null,
          lote: null,
          justificativa: 'Teste da ponte ligada',
          alteradoPor: 'SINT.ADMIN',
          alteradoEm: '2026-10-25T00:00:00.000Z',
        },
      ],
      // O pré-requisito (o cenário controlado conferido) dado como cumprido só neste teste: a ponte liga e o executor decide.
      prerequisitosIniciais: () => [
        ...prerequisitosIniciaisSinteticos(),
        {
          recurso: CHAVE_PONTE_FORMULARIO_NOVO,
          tipo: 'aprovacao',
          situacao: 'dispensado',
          validade: null,
          evidencia: 'teste sintético da ponte ligada',
          alteradoPor: 'SINT.ADMIN',
          alteradoEm: '2026-10-25T00:00:00.000Z',
        },
      ],
    });
    app2 = await criarApp(lerConfiguracao(env), null, env, {
      trilha: trilha2,
      formularioNovo: new PortaExecutorRecusa(),
      configuracao,
      vigia: null,
    });
    await app2.init();
    await app2.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app2.close();
  });

  it('recusa com o motivo do executor (recurso-desligado) e a versão continua em revisão', async () => {
    const entrar2 = async (login: string): Promise<Sessao> => {
      const r = await app2.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login, senha: SENHA },
      });
      expect(r.statusCode, r.body).toBe(201);
      const set = r.headers['set-cookie'] as string[];
      return {
        cookie: set.map((c) => c.split(';')[0]).join('; '),
        csrf:
          set
            .find((c) => c.startsWith('sgh_csrf='))
            ?.split(';')[0]
            ?.slice(9) ?? '',
      };
    };
    const post2 = (s: Sessao, url: string, payload: unknown = {}) =>
      app2.inject({
        method: 'POST',
        url: `/api/pep/admin/formularios-novos${url}`,
        headers: h(s),
        payload: payload as object,
      });
    const get2 = (s: Sessao, url: string) =>
      app2.inject({
        method: 'GET',
        url: `/api/pep/admin/formularios-novos${url}`,
        headers: { cookie: s.cookie },
      });
    const adm = await entrar2('SINT.ADMIN.PEP');
    const com = await entrar2('SINT.COMISSAO.PRONT');
    expect((await get2(adm, '')).json().ponte.ligada).toBe(true);
    const novo = await post2(adm, '', {
      id: null,
      baseadoEm: null,
      definicao: DEF,
      casos: CASOS,
      versaoEsperada: null,
    });
    expect(novo.statusCode, novo.body).toBe(201);
    const id = novo.json().id as number;
    const rev = await post2(adm, `/${id}/revisao`, { versaoEsperada: novo.json().versaoLinha });
    expect(rev.statusCode, rev.body).toBe(201);
    const ap = await post2(com, `/${id}/decisao`, {
      versaoEsperada: rev.json().versaoLinha,
      decisao: 'aprovar',
      parecer: 'Aprovada pela comissão',
    });
    expect(ap.statusCode, ap.body).toBe(201);
    const d = (await get2(com, `/${id}`)).json();
    const r = await post2(com, `/${id}/publicar`, {
      versaoEsperada: ap.json().versaoLinha,
      contentHashEsperado: d.contentHashAtual,
      senha: SENHA,
    });
    expect(r.statusCode, r.body).toBe(403);
    expect(r.json().codigo).toBe('recurso-desligado');
    expect(r.json().detail ?? r.json().mensagem ?? r.body).toContain(MOTIVO);
    const depois = (await get2(com, `/${id}`)).json();
    expect(depois.estado).toBe('revisao');
    expect(trilha2.eventos.filter((l) => l.evento === 'pep.formularioNovo.publicado')).toHaveLength(0);
  });
});
