// W1-01 (parte 9b): API das contas dormentes sobre a app inteira (fonte da gestão em memória, estado sintético):
// prévia, exceção (incluir, trocar o prazo, retirar) com senha e motivo, rodada pela tela que bloqueia pelo executor e
// poupa a exceção, trilha sem senha; e o despertar diário (uma rodada por estabelecimento por dia; desligada: nada).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PADRAO_DORMENCIA, type ParametrosDormencia } from '@sgh/dominio-acesso';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { ContasDormentesController } from './contas-dormentes.controller.js';
import { DespertarContasDormentes, type ServicoContasDormentes } from './contas-dormentes.js';
import { estadoAcessoSintetico, reiniciarEstadoAcessoSintetico } from './fonte-sintetica.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;
const cookies = new Map<string, string>();
const URL = '/api/acesso/gestao/contas-dormentes';

const dia = (deslocamento: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(Date.now() - deslocamento * 86_400_000),
  );
const cab = () => ({
  cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
  'x-csrf': cookies.get('sgh_csrf') ?? '',
  'idempotency-key': `teste-dormentes-${++chave}-${Date.now()}`,
});

beforeAll(async () => {
  reiniciarEstadoAcessoSintetico();
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem: new ArmazemMemoria() });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    headers: { host: 'localhost' },
    payload: { estabelecimento: 'aa', login: 'SINT.GESTOR', senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = r.headers['set-cookie'];
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [par] = c.split(';');
    const i = par?.indexOf('=') ?? -1;
    if (par && i > 0) cookies.set(par.slice(0, i), par.slice(i + 1));
  }
});
afterAll(async () => {
  await app.close();
  reiniciarEstadoAcessoSintetico();
});

interface Tela {
  hoje: string;
  parametros: { ligada: boolean; diasPessoal: number };
  previa: { login: string; situacao: string; diasSemAcesso: number | null }[];
  poupadas: { login: string; situacao: string; motivoExcecao?: string }[];
  excecoes: { login: string; ate: string | null; motivo: string }[];
  historico: { login: string; situacao: string; criadoPor: string }[];
  bloqueio: { ligada: boolean };
}

describe('API das contas dormentes (W1-01 parte 9b)', () => {
  it('prévia, exceção com senha e motivo, rodada que bloqueia pelo executor e poupa a exceção; trilha sem senha', async () => {
    const est = estadoAcessoSintetico();
    const todas = [...est.contas.keys()].filter((l) => l.startsWith('SINT.') && l !== 'SINT.GESTOR');
    for (const l of est.contas.keys()) est.ultimoAcesso.set(l, dia(1));
    const [a, b] = todas.filter((l) => !(est.bloqueio.get(l) ?? false));
    expect(a && b).toBeTruthy();
    est.ultimoAcesso.set(a!, dia(400));
    est.ultimoAcesso.set(b!, dia(400));
    const ler = async () => (await app.inject({ method: 'GET', url: URL, headers: cab() })).json() as Tela;
    const t0 = await ler();
    expect(t0.hoje).toBe(dia(0));
    expect(t0.parametros).toMatchObject({ ligada: true, diasPessoal: 90 });
    expect(t0.previa.map((c) => c.login)).toEqual(expect.arrayContaining([a, b]));
    expect(t0.previa.find((c) => c.login === a)?.diasSemAcesso).toBe(400);
    expect(t0.excecoes).toEqual([]);

    const excecao = (extra: Record<string, unknown>, senha = SENHA) =>
      app.inject({
        method: 'POST',
        url: `${URL}/excecoes`,
        headers: cab(),
        payload: {
          login: b,
          ate: null,
          retirar: false,
          motivo: 'licença médica prolongada',
          senha,
          ...extra,
        },
      });
    expect((await excecao({}, 'errada')).statusCode).toBe(401);
    expect((await excecao({ motivo: 'curto' })).statusCode).toBe(400);
    expect((await excecao({ ate: '18/11/2026' })).statusCode).toBe(400);
    expect((await excecao({ login: 'NAO.EXISTE' })).json().codigo).toBe('usuario-inexistente');
    expect((await excecao({ retirar: true })).json().codigo).toBe('sem-excecao');
    expect((await excecao({})).json()).toMatchObject({
      anterior: null,
      atual: 'sem prazo',
      destino: 'memoria',
    });
    expect((await excecao({})).json().codigo).toBe('sem-mudanca');
    const t1 = await ler();
    expect(t1.excecoes).toEqual([{ login: b, ate: null, motivo: 'licença médica prolongada' }]);
    expect(t1.poupadas.find((c) => c.login === b)).toMatchObject({ situacao: 'excecao' });
    expect(t1.previa.map((c) => c.login)).not.toContain(b);
    expect(t1.historico[0]).toMatchObject({ login: b, situacao: 'vigente', criadoPor: 'SINT.GESTOR' });

    const rodar = (senha = SENHA) =>
      app.inject({ method: 'POST', url: `${URL}/rodar`, headers: cab(), payload: { senha } });
    expect((await rodar('errada')).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: `${URL}/rodar`, headers: cab(), payload: {} })).statusCode,
    ).toBe(400);
    const r = await rodar();
    expect(r.statusCode).toBe(200);
    const rodada = r.json() as { ligada: boolean; motivo: string | null; bloqueadas: { login: string }[] };
    expect(rodada).toMatchObject({ ligada: true, motivo: null });
    expect(rodada.bloqueadas.map((c) => c.login)).toContain(a);
    expect(rodada.bloqueadas.map((c) => c.login)).not.toContain(b);
    expect(est.bloqueio.get(a!)).toBe(true);
    expect(est.bloqueio.get(b!) ?? false).toBe(false);
    // Bloqueada sai da prévia.
    expect((await ler()).previa.map((c) => c.login)).not.toContain(a);

    // Retirar a exceção: linha nova, valor anterior "sem prazo".
    expect(
      (await excecao({ retirar: true, motivo: 'licença encerrada, voltou ao trabalho' })).json(),
    ).toMatchObject({ anterior: 'sem prazo', atual: null });
    const t2 = await ler();
    expect(t2.excecoes).toEqual([]);
    expect(t2.historico.map((x) => x.situacao)).toEqual(['retirada', 'vigente']);

    const eventos = trilha.eventos.map((e) => e.evento);
    expect(eventos).toEqual(
      expect.arrayContaining([
        'acesso.conta-dormente.excecao',
        'acesso.conta-dormente.bloqueada',
        'acesso.contas-dormentes.rodada',
      ]),
    );
    const texto = JSON.stringify(trilha.eventos);
    expect(texto).not.toContain(SENHA);
    expect(texto).not.toContain('errada');
  });

  it('em dev/ci o despertar diário não liga (a cópia é compartilhada: a rodada é pela tela)', () => {
    expect(app.get(ContasDormentesController).despertarDormentes).toBeNull();
  });
});

describe('despertar diário das contas dormentes (W1-01 parte 9b)', () => {
  function montar(ligada: (h: string) => boolean, hojeRef: { v: string }) {
    const rodadas: string[] = [];
    const servico = {
      hoje: () => hojeRef.v,
      rodada: async (_rede: string, h: string) => {
        rodadas.push(`${hojeRef.v}:${h}`);
        if (h === 'zz') throw new Error('falha do banco');
        return { hospital: h } as never;
      },
    } as unknown as ServicoContasDormentes;
    const porta = {
      parametros: (_r: string, h: string): Promise<ParametrosDormencia> =>
        Promise.resolve({ ...PADRAO_DORMENCIA, ligada: ligada(h) }),
    };
    return { rodadas, d: new DespertarContasDormentes(servico, porta, 'rede', ['aa', 'bb', 'zz']) };
  }

  it('roda uma vez por dia em cada estabelecimento ligado; desligado não roda; falha de um não para os outros', async () => {
    const hoje = { v: '2026-11-18' };
    const { rodadas, d } = montar((h) => h !== 'bb', hoje);
    await d.passada();
    await d.passada();
    expect(rodadas).toEqual(['2026-11-18:aa', '2026-11-18:zz']);
    hoje.v = '2026-11-19';
    await d.passada();
    expect(rodadas).toEqual(['2026-11-18:aa', '2026-11-18:zz', '2026-11-19:aa', '2026-11-19:zz']);
  });

  it('iniciar e parar o relógio (sem estabelecimento não liga)', () => {
    const { d } = montar(() => true, { v: '2026-11-18' });
    d.iniciar(3_600_000);
    expect(d.ligadoODespertar).toBe(true);
    d.parar();
    expect(d.ligadoODespertar).toBe(false);
    const vazio = new DespertarContasDormentes({} as never, { parametros: () => Promise.reject() }, 'r', []);
    vazio.iniciar();
    expect(vazio.ligadoODespertar).toBe(false);
  });
});
