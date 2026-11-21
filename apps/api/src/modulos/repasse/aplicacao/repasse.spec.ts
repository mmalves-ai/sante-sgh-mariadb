// O repasse médico pela HTTP (M33; porta EM MEMÓRIA, nada conecta a banco): regra proposta → simulada → aprovada por
// outra pessoa (quem propôs não aprova; regra 3); apuração do período com a memória de cálculo (regras 1, 4 e 5),
// conferida e aprovada por outra pessoa (quem apura não aprova; regra 9), o período apurado no outro sistema recusado
// (regra 10); os lançamentos da apuração aprovada, o estorno por glosa ligado ao original e o estorno que passa do
// original recusado; o RPA com as retenções escritas e o título no contas a pagar (regra 7 e 8); o extrato só do
// próprio médico (regra 12); textos sem o nome do outro sistema. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { PortaFinanceiroMemoria } from '../../financeiro/porta-memoria.js';
import { moduloFinanceiro } from '../../financeiro/modulo.js';
import { moduloRepasse } from '../modulo.js';
import { PortaRepasseMemoria } from '../porta-memoria.js';
import { ServicoRepasse } from '../servico.js';
import { htmlRpaEmitido } from '../documentos.js';

interface Sessao {
  cookie: string;
  csrf: string;
}

const SISTEMA_ANTIGO = /SPDATA|legado|sistema antigo/i;
let app: NestFastifyApplication;
let financeiro: PortaFinanceiroMemoria;
let trilha: RegistradorTrilhaMemoria;
let repasse: PortaRepasseMemoria;
let seq = 0;
let hoje = '';
let competencia = '';

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
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste-m33-${++seq}-${Date.now()}` },
    payload: payload as object,
  });

beforeAll(async () => {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'repasse,financeiro' };
  financeiro = new PortaFinanceiroMemoria({ estado: () => 'verde' });
  repasse = new PortaRepasseMemoria({ estado: () => 'verde' }, financeiro);
  trilha = new RegistradorTrilhaMemoria();
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      repasse: async () => ({ modulo: (ctx) => moduloRepasse(ctx, { porta: repasse }) }),
      financeiro: async () => ({ modulo: (ctx) => moduloFinanceiro(ctx, { porta: financeiro }) }),
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const s = await entrar('SINT.REP.ANALISTA');
  const apoio = (await get(s, '/repasse/apoio')).json();
  hoje = apoio.hoje;
  competencia = hoje.slice(0, 7);
  expect(apoio.gravacao.ligada, JSON.stringify(apoio.gravacao)).toBe(true);
  expect(apoio.rpaConfigurado).toBe(true);
});
afterAll(async () => {
  await app.close();
});

describe('repasse médico pela HTTP (memória)', { timeout: 30_000 }, () => {
  it('sem as opções do repasse, 403 nas telas do setor (regra 12: nenhum outro perfil vê repasse)', async () => {
    const m = await entrar('SINT.REP.MEDICO');
    expect((await get(m, '/repasse/regras?convenio=301')).statusCode).toBe(403);
    expect((await get(m, `/repasse/apuracoes?competencia=${competencia}`)).statusCode).toBe(403);
    expect((await get(m, `/repasse/lancamentos?competencia=${competencia}`)).statusCode).toBe(403);
  });

  it('regra 3: proposta → simulada → aprovada por outra pessoa; quem propôs não aprova', async () => {
    const a = await entrar('SINT.REP.ANALISTA');
    const p = await post(a, '/repasse/regras/versoes', {
      vigencia: hoje,
      beneficiario: 'M',
      profissional: 7002,
      convenio: 301,
      procedimentoInicial: 10101012,
      percentual: 22,
      base: 'cobrado',
      evento: 40,
      justificativa: 'Nova regra sintética do médico 7002',
    });
    expect(p.statusCode, p.body).toBe(200);
    const versao = p.json().ids.versao as number;
    // Aprovar sem simular é recusado (o domínio pede a simulação).
    const sup = await entrar('SINT.REP.SUPERVISOR');
    const cedo = await post(sup, `/repasse/regras/versoes/${versao}/decisao`, {
      decisao: 'aprovar',
      justificativa: 'Conferida com o setor',
    });
    expect(cedo.statusCode).toBe(409);
    const sim = await post(a, '/repasse/regras/simular', {
      versao,
      data: hoje,
      convenio: 301,
      procedimento: 10101012,
      profissional: 7002,
      tipoConta: 'I',
      valorCobrado: 1000,
    });
    expect(sim.statusCode, sim.body).toBe(200);
    expect(sim.json().memoria.valor).toBe(220);
    expect(sim.json().memoria.conta).toContain('22,0000%');
    // O próprio autor não tem a permissão de aprovar; o supervisor aprova.
    expect(
      (
        await post(a, `/repasse/regras/versoes/${versao}/decisao`, {
          decisao: 'aprovar',
          justificativa: 'Eu mesmo aprovo',
        })
      ).statusCode,
    ).toBe(403);
    const ok = await post(sup, `/repasse/regras/versoes/${versao}/decisao`, {
      decisao: 'aprovar',
      justificativa: 'Conferida com o setor',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const vs = (await get(sup, '/repasse/regras/versoes')).json() as { id: number; estado: string }[];
    expect(vs.find((v) => v.id === versao)?.estado).toBe('incluida');
  });

  it('regras 1, 4, 5, 9 e 10: apurar, conferir, aprovar por outra pessoa; o período do outro sistema é recusado', async () => {
    const a = await entrar('SINT.REP.ANALISTA');
    const r = await post(a, '/repasse/apuracoes', { empresa: 1, competencia });
    expect(r.statusCode, r.body).toBe(200);
    const id = r.json().ids.apuracao as number;
    const ap = (await get(a, `/repasse/apuracoes?competencia=${competencia}`)).json();
    // Itens: 1.000 e 800 do 7001 (18,5%: 185 + 148), 300 do 7002 no convênio 302 (fixo 50), 500 do 7002 no 301 (a
    // regra nova de 22% só vale da vigência em diante: o item é do dia 10, vale a geral de 10% = 50), e um item sem
    // executante (pendência).
    expect(ap.pendenciasPorMotivo).toEqual({ 'sem-executante': 1 });
    expect(ap.porBeneficiario).toEqual([
      { prestador: 7001, itens: 2, base: 1800, valor: 333 },
      { prestador: 7002, itens: 2, base: 800, valor: 100 },
    ]);
    expect(ap.valor).toBe(433);
    expect((await post(a, `/repasse/apuracoes/${id}/decisao`, { acao: 'aprovar' })).statusCode).toBe(403);
    // A negação da permissão de agir vai à trilha de permissão negada (como a da rota).
    expect(
      trilha.eventos.some(
        (x) =>
          x.evento === 'acesso.permissao.negada' &&
          x.recurso === 'repasse.apuracao.aprovar' &&
          x.resultado === 'falha',
      ),
    ).toBe(true);
    expect((await post(a, `/repasse/apuracoes/${id}/decisao`, { acao: 'conferir' })).statusCode).toBe(200);
    const sup = await entrar('SINT.REP.SUPERVISOR');
    expect((await post(sup, `/repasse/apuracoes/${id}/decisao`, { acao: 'aprovar' })).statusCode).toBe(200);
    // Apurada e aprovada não muda (a correção entra no período seguinte).
    expect((await post(a, '/repasse/apuracoes', { empresa: 1, competencia })).statusCode).toBe(409);
    const outro = await post(a, '/repasse/apuracoes', { empresa: 1, competencia: '2026-06' });
    expect(outro.statusCode).toBe(409);
    expect(outro.json().codigo).toBe('periodo-ja-apurado');
    // O demonstrativo do médico com a conta de cada item.
    const d = (await get(a, `/repasse/apuracoes/${id}/demonstrativo/7001`)).json();
    expect(d.valor).toBe(333);
    expect(d.itens[0].conta).toMatch(/× 18,5000% =/);
    // A apuração gravada vale (o sistema é o de registro do repasse): não é simulação. O lançamento da aprovada é
    // conferido no teste da porta própria (os testes seguintes contam com o período sem lançamento da apuração).
    expect(ap.simulacao).toBe(false);
    // Nem pela rota genérica: a origem apuração só sai pela apuração aprovada.
    const g = await post(a, '/repasse/lancamentos', {
      origem: 'apuracao',
      empresa: 1,
      competencia,
      data: hoje,
      evento: 40,
      tipo: 'M',
      prestador: 7001,
      profissional: 17001,
      valor: 333,
      apuracao: id,
      justificativa: 'Total do prestador na apuração',
    });
    expect(g.statusCode).toBe(409);
    expect(g.json().codigo).toBe('origem-pela-apuracao');
    const ls = (await get(a, `/repasse/lancamentos?competencia=${competencia}`)).json() as unknown[];
    expect(ls).toEqual([]);
  });

  it('o ajuste avulso pelo registro da busca; a busca de médicos é do setor (o médico do extrato não usa)', async () => {
    const a = await entrar('SINT.REP.ANALISTA');
    const b = (await get(a, '/repasse/prestadores?termo=sintetico%20a')).json() as {
      prestador: number;
      registro: number;
      nome: string;
    }[];
    expect(b).toEqual([
      { prestador: 7001, registro: 17001, nome: 'MEDICO SINTETICO A', conselho: '7001/SP' },
    ]);
    expect((await get(a, '/repasse/prestadores?termo=7002')).json()[0].registro).toBe(17002);
    const m = await entrar('SINT.REP.MEDICO');
    expect((await get(m, '/repasse/prestadores?termo=7001')).statusCode).toBe(403);
    const r = await post(a, '/repasse/lancamentos', {
      origem: 'ajuste',
      empresa: 1,
      competencia,
      data: hoje,
      evento: 40,
      tipo: 'M',
      prestador: b[0]!.prestador,
      profissional: b[0]!.registro,
      valor: 333,
      justificativa: 'Ajuste sintético do repasse do médico A',
    });
    expect(r.statusCode, r.body).toBe(200);
    const ls = (await get(a, `/repasse/lancamentos?competencia=${competencia}`)).json() as {
      valor: number;
      registro: number | null;
    }[];
    expect(ls).toMatchObject([{ valor: 333, registro: 17001 }]);
  });

  it('estorno por glosa ligado ao original; o que passa do original é recusado', async () => {
    const a = await entrar('SINT.REP.ANALISTA');
    const base = {
      origem: 'estorno',
      empresa: 1,
      competencia,
      data: hoje,
      evento: 40,
      tipo: 'M',
      prestador: 7001,
      profissional: 17001,
      estornaDe: 51,
      justificativa: 'Glosa mantida do convênio sintético',
    };
    const ok = await post(a, '/repasse/lancamentos', { ...base, valor: -100 });
    expect(ok.statusCode, ok.body).toBe(200);
    const demais = await post(a, '/repasse/lancamentos', { ...base, valor: -900 });
    expect(demais.statusCode).toBe(409);
    // D-ESTORNO-33: no período do original (ou antes) é recusado.
    const mesmo = await post(a, '/repasse/lancamentos', {
      ...base,
      competencia: '2026-05',
      data: '2026-05-20',
      valor: -10,
    });
    expect(mesmo.statusCode).toBe(409);
    expect(mesmo.json().codigo).toBe('estorno-fora-do-periodo');
    const ls = (await get(a, `/repasse/lancamentos?competencia=${competencia}`)).json() as {
      valor: number;
      estornaDe: number | null;
    }[];
    expect(ls.find((x) => x.valor === -100)?.estornaDe).toBe(51);
  });

  it('regras 7 e 8: o RPA com as retenções escritas e o título no contas a pagar; já em RPA é recusado', async () => {
    const a = await entrar('SINT.REP.ANALISTA');
    const ls = (await get(a, `/repasse/lancamentos?competencia=${competencia}&prestador=7001`)).json() as {
      id: number;
      valor: number;
    }[];
    const pedido = {
      empresa: 1,
      competencia,
      tipo: 'M',
      prestador: 7001,
      profissional: 17001,
      lancamentos: ls.filter((l) => l.valor > 0).map((l) => l.id),
      emissao: hoje,
      vencimento: hoje,
    };
    const prr = await post(a, '/repasse/rpas/previa', pedido);
    expect(prr.statusCode, prr.body).toBe(200);
    const pr = prr.json();
    // Bruto 333,00: INSS 11% = 36,63; base do IRRF 296,37 (isento); ISS 5% = 16,65; líquido 279,72.
    expect(pr.retencoes).toMatchObject({ bruto: 333, inss: 36.63, irrf: 0, iss: 16.65, liquido: 279.72 });
    expect(pr.retencoes.conta).toContain('= R$ 279,72');
    // Operação crítica: sem a senha, a reautenticação é exigida e nada é emitido.
    const sem = await post(a, '/repasse/rpas', pedido);
    expect(sem.statusCode).toBe(401);
    expect(sem.json().codigo ?? sem.json().type).toMatch(/reautenticacao-necessaria/);
    const errada = await post(a, '/repasse/rpas', { ...pedido, senha: 'errada' });
    expect(errada.statusCode).toBe(401);
    const r = await post(a, '/repasse/rpas', { ...pedido, senha: SENHA });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().ids.titulo).toBeGreaterThan(0);
    // O documento é o RPA emitido, relido (número, série, parcelas, título, contribuinte com o CPF mascarado).
    const doc = await get(a, `/repasse/rpas/${r.json().ids.rpa}/pdf`);
    expect(doc.statusCode).toBe(200);
    expect(String(doc.headers['content-type'])).toMatch(/application\/pdf|text\/html/);
    const relido = await repasse.rpaDetalhe({ cliente: 'sintetico', estabelecimento: null, usuario: null, correlacao: 'teste', hospital: 'aa' } as never, Number(r.json().ids.rpa));
    const html = htmlRpaEmitido({ ...relido!, eventos: new Map([[40, 'Honorários']]) });
    expect(html).toContain(`RPA nº ${r.json().ids.numero}`);
    expect(html).toContain('MEDICO SINTETICO A');
    expect(html).toContain('***.***.***-00');
    expect(html).toContain('= R$ 279,72');
    expect(html).toContain(`Título a pagar ${r.json().ids.titulo}`);
    expect((await get(a, '/repasse/rpas/999999/pdf')).statusCode).toBe(404);
    const t = (await get(a, `/financeiro/pagar/titulos?credor=7001`)).json();
    expect(JSON.stringify(t)).toContain('279.72');
    const de = await post(a, '/repasse/rpas', { ...pedido, senha: SENHA });
    expect(de.statusCode).toBe(409);
  });

  it('regra 12: o extrato é só do próprio médico; quem não tem vínculo vê a lista vazia', async () => {
    const m = await entrar('SINT.REP.MEDICO');
    const e = (await get(m, '/repasse/meu-extrato')).json();
    expect(e.prestadores).toEqual([7001]);
    expect(e.lancamentos.every((l: { prestador: number }) => l.prestador === 7001)).toBe(true);
    expect(e.lancamentos.length).toBeGreaterThan(0);
    // O filtro de competência: só a de maio (o lançamento 51 pago pelo RPA sintético).
    const maio = (await get(m, '/repasse/meu-extrato?competencia=2026-05')).json();
    expect(maio.competencia).toBe('2026-05');
    expect(maio.lancamentos.map((l: { id: number }) => l.id)).toEqual([51]);
    expect((await get(m, '/repasse/meu-extrato?competencia=2026-13')).statusCode).toBe(400);
    // A conta de cada valor: a memória de cálculo da apuração, só dos itens do próprio médico.
    const conta = (await get(m, `/repasse/meu-extrato/conta?competencia=${competencia}`)).json();
    expect(conta.demonstrativos.map((d: { prestador: number }) => d.prestador)).toEqual([7001]);
    expect(
      conta.demonstrativos[0].itens.every((i: { beneficiario: number }) => i.beneficiario === 7001),
    ).toBe(true);
    expect(conta.demonstrativos[0].itens[0].conta).toMatch(/× 18,5000% =/);
    const outro = await entrar('SINT.REP.SUPERVISOR');
    const v = (await get(outro, '/repasse/meu-extrato')).json();
    expect(v).toEqual({
      prestadores: [],
      competencia: null,
      lancamentos: [],
      rpas: [],
      total: 0,
      adiantamentos: 0,
    });
    expect((await get(outro, `/repasse/meu-extrato/conta?competencia=${competencia}`)).json()).toEqual({
      competencia,
      demonstrativos: [],
    });
  });

  it('regras: filtro por procedimento e profissional, e a página seguinte por keyset (depoisDe)', async () => {
    const a = await entrar('SINT.REP.ANALISTA');
    const todas = (await get(a, '/repasse/regras?convenio=302')).json();
    expect(todas.regras.map((r: { id: number }) => r.id)).toContain(9003);
    expect(todas.depoisDe).toBeNull();
    const do7001 = (await get(a, '/repasse/regras?convenio=301&profissional=7001')).json();
    expect(
      do7001.regras.every((r: { prestador: number | null }) => r.prestador === null || r.prestador === 7001),
    ).toBe(true);
    expect(do7001.regras.some((r: { prestador: number | null }) => r.prestador === 7001)).toBe(true);
  });

  it('a página das regras: com mais linhas que a página, devolve depoisDe e o pedido seguinte continua', async () => {
    const regras = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1 }));
    const porta = {
      regras: async (_c: unknown, f: { depoisDe: number; teto?: number }) =>
        regras.filter((r) => r.id > f.depoisDe).slice(0, f.teto ?? 3000),
      regrasUsadas: async () => new Set<number>(),
    };
    const sv = new ServicoRepasse(porta as never, new RegistradorTrilhaMemoria(), null, null);
    const s = { porta: { cliente: 'sintetico', estabelecimento: null, usuario: null, correlacao: 'teste', hospital: 'aa' } as never } as never;
    const p1 = await sv.regras(s, { convenio: 1, data: '2026-10-01', depoisDe: 0 });
    expect([p1.regras.length, p1.depoisDe]).toEqual([500, 500]);
    const p3 = await sv.regras(s, { convenio: 1, data: '2026-10-01', depoisDe: 1000 });
    expect([p3.regras.length, p3.depoisDe]).toEqual([200, null]);
  });

  it('as mensagens não citam o outro sistema pelo nome', async () => {
    const a = await entrar('SINT.REP.ANALISTA');
    const r = await post(a, '/repasse/apuracoes', { empresa: 1, competencia: '2026-06' });
    const p = r.json() as { title: string; detail: string };
    expect(`${p.title} ${p.detail}`).not.toMatch(SISTEMA_ANTIGO);
  });
});
