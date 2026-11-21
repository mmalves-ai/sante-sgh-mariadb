// M54 (etapa 2, F2) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a banco):
// desligada (o apoio diz o motivo; o resto dá 403); ligada, a contabilização dos fatos pendentes (lançamentos com a
// regra publicada, o sem conta recusado e depois contabilizado com o de-para completo), o lançamento manual (idempotente;
// problemas recusados), o razão com o saldo e a conferência, o encerramento impedido e depois feito com a senha, o
// lançamento em período encerrado recusado, o estorno (só um; estorno de estorno recusado), o fato de período encerrado
// levado ao primeiro aberto, a conciliação (e a desfeita), a reabertura do último encerrado e quem só consulta. Dados
// SINTÉTICOS.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { type ContextoModulo, REGISTRO_MODULOS } from '../registro.js';
import { moduloContabil } from './modulo.js';
import type { PortaContabil } from './porta.js';
import { PortaContabilMemoria } from './porta-memoria.js';

/** O módulo da contabilidade registrado com a porta do teste (o registro real é o do integrador da onda). */
const registroContabil = (p: PortaContabil) => ({
  ...REGISTRO_MODULOS,
  contabil: async () => ({ modulo: (ctx: ContextoModulo) => moduloContabil(ctx, { porta: p }) }),
});

const env: Record<string, string> = { ...envTeste, API_MODULOS: 'config,contabil', AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const porta = new PortaContabilMemoria();
porta.hojeFixo = '2026-11-10';
let app: NestFastifyApplication;
let n = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, registro: registroContabil(porta) });
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
  'idempotency-key': `teste-m54-2-${++n}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: h(s), payload: payload as object });

const C = '/api/contabil';
const UUID = '6f1c2d3e-4a5b-4c6d-8e7f-001122334455';

async function ligar(admin: Sessao) {
  const pre = await app.inject({
    method: 'PUT',
    url: '/api/administracao/liberacao/prerequisitos',
    headers: h(admin),
    payload: {
      recurso: 'contabil',
      tipo: 'aprovacao',
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'competência sintética conferida',
      senha: SENHA,
    },
  });
  expect(pre.statusCode, pre.body).toBe(200);
  const r = await post(admin, '/api/administracao/liberacao', {
    chave: 'contabil',
    tipo: 'recurso',
    escopo: 'hospital',
    valores: ['*'],
    ligar: true,
    justificativa: 'ligação sintética de teste da contabilidade',
    senha: SENHA,
  });
  expect(r.statusCode, r.body).toBe(200);
}

const REGRA = {
  empresa: 1,
  origem: 3,
  tipoFato: 'receitaConta',
  versao: 1,
  nome: 'Receita das contas',
  vigenciaInicio: '2026-10-01',
  vigenciaFim: null,
  prioridade: 100,
  condicoes: [],
  partidas: [
    {
      lado: 'D',
      conta: { modo: 'dePara', campoChave: 'convenio', contaPadrao: null },
      valor: { base: 'valorFato' },
      historico: 'Receita {documento}',
      centroCusto: 'nenhum',
    },
    {
      lado: 'C',
      conta: { modo: 'fixa', conta: '3.1.1.01.0001' },
      valor: { base: 'valorFato' },
      historico: 'Receita {documento}',
      centroCusto: 'doFato',
    },
  ],
};

const manual = (extra: Record<string, unknown> = {}) => ({
  empresa: 1,
  data: '2026-10-20',
  historico: 'Ajuste sintético de receita',
  idempotencia: UUID,
  partidas: [
    { lado: 'D', conta: '1.1.2.01.0001', valorCentavos: 100 },
    { lado: 'C', conta: '3.1.1.01.0001', valorCentavos: 100, centroCusto: 3 },
  ],
  ...extra,
});

describe('contabilidade (etapa 2, F2), pela HTTP', { timeout: 120_000 }, () => {
  it('desligada: o apoio diz o motivo; o resto dá 403 recurso-desligado; sem perfil, 403', async () => {
    const c = await entrar('SINT.CONTADOR');
    const a = await get(c, `${C}/lancamentos/apoio`);
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json()).toMatchObject({
      ligada: false,
      podeLancar: true,
      podeEstornar: true,
      podeConciliar: true,
      podeEncerrar: true,
      podeReabrir: true,
      contas: [],
    });
    expect(a.json().motivo).toMatch(/desligada/);
    expect((await get(c, `${C}/lancamentos?empresa=1`)).json().codigo).toBe('recurso-desligado');
    expect((await post(c, `${C}/lancamentos/contabilizar`, { empresa: 1 })).statusCode).toBe(403);
    expect((await get(await entrar('SINT.FATURAMENTO'), `${C}/lancamentos/apoio`)).statusCode).toBe(403);
  });

  it('o ciclo da competência: contabilizar, manual, razão, encerrar, estornar, conciliar, reabrir', async () => {
    await ligar(await entrar('SINT.ADMIN'));
    const c = await entrar('SINT.CONTADOR');
    const apoio = (await get(c, `${C}/lancamentos/apoio?empresa=1`)).json();
    expect(apoio.ligada).toBe(true);
    expect(apoio.hoje).toBe('2026-11-10');
    expect(apoio.contas.map((x: { codigo: string }) => x.codigo)).toContain('1.1.2.01.0001');
    expect(apoio.contas.some((x: { codigo: string }) => x.codigo === '1.1')).toBe(false);

    // Sem regra, os fatos ficam sem regra (nada lançado).
    const sem = await post(c, `${C}/lancamentos/contabilizar`, { empresa: 1 });
    expect(sem.statusCode, sem.body).toBe(200);
    expect(sem.json()).toMatchObject({ fatos: 3, lancamentos: 0, porSituacao: { semRegra: 3 } });

    const pub = await post(c, `${C}/regras/publicar`, {
      regra: REGRA,
      justificativa: 'Primeira regra da receita das contas.',
      senha: SENHA,
    });
    expect(pub.statusCode, pub.body).toBe(200);

    // Pendentes já não há; com os recusados, dois viram lançamento e um fica sem conta (de-para incompleto).
    expect((await post(c, `${C}/lancamentos/contabilizar`, { empresa: 1 })).json().fatos).toBe(0);
    const cont = await post(c, `${C}/lancamentos/contabilizar`, { empresa: 1, incluirRecusados: true });
    expect(cont.statusCode, cont.body).toBe(200);
    expect(cont.json()).toMatchObject({
      fatos: 3,
      lancamentos: 2,
      porSituacao: { contabilizado: 2, semConta: 1 },
      totais: { debitos: 212_550, creditos: 212_550 },
      restam: false,
    });
    expect(trilha.eventos.some((l) => l.evento === 'contabil.fatos.contabilizados')).toBe(true);

    const lista = await get(c, `${C}/lancamentos?empresa=1&competencia=2026-10`);
    expect(lista.statusCode, lista.body).toBe(200);
    expect(lista.json().total).toBe(2);
    const id1 = lista.json().itens.at(-1).id as number;
    const det = await get(c, `${C}/lancamentos/detalhe?empresa=1&id=${id1}`);
    expect(det.statusCode, det.body).toBe(200);
    expect(det.json()).toMatchObject({
      tipo: 'automatico',
      tipoRotulo: 'Automático (dos módulos)',
      tipoFatoRotulo: 'Receita da conta fechada',
      fato: { fonte: 'Contas dos pacientes (receita)' },
      regra: { nome: 'Receita das contas', versao: 1 },
      estornavel: true,
    });
    expect(
      det.json().partidas.map((p: { lado: string; contaNome: string }) => [p.lado, p.contaNome]),
    ).toEqual([
      ['D', 'Convênios a receber'],
      ['C', 'Receita de convênios'],
    ]);
    expect(JSON.stringify(det.json())).not.toMatch(/FCCTAEXT|SGH_|SPDATA|legado/);
    expect((await get(c, `${C}/lancamentos/detalhe?empresa=1&id=999999`)).statusCode).toBe(404);

    // Manual: idempotente pela chave; a conta sintética e o centro de custo faltando são recusados.
    const m1 = await post(c, `${C}/lancamentos/manual`, manual());
    expect(m1.statusCode, m1.body).toBe(200);
    const m2 = await post(c, `${C}/lancamentos/manual`, manual());
    expect(m2.json()).toMatchObject({ id: m1.json().id });
    expect(m2.json().mensagem).toMatch(/já estava gravado/);
    const ruim = await post(
      c,
      `${C}/lancamentos/manual`,
      manual({
        idempotencia: '6f1c2d3e-4a5b-4c6d-8e7f-001122334466',
        partidas: [
          { lado: 'D', conta: '1.1', valorCentavos: 100 },
          { lado: 'C', conta: '3.1.1.01.0001', valorCentavos: 100 },
        ],
      }),
    );
    expect(ruim.statusCode).toBe(409);
    expect(ruim.json().detail).toMatch(/sintética.*exige centro de custo/);
    expect((await post(c, `${C}/lancamentos/manual`, { empresa: 1 })).statusCode).toBe(400);

    // Razão: as parcelas e o saldo na natureza devedora.
    const raz = await get(c, `${C}/razao?empresa=1&conta=1.1.2.01.0001&de=2026-10-01&ate=2026-10-31`);
    expect(raz.statusCode, raz.body).toBe(200);
    expect(raz.json()).toMatchObject({
      saldoAnteriorCentavos: 0,
      debitosCentavos: 212_650,
      creditosCentavos: 0,
      saldoFinalCentavos: 212_650,
      parcial: false,
    });
    expect(raz.json().movimentos).toHaveLength(3);
    expect(raz.json().conferencia).toBe('0,00 + 2.126,50 (débitos) − 0,00 (créditos) = 2.126,50');
    expect((await get(c, `${C}/razao?empresa=1&conta=1.1&de=2026-10-01&ate=2026-10-31`)).statusCode).toBe(
      409,
    );
    expect((await get(c, `${C}/razao?empresa=1&conta=1.1&de=2026-10-01&ate=2027-12-31`)).statusCode).toBe(
      400,
    );

    // Encerrar: o fato sem conta impede; com o de-para completo, contabiliza e encerra (com a senha).
    const sit = await get(c, `${C}/periodos/situacao?empresa=1&competencia=2026-10`);
    expect(sit.statusCode, sit.body).toBe(200);
    expect(sit.json()).toMatchObject({ podeEncerrar: false, lancamentos: 3 });
    expect(sit.json().impedimentos.map((i: { codigo: string }) => i.codigo)).toEqual(['fatos-sem-conta']);
    expect(sit.json().parcelas.map((p: { tipo: string }) => p.tipo)).toEqual(['automatico', 'manual']);
    const imp = await post(c, `${C}/periodos/encerrar`, { empresa: 1, competencia: '2026-10', senha: SENHA });
    expect(imp.statusCode).toBe(409);
    expect(imp.json().codigo).toBe('encerramento-impedido');
    porta.contasDePara.set(6, 1101);
    const resto = await post(c, `${C}/lancamentos/contabilizar`, {
      empresa: 1,
      competencia: '2026-10',
      incluirRecusados: true,
    });
    expect(resto.json()).toMatchObject({ fatos: 1, lancamentos: 1 });
    expect((await get(c, `${C}/periodos/situacao?empresa=1&competencia=2026-10`)).json().podeEncerrar).toBe(
      true,
    );
    expect(
      (await get(c, `${C}/periodos/situacao?empresa=1&competencia=2026-11`)).json().impedimentos[0].codigo,
    ).toBe('futuro');
    const enc = await post(c, `${C}/periodos/encerrar`, { empresa: 1, competencia: '2026-10', senha: SENHA });
    expect(enc.statusCode, enc.body).toBe(200);
    expect(enc.json().situacao).toBe('encerrado');
    const ps = (await get(c, `${C}/periodos?empresa=1`)).json();
    expect(ps.itens[0]).toMatchObject({ competencia: '2026-10', situacao: 'encerrado', lancamentos: 4 });

    // Período encerrado não aceita lançamento; o estorno vai ao período aberto, uma vez só.
    const fechado = await post(
      c,
      `${C}/lancamentos/manual`,
      manual({ idempotencia: '6f1c2d3e-4a5b-4c6d-8e7f-001122334477', data: '2026-10-25' }),
    );
    expect(fechado.statusCode).toBe(409);
    expect(fechado.json()).toMatchObject({ codigo: 'periodo-encerrado' });
    expect(fechado.json().detail).toMatch(/10\/2026 está encerrado/);
    const est = await post(c, `${C}/lancamentos/estornar`, {
      empresa: 1,
      id: id1,
      justificativa: 'Conta lançada no convênio errado',
    });
    expect(est.statusCode, est.body).toBe(200);
    expect(est.json().competencia).toBe('2026-11');
    const idEst = est.json().id as number;
    const de2 = await post(c, `${C}/lancamentos/estornar`, {
      empresa: 1,
      id: id1,
      justificativa: 'Conta lançada no convênio errado',
    });
    expect(de2.json().codigo).toBe('ja-estornado');
    const deEst = await post(c, `${C}/lancamentos/estornar`, {
      empresa: 1,
      id: idEst,
      justificativa: 'Estorno do estorno não pode',
    });
    expect(deEst.json().codigo).toBe('estorno-de-estorno');
    expect((await get(c, `${C}/lancamentos/detalhe?empresa=1&id=${id1}`)).json()).toMatchObject({
      estornadoPor: idEst,
      estornavel: false,
    });

    // Fato novo de competência encerrada vai ao primeiro período aberto.
    const base = porta.fatosGravados[0]!;
    porta.fatosGravados.push({
      ...base,
      idFato: 50,
      id: 900_050,
      documento: 'conta 900050',
      impressao: 'sint000000000050',
      situacao: 'pendente',
      regraId: null,
      motivo: null,
    });
    const mov = await post(c, `${C}/lancamentos/contabilizar`, { empresa: 1 });
    expect(mov.json()).toMatchObject({ lancamentos: 1, movidosDePeriodo: 1 });
    expect(mov.json().mensagem).toMatch(/primeiro período aberto/);
    expect(
      (await get(c, `${C}/lancamentos?empresa=1&competencia=2026-11&tipo=automatico`)).json().total,
    ).toBe(1);

    // Conciliação: o débito do lançamento estornado com o crédito do estorno.
    const pend = await get(c, `${C}/conciliacao/pendentes?empresa=1&conta=1.1.2.01.0001`);
    expect(pend.statusCode, pend.body).toBe(200);
    const pd = pend.json().itens as { id: number; lancamento: number; lado: string }[];
    const par = [pd.find((p) => p.lancamento === id1)!.id, pd.find((p) => p.lancamento === idEst)!.id];
    const desequilibrada = await post(c, `${C}/conciliacao/registrar`, {
      empresa: 1,
      conta: '1.1.2.01.0001',
      partidas: [par[0], pd.find((p) => p.lancamento !== id1 && p.lado === 'D')!.id],
    });
    expect(desequilibrada.json().codigo).toBe('conciliacao-recusada');
    const conc = await post(c, `${C}/conciliacao/registrar`, {
      empresa: 1,
      conta: '1.1.2.01.0001',
      partidas: par,
    });
    expect(conc.statusCode, conc.body).toBe(200);
    const pend2 = (await get(c, `${C}/conciliacao/pendentes?empresa=1&conta=1.1.2.01.0001`)).json();
    expect(pend2.itens).toHaveLength(pd.length - 2);
    expect(
      (
        await post(c, `${C}/conciliacao/registrar`, { empresa: 1, conta: '1.1.2.01.0001', partidas: par })
      ).json().codigo,
    ).toBe('conciliacao-recusada');
    const desf = await post(c, `${C}/conciliacao/desfazer`, {
      empresa: 1,
      id: conc.json().id,
      justificativa: 'Conciliação sintética desfeita',
    });
    expect(desf.statusCode, desf.body).toBe(200);
    const cs = (await get(c, `${C}/conciliacao?empresa=1&conta=1.1.2.01.0001`)).json();
    expect(cs[0]).toMatchObject({ situacao: 'desfeita', partidas: 2, valorCentavos: 125_000 });

    // Reabrir o último encerrado (com a senha e a justificativa).
    const reab = await post(c, `${C}/periodos/reabrir`, {
      empresa: 1,
      competencia: '2026-10',
      justificativa: 'Nota de outubro chegou depois',
      senha: SENHA,
    });
    expect(reab.statusCode, reab.body).toBe(200);
    expect((await get(c, `${C}/periodos/situacao?empresa=1&competencia=2026-10`)).json().situacao).toBe(
      'aberto',
    );
    const de = await post(c, `${C}/periodos/reabrir`, {
      empresa: 1,
      competencia: '2026-10',
      justificativa: 'Nota de outubro chegou depois',
      senha: SENHA,
    });
    expect(de.json().codigo).toBe('reabertura-recusada');
    for (const ev of [
      'contabil.lancamento.incluido',
      'contabil.lancamento.estornado',
      'contabil.periodo.encerrado',
      'contabil.periodo.reaberto',
      'contabil.conciliacao.registrada',
      'contabil.conciliacao.desfeita',
    ])
      expect(
        trilha.eventos.some((l) => l.evento === ev),
        ev,
      ).toBe(true);
  });

  it('quem acompanha os fatos consulta os lançamentos, mas não lança; quem só vê o plano não os consulta', async () => {
    const f = await entrar('SINT.CONTABIL.FATOS');
    expect((await get(f, `${C}/lancamentos?empresa=1`)).statusCode).toBe(200);
    expect((await post(f, `${C}/lancamentos/manual`, manual())).statusCode).toBe(403);
    expect((await post(f, `${C}/periodos/encerrar`, { empresa: 1, competencia: '2026-10' })).statusCode).toBe(
      403,
    );
    const q = await entrar('SINT.CONTABIL.CONSULTA');
    expect((await get(q, `${C}/lancamentos?empresa=1`)).statusCode).toBe(403);
  });

  it('quem só tem a integração (83) abre a tela e os fatos; quem tem Integrar lançamentos (82) também contabiliza', async () => {
    const i83 = await entrar('SINT.CONTABIL.INTEGRA83');
    const a83 = await get(i83, `${C}/lancamentos/apoio?empresa=1`);
    expect(a83.statusCode, a83.body).toBe(200);
    expect(a83.json()).toMatchObject({ podeVerFatos: true, podeLancar: false });
    expect((await get(i83, `${C}/fatos`)).statusCode).toBe(200);
    expect((await post(i83, `${C}/lancamentos/contabilizar`, { empresa: 1 })).statusCode).toBe(403);
    const i82 = await entrar('SINT.CONTABIL.INTEGRA82');
    const a82 = await get(i82, `${C}/lancamentos/apoio?empresa=1`);
    expect(a82.statusCode, a82.body).toBe(200);
    expect(a82.json()).toMatchObject({ podeVerFatos: true, podeLancar: true });
    const c82 = await post(i82, `${C}/lancamentos/contabilizar`, { empresa: 1 });
    expect(c82.statusCode, c82.body).toBe(200);
  });

  it('D-FUTURO-542: lançamento manual e estorno com data futura são recusados com o código próprio', async () => {
    const c = await entrar('SINT.CONTADOR');
    const f = await post(
      c,
      `${C}/lancamentos/manual`,
      manual({ idempotencia: '6f1c2d3e-4a5b-4c6d-8e7f-0011223344aa', data: '2062-10-01' }),
    );
    expect(f.statusCode, f.body).toBe(409);
    expect(f.json()).toMatchObject({ codigo: 'data-futura' });
    expect(porta.f2.periodos(1).some((p) => p.competencia === '2062-10')).toBe(false);
    const l = await get(c, `${C}/lancamentos?empresa=1`);
    const alvo = (
      l.json() as { itens: { id: number; tipo: string; estornadoPor: number | null }[] }
    ).itens.find((x) => x.tipo === 'manual' && x.estornadoPor === null);
    expect(alvo).toBeDefined();
    const e = await post(c, `${C}/lancamentos/estornar`, {
      empresa: 1,
      id: alvo!.id,
      justificativa: 'Teste sintético de data futura',
      data: '2062-10-01',
    });
    expect(e.json().codigo).toBe('data-futura');
  });

  it('a corrida (D-CORRIDA-542): o fato que outra gravação mudou entre a leitura e a gravação fica como está', async () => {
    const c = await entrar('SINT.CONTADOR');
    const base = porta.fatosGravados[0]!;
    porta.fatosGravados.push({
      ...base,
      idFato: 9001,
      id: 990_001,
      data: '2026-11-05',
      competencia: '2026-11',
      impressao: 'sint-corrida-9001',
      situacao: 'pendente',
      motivo: null,
      regraId: null,
    });
    const doFato = () => porta.fatosGravados.find((f) => f.idFato === 9001)!;
    // Contabilizar: lê 9001 pendente; antes da gravação, outra transação o marca "sem regra".
    porta.antesDeGravar = () => {
      Object.assign(doFato(), { situacao: 'semRegra' });
    };
    const r = await post(c, `${C}/lancamentos/contabilizar`, { empresa: 1, competencia: '2026-11' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ fatos: 1, lancamentos: 0, mudaramDurante: 1, restam: true });
    expect(doFato().situacao).toBe('semRegra');
    expect(porta.f2.lancamentosDosFatos([9001]).size).toBe(0);
    // Reprocessar: lê 9001 "sem regra" (a regra o cobre: voltaria a pendente); antes da gravação, o worker o contabiliza.
    porta.antesDeGravar = () => {
      Object.assign(doFato(), { situacao: 'contabilizado' });
    };
    const rp = await post(c, `${C}/periodos/reprocessar`, {
      empresa: 1,
      competencia: '2026-11',
      somenteConferir: false,
      senha: SENHA,
    });
    expect(rp.statusCode, rp.body).toBe(200);
    expect(rp.json()).toMatchObject({ identico: true, mudaramDurante: 1 });
    expect(doFato().situacao).toBe('contabilizado');
    porta.antesDeGravar = null;
  });

  it('o reprocessamento compara a derivação com os lançamentos gravados dos fatos contabilizados', async () => {
    const c = await entrar('SINT.CONTADOR');
    const rp = await post(c, `${C}/periodos/reprocessar`, {
      empresa: 1,
      competencia: '2026-10',
      somenteConferir: true,
    });
    expect(rp.statusCode, rp.body).toBe(200);
    const g = (
      rp.json() as {
        gravado: { comparados: number; iguais: number; diferentes: number; semLancamento: number };
      }
    ).gravado;
    expect(g.comparados).toBeGreaterThan(0);
    expect(g.comparados).toBe(g.iguais + g.diferentes + g.semLancamento);
    expect(g.semLancamento).toBe(0);
  });
});
