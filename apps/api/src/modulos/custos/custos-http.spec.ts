// M54.4 pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a banco): cada rota da
// estrutura de custos pela permissão da opção do outro sistema. O analista de custos (Gestão de custos: Tabelas,
// Buscar produção, Consultas) lê, classifica, coleta e lança; quem só consulta o centro de custo (321) lê e não grava;
// quem não tem nenhuma opção de custos não abre nada. A chave `custos` está ligada na sessão sintética.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { ContextoModulo } from '../registro.js';
import { moduloCustos, type OpcoesModuloCustos } from './modulo.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { CHAVE_LIBERACAO_CUSTOS } from './custos.controller.js';
import { PortaCustosMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'custos' };
/** O módulo dos custos registrado com as opções do teste (o registro real é o do integrador da onda). */
const registro = (o: OpcoesModuloCustos = {}) => ({
  custos: async () => ({ modulo: (ctx: ContextoModulo) => moduloCustos(ctx, { pdf: null, ...o }) }),
});
let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, registro: registro() });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

const csrfDe = new Map<string, string>();
async function entrar(login: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  const cookie = set.map((c) => c.split(';')[0]).join('; ');
  csrfDe.set(
    cookie,
    set
      .find((c) => c.startsWith('sgh_csrf='))
      ?.split(';')[0]
      ?.slice(9) ?? '',
  );
  return cookie;
}
const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const post = (cookie: string, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '' },
    payload: payload as Record<string, unknown>,
  });

const P = '/api/custos';
const LEITURAS = [`${P}/apoio`, `${P}/centros`, `${P}/estatisticas?competencia=2026-03`] as const;

describe('custos: cada rota pela sua permissão', { timeout: 180_000 }, () => {
  it('leituras: o analista e a consulta abrem; sem opção de custos, 403', async () => {
    for (const login of ['SINT.CUSTOS', 'SINT.CUSTOS.CONSULTA']) {
      const c = await entrar(login);
      for (const url of LEITURAS) expect((await get(c, url)).statusCode, `${login} ${url}`).toBe(200);
    }
    const sem = await entrar('SINT.ESOCIAL.CONSULTA');
    for (const url of LEITURAS) expect((await get(sem, url)).statusCode).toBe(403);
    expect((await post(sem, `${P}/centros/101`, { classe: 'produtivo', versao: null })).statusCode).toBe(403);
  });

  it('o apoio: classes, catálogo e as ações de quem pode', async () => {
    const a = (await get(await entrar('SINT.CUSTOS'), `${P}/apoio`)).json();
    expect(a).toMatchObject({
      liberacao: { ligada: true },
      acoes: { editar: true, registrarEstatistica: true },
    });
    expect(a.classes.map((c: { valor: string }) => c.valor)).toEqual([
      'produtivo',
      'auxiliar',
      'administrativo',
    ]);
    expect(a.estatisticas.length).toBeGreaterThanOrEqual(10);
    expect(a.gruposExportacao.map((g: { nome: string }) => g.nome)).toEqual([
      'Próprio',
      'ApuraSUS',
      'Federassantas',
    ]);
    const c = (await get(await entrar('SINT.CUSTOS.CONSULTA'), `${P}/apoio`)).json();
    expect(c.acoes).toEqual({ editar: false, registrarEstatistica: false });
  });

  it('consulta não grava: classificar, coletar e lançar são 403', async () => {
    const c = await entrar('SINT.CUSTOS.CONSULTA');
    expect((await post(c, `${P}/centros/101`, { classe: 'produtivo', versao: null })).statusCode).toBe(403);
    expect((await post(c, `${P}/estatisticas/coleta`, { competencia: '2026-03' })).statusCode).toBe(403);
    expect(
      (
        await post(c, `${P}/estatisticas/lancamentos`, {
          competencia: '2026-03',
          centro: 101,
          codigo: 'kgRoupa',
          quantidade: 1,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('classificar pela versão lida, com as pendências da estrutura; a trilha registra', async () => {
    const c = await entrar('SINT.CUSTOS');
    const antes = (await get(c, `${P}/centros`)).json();
    expect(antes.centros).toHaveLength(7);
    expect(antes.pendencias.map((p: { tipo: string }) => p.tipo)).toEqual(['sem-classe', 'sem-produtivo']);
    expect(antes.centros.find((x: { id: number }) => x.id === 106).sugestao).toBe('administrativo');
    const r = await post(c, `${P}/centros/101`, { classe: 'produtivo', versao: null });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      mudou: true,
      centro: { classificacao: { classe: 'produtivo', versao: 0 } },
    });
    expect(trilha.eventos.some((l) => l.evento === 'custos.centro.classificado')).toBe(true);
    const igual = await post(c, `${P}/centros/101`, { classe: 'produtivo', versao: 0 });
    expect(igual.json()).toMatchObject({ mudou: false });
    const velha = await post(c, `${P}/centros/101`, {
      classe: 'auxiliar',
      ordemRateio: 1,
      criterio: 'kgRoupa',
      versao: null,
    });
    expect(velha.statusCode).toBe(409);
    expect(velha.json()).toMatchObject({ codigo: 'desatualizado' });
    await post(c, `${P}/centros/104`, {
      classe: 'auxiliar',
      ordemRateio: 2,
      criterio: 'kgRoupa',
      versao: null,
    });
    await post(c, `${P}/centros/106`, {
      classe: 'administrativo',
      ordemRateio: 2,
      criterio: 'colaboradores',
      versao: null,
    });
    const depois = (await get(c, `${P}/centros`)).json();
    expect(depois.pendencias.map((p: { tipo: string }) => p.tipo)).toEqual(['sem-classe', 'ordem-repetida']);
    expect(depois.sequencia.map((x: { id: number }) => x.id)).toEqual([104, 106]);
    expect(depois.contagem).toMatchObject({
      produtivo: 1,
      auxiliar: 1,
      administrativo: 1,
      semClasse: 3,
      total: 6,
    });
  });

  it('entrada inválida 400; centro inexistente 404; inativo 409; unidade fora do cadastro 400', async () => {
    const c = await entrar('SINT.CUSTOS');
    const sem = await post(c, `${P}/centros/105`, { classe: 'auxiliar', versao: null });
    expect(sem.statusCode).toBe(400);
    expect(sem.json().campos).toEqual(expect.arrayContaining(['ordemRateio', 'criterio']));
    expect((await post(c, `${P}/centros/999999`, { classe: 'produtivo', versao: null })).statusCode).toBe(
      404,
    );
    expect((await post(c, `${P}/centros/107`, { classe: 'produtivo', versao: null })).json()).toMatchObject({
      codigo: 'centro-inativo',
    });
    expect(
      (await post(c, `${P}/centros/102`, { classe: 'produtivo', unidadeMensuracao: 55, versao: null }))
        .statusCode,
    ).toBe(400);
    expect((await get(c, `${P}/estatisticas?competencia=2026-13`)).statusCode).toBe(400);
  });

  it('coletar a competência: paciente-dia estimado (censo incompleto), horas de sala, exames; a matriz com os totais', async () => {
    const c = await entrar('SINT.CUSTOS');
    const r = await post(c, `${P}/estatisticas/coleta`, { competencia: '2026-03' });
    expect(r.statusCode, r.body).toBe(201);
    const k = r.json();
    expect(k).toMatchObject({ competencia: '2026-03', substituidas: 0 });
    expect(k.gravadas).toBeGreaterThan(0);
    expect(k.fontes.find((f: { fonte: string }) => f.fonte === 'internacoes')).toMatchObject({
      estimada: true,
      semCentro: 1,
    });
    const m = (await get(c, `${P}/estatisticas?competencia=2026-03`)).json();
    const uti = m.linhas.find((l: { centro: number }) => l.centro === 101);
    expect(uti.valores.pacienteDia).toMatchObject({ quantidade: 301, estimada: true, origem: 'coletada' });
    // Horas de sala: 20 × 1h30 + 12 × 45 min = 30 h + 9 h = 39 h.
    expect(m.totais.horasSala).toBe(39);
    expect(m.ultimaColeta).toMatchObject({ id: k.id });
    expect(m.avisos[0]).toContain('estimado');
    const outra = (await post(c, `${P}/estatisticas/coleta`, { competencia: '2026-03' })).json();
    expect(outra.substituidas).toBe(k.gravadas);
    expect((await post(c, `${P}/estatisticas/coleta`, { competencia: '2099-01' })).statusCode).toBe(400);
  });

  it('lançar à mão: o manual prevalece; a área (referência) vale na competência seguinte', async () => {
    const c = await entrar('SINT.CUSTOS');
    const l = await post(c, `${P}/estatisticas/lancamentos`, {
      competencia: '2026-03',
      centro: 101,
      codigo: 'pacienteDia',
      quantidade: 310,
      observacao: 'conferido no censo em papel',
    });
    expect(l.statusCode, l.body).toBe(201);
    expect(l.json()).toMatchObject({ substituidas: 0, valor: { quantidade: 310, origem: 'manual' } });
    await post(c, `${P}/estatisticas/lancamentos`, {
      competencia: '2026-03',
      centro: 104,
      codigo: 'areaM2',
      quantidade: 120.5,
    });
    const m3 = (await get(c, `${P}/estatisticas?competencia=2026-03`)).json();
    expect(m3.linhas.find((x: { centro: number }) => x.centro === 101).valores.pacienteDia).toMatchObject({
      quantidade: 310,
      origem: 'manual',
    });
    const m4 = (await get(c, `${P}/estatisticas?competencia=2026-04`)).json();
    expect(m4.linhas.find((x: { centro: number }) => x.centro === 104).valores.areaM2).toMatchObject({
      quantidade: 120.5,
      herdadaDe: '2026-03',
    });
    expect(
      (
        await post(c, `${P}/estatisticas/lancamentos`, {
          competencia: '2026-03',
          centro: 107,
          codigo: 'areaM2',
          quantidade: 1,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post(c, `${P}/estatisticas/lancamentos`, {
          competencia: '2026-03',
          centro: 101,
          codigo: 'kgRoupa',
          quantidade: 1.234,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(c, `${P}/estatisticas/lancamentos`, {
          competencia: '2026-03',
          centro: 999,
          codigo: 'kgRoupa',
          quantidade: 1,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('com a chave `custos` desligada (como no pc, POL-3): o apoio em consulta; classificar, coletar e lançar recusados sem gravar', async () => {
    // Uma app à parte, com a chave fora da configuração e a porta em memória que conta as gravações.
    const gravacoes: string[] = [];
    class PortaContada extends PortaCustosMemoria {
      override async classificar(...a: Parameters<PortaCustosMemoria['classificar']>) {
        gravacoes.push('classificar');
        return super.classificar(...a);
      }
      override async gravarColeta(...a: Parameters<PortaCustosMemoria['gravarColeta']>) {
        gravacoes.push('coleta');
        return super.gravarColeta(...a);
      }
      override async lancar(...a: Parameters<PortaCustosMemoria['lancar']>) {
        gravacoes.push('lancar');
        return super.lancar(...a);
      }
    }
    const trilhaB = new RegistradorTrilhaMemoria();
    const configuracao = fonteConfiguracaoMemoria(trilhaB, {
      chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== CHAVE_LIBERACAO_CUSTOS),
      prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      parametrosIniciais: parametrosIniciaisSinteticos,
    });
    const b = await criarApp(lerConfiguracao(env), null, env, {
      trilha: trilhaB,
      registro: registro({ configuracao, porta: new PortaContada() }),
    });
    await b.init();
    await b.getHttpAdapter().getInstance().ready();
    try {
      const r = await b.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login: 'SINT.CUSTOS', senha: SENHA },
      });
      expect(r.statusCode).toBe(201);
      const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
      const cookie = set.map((x) => x.split(';')[0]).join('; ');
      const csrf =
        set
          .find((x) => x.startsWith('sgh_csrf='))
          ?.split(';')[0]
          ?.slice(9) ?? '';
      const apoio = (await b.inject({ method: 'GET', url: `${P}/apoio`, headers: { cookie } })).json();
      expect(apoio.liberacao).toMatchObject({ ligada: false });
      expect(apoio.acoes).toEqual({ editar: false, registrarEstatistica: false });
      const gravar = (url: string, payload: Record<string, unknown>) =>
        b.inject({ method: 'POST', url, headers: { cookie, 'x-csrf': csrf }, payload });
      const recusas = [
        await gravar(`${P}/centros/101`, { classe: 'produtivo', versao: null }),
        await gravar(`${P}/estatisticas/coleta`, { competencia: '2026-03' }),
        await gravar(`${P}/estatisticas/lancamentos`, {
          competencia: '2026-03',
          centro: 101,
          codigo: 'kgRoupa',
          quantidade: 1,
        }),
      ];
      for (const x of recusas) {
        expect(x.statusCode, x.body).toBe(403);
        expect(x.json().codigo).toBe('recurso-desligado');
        expect(String(x.json().detail ?? '')).not.toBe('');
      }
      expect(gravacoes).toEqual([]);
      const GRAVACOES = [
        'custos.centro.classificado',
        'custos.estatisticas.coletadas',
        'custos.estatistica.lancada',
      ];
      expect(
        trilhaB.eventos.filter((l) => GRAVACOES.includes(l.evento) && l.resultado === 'sucesso'),
      ).toEqual([]);
      const centros = (await b.inject({ method: 'GET', url: `${P}/centros`, headers: { cookie } })).json();
      expect(centros.centros.find((x: { id: number }) => x.id === 101).classificacao).toBeNull();
    } finally {
      await b.close();
    }
  });
});
