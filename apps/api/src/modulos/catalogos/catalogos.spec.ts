// M13 pela HTTP, com a sessão real sobre a fonte sintética e a fonte dos catálogos EM MEMÓRIA (nada conecta a
// banco): painel, envio de uma competência SIGTAP sintética no leiaute oficial (validação e comparação), aprovação
// com a senha de novo e a publicação (o "worker" da memória), consulta e histórico; reimportação do mesmo arquivo,
// competência passada, catálogo cujo responsável não é este sistema e permissão.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { arquivoBaseCep, arquivoFiscal, arquivoTbProcedimento } from '@sgh/dominio-catalogo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { REGISTRO_MODULOS } from '../registro.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'catalogos' };
// O módulo pelo próprio carregador (o integrador inclui `catalogos` no REGISTRO_MODULOS).
const registro = { ...REGISTRO_MODULOS, catalogos: () => import('./modulo.js') };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, registro });
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
  'idempotency-key': `teste-m13-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: h(s), payload: payload as Record<string, unknown> });

const sigtap = (competencia: string, valorSa: number) =>
  arquivoTbProcedimento([
    {
      codigo: '0399990001',
      nome: 'CONSULTA SINTÉTICO',
      competencia,
      valorSa,
      complexidade: '2',
      sexo: 'I',
      financiamento: '06',
    },
    {
      codigo: '0399990002',
      nome: 'EXAME SINTÉTICO',
      competencia,
      valorSa: 5.5,
      complexidade: '2',
      sexo: 'I',
      financiamento: '06',
    },
    { codigo: '0399990009', nome: 'NOVO SINTÉTICO', competencia, valorSa: 1 },
  ]);

describe('catálogos oficiais (M13)', () => {
  it('painel: responsável por catálogo, edição no banco e janela de publicação', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const r = await get(s, '/api/catalogos/painel');
    expect(r.statusCode).toBe(200);
    const p = r.json();
    const de = (c: string) => p.catalogos.find((x: { codigo: string }) => x.codigo === c);
    expect(de('sigtap')).toMatchObject({
      responsavel: 'novo',
      edicaoNoBanco: { descricao: 'competência', valor: '202609' },
    });
    expect(de('tuss').responsavel).toBe('externo');
    expect(de('brasindice').licenca).toMatchObject({ exigida: true, vigente: false });
    expect(p.janela).toMatchObject({ inicio: '22:00', fim: '06:00' });
  });

  it('SIGTAP: envio, comparação, aprovação com a senha, publicação, consulta, histórico e reimportação', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const envio = {
      catalogo: 'sigtap',
      arquivos: [{ nome: 'tb_procedimento.txt', conteudo: sigtap('202610', 12) }],
    };
    const r = await post(s, '/api/catalogos/cargas', envio);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      situacao: 'comparada',
      lotes: 1,
      totais: { linhas: 3, novos: 1, alterados: 1, iguais: 1 },
    });
    const id = r.json().id as number;
    const d = await get(s, `/api/catalogos/cargas/${id}?comparacao=novo`);
    expect(d.statusCode).toBe(200);
    expect(d.json().linhas[0].motivo).toContain('não incluído');
    expect(d.json().publicacao).toEqual({ pode: true, motivo: null });
    const versao = d.json().versao as number;
    expect(
      (
        await post(s, `/api/catalogos/cargas/${id}/aprovar`, {
          justificativa: 'competência nova',
          senha: 'errada',
          versao,
        })
      ).statusCode,
    ).toBe(401);
    const a = await post(s, `/api/catalogos/cargas/${id}/aprovar`, {
      justificativa: 'competência nova',
      senha: SENHA,
      versao,
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ situacao: 'publicada' });
    const c = await get(s, '/api/catalogos/consulta/procedimento?busca=CONSULTA');
    expect(c.json().itens[0]).toMatchObject({ codigo: '0399990001', valorSa: 12 });
    const hst = await get(s, '/api/catalogos/sigtap/0399990001/historico');
    expect(hst.json().competencias[0]).toMatchObject({ competencia: '202610', valorSa: 12 });
    // Reimportação do mesmo arquivo: rejeitada, nada a gravar.
    const re = await post(s, '/api/catalogos/cargas', envio);
    expect(re.json()).toMatchObject({ situacao: 'rejeitada' });
    expect(re.json().motivo).toContain('reimportação');
    // Competência anterior à do banco: rejeitada (edição passada nunca é sobrescrita).
    const passada = await post(s, '/api/catalogos/cargas', {
      catalogo: 'sigtap',
      arquivos: [{ nome: 'tb_procedimento.txt', conteudo: sigtap('202601', 1) }],
    });
    expect(passada.json()).toMatchObject({ situacao: 'rejeitada' });
    expect(passada.json().motivo).toContain('anterior');
    const lista = await get(s, '/api/catalogos/cargas?catalogo=sigtap');
    expect(lista.json().cargas.length).toBeGreaterThanOrEqual(3);
  });

  it('catálogo cujo responsável não é este sistema: a aprovação é recusada; rejeitar com motivo', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const r = await post(s, '/api/catalogos/cargas', {
      catalogo: 'tuss',
      edicao: '4.02.00',
      arquivos: [
        { nome: 'TUSS24.csv', conteudo: 'Código do Termo;Termo\n999999;OCUPACAO ANS SINTETICA NOVA' },
      ],
    });
    expect(r.json().situacao).toBe('comparada');
    const d = await get(s, `/api/catalogos/cargas/${r.json().id}`);
    expect(d.json().publicacao.pode).toBe(false);
    const a = await post(s, `/api/catalogos/cargas/${r.json().id}/aprovar`, {
      justificativa: 'tentativa',
      senha: SENHA,
      versao: d.json().versao,
    });
    expect(a.statusCode).toBe(409);
    expect(a.json().codigo).toBe('responsavel-externo');
    const rj = await post(s, `/api/catalogos/cargas/${r.json().id}/rejeitar`, {
      motivo: 'carga externa',
      versao: d.json().versao,
    });
    expect(rj.json()).toEqual({ id: r.json().id, situacao: 'rejeitada' });
  });

  it('CEP: base no leiaute de posições, consulta paginada e entrada inválida', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const conteudo = arquivoBaseCep(
      [{ cep: '99999003', uf: 'ZZ', cidade: 'CIDADE SINTÉTICO', logradouro: 'RUA NOVA', bairro: 'CENTRO' }],
      [],
    );
    const r = await post(s, '/api/catalogos/cargas', {
      catalogo: 'cep',
      arquivos: [{ nome: 'LOG_ZZ.TXT', conteudo }],
    });
    expect(r.json()).toMatchObject({ situacao: 'comparada', totais: { novos: 1, removidos: 2 } });
    const c = await get(s, '/api/catalogos/consulta/cep?busca=99999001&porPagina=10');
    expect(c.json().total).toBe(1);
    expect((await get(s, '/api/catalogos/consulta/inexistente')).statusCode).toBe(404);
    expect((await get(s, '/api/catalogos/consulta/x-y')).statusCode).toBe(400);
    expect((await get(s, '/api/catalogos/sigtap/12/historico')).statusCode).toBe(400);
    expect((await get(s, '/api/catalogos/cargas/999')).statusCode).toBe(404);
    expect((await post(s, '/api/catalogos/cargas', { catalogo: 'x' })).statusCode).toBe(400);
  });

  it('consulta: nome herdado de Object é 404; tabela nova do contrato responde; leiaute pede a permissão da tela', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    for (const n of ['constructor', 'toString', 'valueOf', 'hasOwnProperty'])
      expect((await get(s, `/api/catalogos/consulta/${n}`)).statusCode).toBe(404);
    const d = await get(s, '/api/catalogos/consulta/tissViaAcesso');
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({ entidade: 'tissViaAcesso', titulo: 'Vias de acesso', total: 0 });
    expect((await get(s, '/api/catalogos/consulta/procedimentoCid?competencia=202613')).statusCode).toBe(400);
    expect((await get(s, '/api/catalogos/consulta/procedimentoCid?competencia=202612')).statusCode).toBe(200);
    // Sem catalogo.leiaute.ler (opções 3649, 6341, 3650): nem pela rota da tela nem pela consulta genérica.
    expect((await get(s, '/api/catalogos/leiautes/posicoes')).statusCode).toBe(403);
    expect((await get(s, '/api/catalogos/consulta/leiautePosicao')).statusCode).toBe(403);
  });

  it('aprovação por área: quem aprova o faturamento não aprova a carga fiscal', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const r = await post(s, '/api/catalogos/cargas', {
      catalogo: 'fiscal',
      arquivos: [
        { nome: 'cfop.txt', conteudo: arquivoFiscal([{ codigo: '9998', nome: 'CFOP SINTETICO NOVO' }]) },
      ],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().situacao).toBe('comparada');
    const d = await get(s, `/api/catalogos/cargas/${r.json().id}`);
    const a = await post(s, `/api/catalogos/cargas/${r.json().id}/aprovar`, {
      justificativa: 'tentativa de outra área',
      senha: SENHA,
      versao: d.json().versao,
    });
    expect(a.statusCode).toBe(403);
    expect(a.json().detail).toContain('área fiscal');
  });

  it('permissão: o faturista sem a opção de importação consulta, mas não envia', async () => {
    const s = await entrar('SINT.FATURISTA');
    expect(
      (
        await post(s, '/api/catalogos/cargas', {
          catalogo: 'cid',
          arquivos: [{ nome: 'CID.CSV', conteudo: 'x' }],
        })
      ).statusCode,
    ).toBe(403);
  });
});
