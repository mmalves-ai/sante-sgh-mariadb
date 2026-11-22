// M56 (etapa F0) pela HTTP, com a sessão real sobre a fonte sintética, o módulo registrado (API_MODULOS=operadora) e as
// portas EM MEMÓRIA (nada conecta a banco): a
// situação das chaves da operadora no estabelecimento (regra 1: tudo desligado sem nenhuma linha de liberação), os
// catálogos da ANS paginados por chave (grupos do SIP, procedimentos por grupo, vigência e código, classificação), a
// recusa a quem não tem perfil da operadora (D-PERM-56) e a entrada inválida. E o serviço da situação com uma fonte
// falsa: módulo e fatia ligados, fatia sem o módulo (aguardando), pré-requisito pendente, falha fechada e o 403 de
// `exigir`.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { ChaveLiberacao, FonteConfiguracao, PrerequisitoRecurso } from '../config/public-api.js';
import { camposPessoaisMudados, mesmaPessoa } from './aplicacao/identidade.js';
import { SEM_CONFIGURACAO_OPERADORA, ServicoSituacaoOperadora } from './aplicacao/situacao.js';
import { moduloOperadora } from './modulo.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'operadora' };
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    registro: { operadora: async () => ({ modulo: (ctx) => moduloOperadora(ctx) }) },
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
const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const O = '/api/operadora';

describe('operadora própria, etapa F0, pela HTTP', { timeout: 60_000 }, () => {
  it('situação: o módulo e as 10 fatias desligados por padrão (nenhuma linha de liberação)', async () => {
    const c = await entrar('SINT.OPERADORA');
    const r = await get(c, `${O}/situacao`);
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s.modulo).toMatchObject({ chave: 'operadora', fatia: null, situacao: 'desligada' });
    expect(s.modulo.prerequisitos).toEqual([
      { descricao: 'Registro da operadora na ANS', situacao: 'pendente' },
    ]);
    expect(s.fatias).toHaveLength(10);
    expect(s.fatias.every((f: { situacao: string }) => f.situacao === 'desligada')).toBe(true);
    expect(s.fatias.map((f: { chave: string }) => f.chave)).toContain('operadora.mensagens');
    expect(s.aguardandoModulo).toEqual([]);
    expect(JSON.stringify(s)).not.toMatch(/SPDATA|SGO\b|legado/i);
  });

  it('catálogos da ANS: grupos, procedimentos por chave (200 por página), filtros e classificação', async () => {
    const c = await entrar('SINT.OPERADORA');
    const g = await get(c, `${O}/ans/sip/grupos`);
    expect(g.statusCode).toBe(200);
    expect(g.json().itens).toHaveLength(5);

    const p1 = await get(c, `${O}/ans/sip/procedimentos`);
    expect(p1.statusCode).toBe(200);
    expect(p1.json().itens).toHaveLength(200);
    const cursor = p1.json().proxima as string;
    expect(cursor).toMatch(/^\d+\.\d+\.\d{4}-\d{2}-\d{2}$/);
    const p2 = await get(c, `${O}/ans/sip/procedimentos?apos=${encodeURIComponent(cursor)}`);
    expect(p2.json().itens).toHaveLength(50);
    expect(p2.json().proxima).toBeNull();

    const g3 = await get(c, `${O}/ans/sip/procedimentos?grupo=3`);
    expect(g3.json().itens.length).toBe(50);
    expect(g3.json().itens.every((i: { grupo: number }) => i.grupo === 3)).toBe(true);
    const vig = await get(c, `${O}/ans/sip/procedimentos?vigentesEm=2026-10-24`);
    expect(vig.json().itens.every((i: { vigenciaFinal: string | null }) => i.vigenciaFinal === null)).toBe(
      true,
    );
    const um = await get(c, `${O}/ans/sip/procedimentos?procedimento=90000002`);
    expect(um.json().itens).toEqual([
      {
        procedimento: 90000002,
        nome: 'Procedimento sintético 90000002',
        grupo: 2,
        vigenciaInicial: '2009-01-01',
        vigenciaFinal: null,
      },
    ]);
    // Código fora da terminologia TUSS: nome null (a tela diz isso).
    expect(
      (await get(c, `${O}/ans/sip/procedimentos?procedimento=90000010`)).json().itens[0].nome,
    ).toBeNull();

    const cl = await get(c, `${O}/ans/classificacoes`);
    expect(cl.json().itens).toHaveLength(12);
    expect(cl.json().proxima).toBeNull();
    const cl2 = await get(c, `${O}/ans/classificacoes?apos=10`);
    expect(cl2.json().itens.map((i: { codigo: number }) => i.codigo)).toEqual([11, 12]);
    // Busca da classificação: o código exato ou um trecho do nome (sem diferença de maiúsculas).
    const cod = await get(c, `${O}/ans/classificacoes?busca=7`);
    expect(cod.json().itens.map((i: { codigo: number }) => i.codigo)).toEqual([7]);
    const nome = await get(c, `${O}/ans/classificacoes?busca=${encodeURIComponent('terapias')}`);
    expect(nome.json().itens.map((i: { codigo: number }) => i.codigo)).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('entrada inválida: 400 sem ler nada', async () => {
    const c = await entrar('SINT.OPERADORA');
    for (const q of ['grupo=abc', 'vigentesEm=24/10/2026', 'apos=1;DROP', 'procedimento=-1'])
      expect((await get(c, `${O}/ans/sip/procedimentos?${q}`)).statusCode, q).toBe(400);
    expect((await get(c, `${O}/ans/classificacoes?apos=x`)).statusCode).toBe(400);
    expect((await get(c, `${O}/ans/classificacoes?busca=${'x'.repeat(61)}`)).statusCode).toBe(400);
  });

  it('D-PERM-56: sem perfil da operadora, a situação dá 403 (o administrador do hospital também)', async () => {
    for (const login of ['SINT.ADMIN', 'SINT.FATURAMENTO'])
      expect((await get(await entrar(login), `${O}/situacao`)).statusCode, login).toBe(403);
  });

  it('D-ANS-HOSPITAL-56: quem consulta os catálogos oficiais no hospital lê os catálogos da ANS; os demais, 403', async () => {
    const fat = await entrar('SINT.FATURAMENTO');
    for (const u of ['ans/sip/grupos', 'ans/sip/procedimentos', 'ans/classificacoes'])
      expect((await get(fat, `${O}/${u}`)).statusCode, u).toBe(200);
    const rec = await entrar('SINT.RECEPCAO');
    for (const u of ['ans/sip/grupos', 'ans/sip/procedimentos', 'ans/classificacoes'])
      expect((await get(rec, `${O}/${u}`)).statusCode, u).toBe(403);
  });
});

// ── O serviço da situação com uma fonte falsa ────────────────────────────────────────────────────────────

const chave = (c: string, ligada: boolean): ChaveLiberacao => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-24T10:00:00',
});
const prerequisito = (recurso: string, tipo: PrerequisitoRecurso['tipo']): PrerequisitoRecurso => ({
  recurso,
  tipo,
  situacao: 'cumprido',
  validade: null,
  evidencia: 'registro sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-24T10:00:00',
});
function fonte(chaves: ChaveLiberacao[], pre: PrerequisitoRecurso[], falha = false): FonteConfiguracao {
  return {
    chaves: async () => {
      if (falha) throw new Error('fora');
      return chaves;
    },
    prerequisitos: async () => pre,
  } as unknown as FonteConfiguracao;
}
const S = { rede: 'r', hospital: 'aa', login: 'SINT.OPERADORA', setor: null };

describe('ServicoSituacaoOperadora (regra 1)', () => {
  it('fatia ligada sem o módulo: aguardando; com o módulo e o registro na ANS: ligada', async () => {
    const so = new ServicoSituacaoOperadora(fonte([chave('operadora.beneficiarios', true)], []), null);
    const a = await so.situacao(S);
    expect(a.modulo.situacao).toBe('desligada');
    expect(a.fatias.find((f) => f.chave === 'operadora.beneficiarios')?.situacao).toBe('aguardando-modulo');
    expect(a.aguardandoModulo).toEqual(['operadora.beneficiarios']);
    await expect(so.exigir(S, 'operadora.beneficiarios')).rejects.toMatchObject({ status: 403 });

    const pendente = new ServicoSituacaoOperadora(
      fonte([chave('operadora', true), chave('operadora.beneficiarios', true)], []),
      null,
    );
    const p = await pendente.situacao(S);
    expect(p.modulo.situacao).toBe('desligada');
    expect(p.modulo.motivo).toContain('pré-requisito pendente');

    const ligada = new ServicoSituacaoOperadora(
      fonte(
        [chave('operadora', true), chave('operadora.beneficiarios', true)],
        [prerequisito('operadora', 'credenciamento')],
      ),
      null,
    );
    const l = await ligada.situacao(S);
    expect(l.modulo.situacao).toBe('ligada');
    expect(l.fatias.find((f) => f.chave === 'operadora.beneficiarios')).toMatchObject({
      situacao: 'ligada',
      motivo: null,
    });
    // A fatia com pré-requisito próprio (cobrança: o convênio bancário) segue desligada até ele.
    expect(l.fatias.find((f) => f.chave === 'operadora.cobranca')?.situacao).toBe('desligada');
    await expect(ligada.exigir(S, 'operadora.beneficiarios')).resolves.toBeUndefined();
  });

  it('falha da fonte ou sem fonte: tudo desligado com o motivo (falha fechada)', async () => {
    for (const so of [
      new ServicoSituacaoOperadora(fonte([chave('operadora', true)], [], true), null),
      new ServicoSituacaoOperadora(null, null),
    ]) {
      const s = await so.situacao(S);
      expect(s.modulo).toMatchObject({ situacao: 'desligada', motivo: SEM_CONFIGURACAO_OPERADORA });
      expect(s.fatias.every((f) => f.situacao === 'desligada')).toBe(true);
      await expect(so.exigir(S, 'operadora')).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe('identidade da pessoa do cadastro único (regra pura)', () => {
  const pessoa = {
    nome: 'Maria  da Conceição',
    nomeSocial: null,
    cpf: '123.456.789-09',
    cns: null,
    nascimento: '1980-05-10',
    sexo: 'F',
    nomeMae: 'Mãe Sintética',
  };
  it('o CPF encontrado só é da pessoa digitada com o mesmo nome (sem acento e caixa) e nascimento', () => {
    expect(mesmaPessoa(pessoa, { nome: 'MARIA DA CONCEICAO', nascimento: '1980-05-10' })).toBe(true);
    expect(mesmaPessoa(pessoa, { nome: 'MARIA DA CONCEICAO', nascimento: '1981-05-10' })).toBe(false);
    expect(mesmaPessoa(pessoa, { nome: 'OUTRA PESSOA', nascimento: '1980-05-10' })).toBe(false);
    expect(
      mesmaPessoa(
        { nome: 'Maria da Conceição', nascimento: null },
        { nome: 'maria da conceicao', nascimento: '1980-05-10' },
      ),
    ).toBe(true);
  });
  it('a alteração aponta só os dados pessoais que mudaram', () => {
    expect(
      camposPessoaisMudados(pessoa, {
        ...pessoa,
        nome: 'MARIA DA CONCEICAO',
        cpf: '12345678909',
        nomeMae: 'MAE SINTETICA',
      }),
    ).toEqual([]);
    expect(
      camposPessoaisMudados(pessoa, { ...pessoa, nome: 'Outra', sexo: 'I', cns: '700000000000005' }),
    ).toEqual(['nome', 'cns', 'sexo']);
  });
});
