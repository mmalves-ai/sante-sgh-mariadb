// M54 (etapa 1, F1) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a banco):
// a contabilidade nasce desligada (o apoio diz o motivo e o pré-requisito; o resto dá 403 recurso-desligado); ligada
// pelo administrador, o plano na ordem da árvore com os problemas, a inclusão com as regras do plano (pai ausente,
// código repetido), a alteração sobre a versão vista (com a trilha dos campos mudados), a desativação da sintética com
// filhas ativas recusada, a simulação sem gravar, a publicação com a senha (versão errada e regra com problema
// recusadas; a anterior fica substituída), os fatos e o resumo por fonte (sem nome de tabela), o reprocessamento
// idêntico (conferência e gravação das situações) e quem só consulta. Dados SINTÉTICOS.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
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
  'idempotency-key': `teste-m54-1-${++n}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: h(s), payload: payload as object });

const C = '/api/contabil';

async function ligar(admin: Sessao, ligarChave = true) {
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
    ligar: ligarChave,
    justificativa: 'ligação sintética de teste da contabilidade',
    senha: SENHA,
  });
  expect(r.statusCode, r.body).toBe(200);
}

const regra = (extra: Record<string, unknown> = {}) => ({
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
  ...extra,
});

describe('contabilidade (etapa 1, F1), pela HTTP', { timeout: 120_000 }, () => {
  it('desligada: o apoio diz o motivo e o pré-requisito; o resto dá 403 recurso-desligado; sem perfil, 403', async () => {
    const c = await entrar('SINT.CONTADOR');
    const a = await get(c, `${C}/apoio`);
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json()).toMatchObject({
      ligada: false,
      podeEditar: true,
      podePublicar: true,
      podeVerFatos: true,
    });
    expect(a.json().motivo).toMatch(/desligada.*Pré-requisito: Uma competência contabilizada/);
    expect(JSON.stringify(a.json())).not.toMatch(/SPDATA|legado|sistema atual/i);
    const p = await get(c, `${C}/plano`);
    expect(p.statusCode).toBe(403);
    expect(p.json().codigo).toBe('recurso-desligado');
    expect((await post(c, `${C}/plano/contas`, {})).statusCode).toBe(400);
    expect((await get(c, `${C}/fatos/resumo`)).statusCode).toBe(403);
    expect((await get(await entrar('SINT.FATURAMENTO'), `${C}/apoio`)).statusCode).toBe(403);
  });

  it('ligada: plano, inclusão, alteração, simulação, publicação, fatos, resumo e reprocessamento', async () => {
    await ligar(await entrar('SINT.ADMIN'));
    const c = await entrar('SINT.CONTADOR');
    const apoio = (await get(c, `${C}/apoio`)).json();
    expect(apoio).toMatchObject({ ligada: true, motivo: null, empresas: [1], mascara: '9.9.9.99.9999' });
    expect(apoio.origens).toContainEqual({ id: 3, rotulo: 'Convênio' });
    expect(apoio.tiposFato).toContainEqual({ codigo: 'folha', origem: 8, rotulo: 'Folha e encargos' });
    expect(apoio.tiposPlanoReferencial).toHaveLength(3);

    // Plano na ordem da árvore (pai antes dos filhos), coerente.
    const plano = (await get(c, `${C}/plano?empresa=1`)).json();
    expect(plano.contas.map((x: { codigo: string }) => x.codigo).slice(0, 5)).toEqual([
      '1',
      '1.1',
      '1.1.2',
      '1.1.2.01',
      '1.1.2.01.0001',
    ]);
    expect(plano.contas[4]).toMatchObject({ nivel: 5, pai: '1.1.2.01', versao: 1 });
    expect(plano.problemas.filter((x: { gravidade: string }) => x.gravidade === 'erro')).toEqual([]);

    // Inclusão: pai ausente recusa; a conta nova entra; o código repetido recusa.
    const nova = {
      empresa: 1,
      codigo: '3.1.1.01.0002',
      nome: 'Receita de particulares',
      grupo: 'receita',
      tipo: 'analitica',
      natureza: 'credora',
    };
    const orfa = await post(c, `${C}/plano/contas`, { ...nova, codigo: '3.1.1.02.0001' });
    expect(orfa.statusCode, orfa.body).toBe(409);
    expect(orfa.json().codigo).toBe('conta-incoerente');
    const inc = await post(c, `${C}/plano/contas`, nova);
    expect(inc.statusCode, inc.body).toBe(200);
    expect(inc.json()).toMatchObject({ ok: true, versao: 1 });
    expect((await post(c, `${C}/plano/contas`, nova)).json().codigo).toBe('conta-ja-existe');
    expect(trilha.eventos.some((e) => e.evento === EVENTOS_AUDITAVEIS.contabilContaIncluida.codigo)).toBe(
      true,
    );

    // Alteração sobre a versão vista; versão velha recusa; nada mudou recusa; sintética com filha ativa não desativa.
    const alt = await post(c, `${C}/plano/contas/alterar`, {
      empresa: 1,
      codigo: '3.1.1.01.0002',
      versao: 1,
      nome: 'Receita de atendimentos particulares',
    });
    expect(alt.statusCode, alt.body).toBe(200);
    expect(alt.json().versao).toBe(2);
    const velha = await post(c, `${C}/plano/contas/alterar`, {
      empresa: 1,
      codigo: '3.1.1.01.0002',
      versao: 1,
      ativa: false,
    });
    expect(velha.statusCode).toBe(409);
    expect(velha.json().codigo).toBe('conta-desatualizada');
    expect(
      (
        await post(c, `${C}/plano/contas/alterar`, {
          empresa: 1,
          codigo: '3.1.1.01.0002',
          versao: 2,
          nome: 'Receita de atendimentos particulares',
        })
      ).json().codigo,
    ).toBe('nada-mudou');
    expect(
      (
        await post(c, `${C}/plano/contas/alterar`, {
          empresa: 1,
          codigo: '3.1.1.01',
          versao: 1,
          ativa: false,
        })
      ).json().codigo,
    ).toBe('sintetica-com-filhas-ativas');
    expect(
      (await post(c, `${C}/plano/contas/alterar`, { empresa: 1, codigo: '9.9', versao: 1, ativa: false }))
        .statusCode,
    ).toBe(404);

    // Simulação sem gravar: 2 fatos do convênio 5 contabilizados; o do convênio 6 sem conta (de-para vazio).
    const sim = await post(c, `${C}/regras/simular`, { regra: regra(), competencia: '2026-10' });
    expect(sim.statusCode, sim.body).toBe(200);
    expect(sim.json()).toMatchObject({
      fatos: 3,
      parcial: false,
      porSituacao: { contabilizado: 2, semConta: 1 },
      totais: { debitos: 212_550, creditos: 212_550, equilibrado: true },
      problemasDaPublicacao: [],
    });
    expect(sim.json().totais.parcelas).toEqual([
      { lado: 'D', conta: '1.1.2.01.0001', valorCentavos: 212_550 },
      { lado: 'C', conta: '3.1.1.01.0001', valorCentavos: 212_550 },
    ]);
    expect(porta.regrasGravadas).toHaveLength(0);

    // Publicação: versão errada e conta sintética recusam; a versão 1 entra; a 2 substitui.
    const errada = await post(c, `${C}/regras/publicar`, {
      regra: regra({ versao: 2 }),
      justificativa: 'Primeira regra da receita das contas.',
      senha: SENHA,
    });
    expect(errada.statusCode).toBe(409);
    expect(errada.json().detail).toMatch(/versão tem de ser 1/);
    const pub = await post(c, `${C}/regras/publicar`, {
      regra: regra(),
      justificativa: 'Primeira regra da receita das contas.',
      senha: SENHA,
    });
    expect(pub.statusCode, pub.body).toBe(200);
    expect(pub.json()).toMatchObject({ ok: true, versao: 1 });
    expect(pub.json().impressao).toMatch(/^[0-9a-f]{64}$/);
    const pub2 = await post(c, `${C}/regras/publicar`, {
      regra: regra({ versao: 2, vigenciaInicio: '2026-11-01' }),
      justificativa: 'Segunda versão a partir de novembro.',
      senha: SENHA,
    });
    expect(pub2.statusCode, pub2.body).toBe(200);
    const rs = (await get(c, `${C}/regras?empresa=1&origem=3`)).json();
    expect(
      rs.itens.map((x: { regra: { versao: number }; situacao: string }) => [x.regra.versao, x.situacao]),
    ).toEqual([
      [1, 'substituida'],
      [2, 'publicada'],
    ]);
    expect(
      trilha.eventos.filter((e) => e.evento === EVENTOS_AUDITAVEIS.contabilRegraPublicada.codigo),
    ).toHaveLength(2);

    // Fatos e resumo: rótulos de produto, nunca o nome da tabela.
    const fatos = (await get(c, `${C}/fatos?situacao=pendente&tamanho=2`)).json();
    expect(fatos).toMatchObject({ total: 3, pagina: 1, tamanho: 2 });
    expect(fatos.itens[0]).toMatchObject({
      fonte: 'Contas dos pacientes (receita)',
      situacaoRotulo: 'Aguardando contabilização',
    });
    expect((await get(c, `${C}/fatos?situacao=xpto`)).statusCode).toBe(400);
    const resumo = (await get(c, `${C}/fatos/resumo`)).json();
    expect(resumo.totais).toEqual({ pendente: 3 });
    expect(resumo.fontes).toHaveLength(12); // 9 da F1 + a depreciação (M54.6) + o impairment (W0-08) + o repasse (C2-093, 1dfabdc7)
    expect(JSON.stringify(resumo)).not.toMatch(/FCCTAEXT|MFCONPAG|SGH_/);

    // Reprocessamento: a conferência não grava; a gravação muda as situações; reaplicar dá zero mudança.
    const conf = await post(c, `${C}/periodos/reprocessar`, { empresa: 1, competencia: '2026-10' });
    expect(conf.statusCode, conf.body).toBe(200);
    expect(conf.json()).toMatchObject({
      identico: true,
      fatos: 3,
      // Etapa 2 (D-REPROC-542): os dois contabilizáveis seguem pendentes (a contabilização grava o lançamento).
      situacoesAlteradas: 1,
      somenteConferir: true,
    });
    expect(porta.fatosGravados.every((f) => f.situacao === 'pendente')).toBe(true);
    const grav = await post(c, `${C}/periodos/reprocessar`, {
      empresa: 1,
      competencia: '2026-10',
      somenteConferir: false,
      senha: SENHA,
    });
    expect(grav.statusCode, grav.body).toBe(200);
    expect(porta.fatosGravados.map((f) => f.situacao)).toEqual(['pendente', 'pendente', 'semConta']);
    expect(porta.fatosGravados[0]!.regraId).toBeNull();
    const de_novo = await post(c, `${C}/periodos/reprocessar`, { empresa: 1, competencia: '2026-10' });
    expect(de_novo.json()).toMatchObject({ identico: true, situacoesAlteradas: 0 });
  });

  it('quem só consulta lê o plano e as regras, mas não inclui, não publica e não vê os fatos', async () => {
    const q = await entrar('SINT.CONTABIL.CONSULTA');
    const a = (await get(q, `${C}/apoio`)).json();
    expect(a, JSON.stringify(a).slice(0, 300)).toMatchObject({
      podeEditar: false,
      podePublicar: false,
      podeVerFatos: false,
    });
    expect((await get(q, `${C}/plano`)).statusCode).toBe(200);
    expect((await get(q, `${C}/regras`)).statusCode).toBe(200);
    expect((await post(q, `${C}/plano/contas`, { empresa: 1 })).statusCode).toBe(403);
    expect(
      (await post(q, `${C}/regras/publicar`, { regra: regra({ versao: 3 }), justificativa: 'x'.repeat(12) }))
        .statusCode,
    ).toBe(403);
    expect((await get(q, `${C}/fatos`)).statusCode).toBe(403);
    // A simulação mostra os fatos um a um: sem contabil.fato.ler, 403 (o apoio diz podeVerFatos: false e a tela esconde).
    const sim = await post(q, `${C}/regras/simular`, { regra: regra({ versao: 3 }), competencia: '2026-10' });
    expect(sim.statusCode, sim.body).toBe(403);
    expect((await get(q, `${C}/fatos/apoio`)).statusCode).toBe(403);
  });

  it('quem só acompanha os fatos abre a tela dos fatos pelo apoio dela, sem o plano, as regras nem a simulação', async () => {
    const f = await entrar('SINT.CONTABIL.FATOS');
    const a = await get(f, `${C}/fatos/apoio`);
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json()).toMatchObject({
      ligada: true,
      podeVerFatos: true,
      podeEditar: false,
      podePublicar: false,
    });
    expect((a.json() as { tiposFato: unknown[] }).tiposFato.length).toBeGreaterThan(0);
    const l = await get(f, `${C}/fatos`);
    expect(l.statusCode, l.body).toBe(200);
    expect((await get(f, `${C}/fatos/resumo`)).statusCode).toBe(200);
    expect((await get(f, `${C}/apoio`)).statusCode).toBe(403);
    expect((await get(f, `${C}/plano`)).statusCode).toBe(403);
    const sim = await post(f, `${C}/regras/simular`, { regra: regra({ versao: 3 }), competencia: '2026-10' });
    expect(sim.statusCode, sim.body).toBe(403);
  });
});
