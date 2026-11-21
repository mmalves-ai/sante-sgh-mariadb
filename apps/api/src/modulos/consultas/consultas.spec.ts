// M14 pela HTTP (consultas somente leitura), com a sessão real sobre a fonte sintética e as linhas sintéticas
// da consulta (nada conecta a banco; o módulo `consultas` registrado com a fonte de memória): índice só com o que a
// pessoa lê e só com as consultas que uma tabela do modelo atende, descrição sem nome de tabela, página com máscara e
// cursor, tabela grande recusada sem filtro, registro de dado de pessoa auditado, consulta clínica só para o perfil
// clínico e o auditor (evento de leitura de prontuário), exportação com justificativa e o escopo do M06.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { CONSULTAS_DECLARADAS as TODAS, EVENTOS_AUDITAVEIS, rotaDaConsulta } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { ContextoModulo } from '../registro.js';
import { declaracaoSintetica, ErroEscopo } from './declaracao.js';
import { fonteConsultasMemoria, tabelaDaConsulta } from './fonte.js';
import { moduloConsultas } from './modulo.js';

/** Só as consultas que uma tabela do modelo atende entram no índice. */
const CONSULTAS_DECLARADAS = TODAS.filter((c) => tabelaDaConsulta(c) !== null);

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'consultas' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      consultas: async () => ({
        modulo: (ctx: ContextoModulo) => moduloConsultas(ctx, { fonte: fonteConsultasMemoria() }),
      }),
    },
  });
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
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m14-${++chave}-${Date.now()}`,
});

const api = (rota: string) => `/api${rota}`;
const grande = CONSULTAS_DECLARADAS.find((c) => c.grande && c.modulo === 'auditoria')!;
const pessoal = CONSULTAS_DECLARADAS.find((c) => c.classe === 'pessoal' && c.modulo === 'cadastro')!;
const clinica = CONSULTAS_DECLARADAS.find((c) => c.classe === 'clinica')!;
const rh = CONSULTAS_DECLARADAS.find((c) => c.modulo === 'pessoas' && !c.grande)!;

describe('consultas somente leitura (M14)', () => {
  it('índice só com as consultas que a pessoa lê; o item filtra', async () => {
    const s = await entrar('SINT.RH');
    const i = await get(s, '/api/consultas');
    expect(i.statusCode).toBe(200);
    const lidas = i.json().consultas as { modulo: string }[];
    expect(lidas.length).toBeGreaterThan(0);
    expect(new Set(lidas.map((c) => c.modulo))).toEqual(new Set(['pessoas']));
    const doItem = await get(s, `/api/consultas?item=${encodeURIComponent(rh.item ?? '')}`);
    expect((doItem.json().consultas as { item: string }[]).every((c) => c.item === rh.item)).toBe(true);
  });
  it('descrição sem nome de tabela; página com cursor; consulta de outra área é 403 e vai à trilha', async () => {
    const s = await entrar('SINT.RH');
    const d = await get(s, api(rotaDaConsulta(rh)));
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({
      modulo: 'pessoas',
      recurso: rh.recurso,
      fase: rh.fase,
      permitidas: ['ler', 'exportar'],
    });
    expect(JSON.stringify(d.json())).not.toMatch(/"[A-Z][A-Z0-9_]{3,}"/);
    const p = await get(s, `${api(rotaDaConsulta(rh))}/linhas?porPagina=2`);
    expect(p.statusCode).toBe(200);
    expect(p.json().itens).toHaveLength(2);
    expect(p.json().contagem).toEqual({ valor: 5, maisDe: false });
    const seg = await get(
      s,
      `${api(rotaDaConsulta(rh))}/linhas?porPagina=2&apos=${encodeURIComponent(p.json().proxima)}`,
    );
    expect(seg.json().itens).toHaveLength(2);
    expect(seg.json().itens[0]).not.toEqual(p.json().itens[0]);
    const antes = trilha.eventos.length;
    const negada = await get(s, api(rotaDaConsulta(pessoal)));
    expect(negada.statusCode).toBe(403);
    expect(
      trilha.eventos.slice(antes).some((e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo),
    ).toBe(true);
  });
  it('tabela grande: sem filtro, 422; com período, a página sai (auditor na trilha)', async () => {
    const s = await entrar('SINT.AUDITOR');
    const sem = await get(s, `${api(rotaDaConsulta(grande))}/linhas`);
    expect(sem.statusCode).toBe(422);
    const d = (await get(s, api(rotaDaConsulta(grande)))).json() as {
      colunas: { campo: string; filtro?: string }[];
    };
    const periodo =
      d.colunas.find((c) => c.filtro === 'periodo') ?? d.colunas.find((c) => c.filtro === 'igual')!;
    const q =
      periodo.filtro === 'periodo'
        ? `de.${periodo.campo}=2026-07-01&ate.${periodo.campo}=2026-07-31`
        : `f.${periodo.campo}=1`;
    const com = await get(s, `${api(rotaDaConsulta(grande))}/linhas?${q}`);
    expect(com.statusCode).toBe(200);
    const filtroInvalido = await get(s, `${api(rotaDaConsulta(grande))}/linhas?f.naoExiste=1`);
    expect(filtroInvalido.statusCode).toBe(400);
  });
  it('dado de pessoa: máscara na lista; abrir o registro é evento auditado', async () => {
    const s = await entrar('SINT.ADMIN');
    const d = (await get(s, api(rotaDaConsulta(pessoal)))).json() as {
      colunas: { campo: string; mascarada: boolean; chave: boolean }[];
      exportarExigeJustificativa: boolean;
    };
    expect(d.exportarExigeJustificativa).toBe(true);
    const mascarada = d.colunas.find((c) => c.mascarada);
    expect(mascarada).toBeDefined();
    const p = (await get(s, `${api(rotaDaConsulta(pessoal))}/linhas`)).json() as {
      itens: Record<string, unknown>[];
    };
    expect(p.itens[0]?.[mascarada!.campo]).toBe('•••');
    const codigo = d.colunas
      .filter((c) => c.chave)
      .map((c) => String(p.itens[0]?.[c.campo] ?? ''))
      .join('|');
    const antes = trilha.eventos.length;
    const r = await get(s, `${api(rotaDaConsulta(pessoal))}/registro/${encodeURIComponent(codigo)}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().valores[mascarada!.campo]).not.toBe('•••');
    expect(trilha.eventos.slice(antes).map((e) => e.evento)).toContain(
      EVENTOS_AUDITAVEIS.consultaRegistroAberto.codigo,
    );
    const exp = await app.inject({
      method: 'POST',
      url: `${api(rotaDaConsulta(pessoal))}/exportar`,
      headers: h(s),
      payload: { filtros: {} },
    });
    expect(exp.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: `${api(rotaDaConsulta(pessoal))}/exportar`,
      headers: h(s),
      payload: { filtros: {}, justificativa: 1 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('•••');
    expect(trilha.eventos.map((e) => e.evento)).toContain(EVENTOS_AUDITAVEIS.consultaExportada.codigo);
  });
  it('correção do M14: o auditor (sem a opção do domínio de justificativas) exporta pela rota das consultas', async () => {
    const s = await entrar('SINT.AUDITOR');
    // O domínio de auditoria não é lido pelo auditor (módulo de configuração); a rota própria das consultas é.
    const j = await get(s, '/api/consultas/justificativas');
    expect(j.statusCode).toBe(200);
    const lista = j.json().justificativas as { codigo: number; descricao: string }[];
    expect(lista.length).toBeGreaterThan(0);
    const alvo = CONSULTAS_DECLARADAS.find((c) => c.classe === 'clinica')!;
    const d = (await get(s, api(rotaDaConsulta(alvo)))).json() as {
      colunas: { campo: string; filtro?: string }[];
      permitidas: string[];
    };
    expect(d.permitidas).toContain('exportar');
    const f = d.colunas.find((c) => c.filtro === 'igual')!;
    const ok = await app.inject({
      method: 'POST',
      url: `${api(rotaDaConsulta(alvo))}/exportar`,
      headers: h(s),
      payload: { filtros: { [`f.${f.campo}`]: '1' }, justificativa: lista[0]!.codigo },
    });
    expect(ok.statusCode).toBe(200);
  });
  it('conteúdo clínico: o auditor lê (evento de leitura de prontuário); o RH não', async () => {
    const rhs = await entrar('SINT.RH');
    expect((await get(rhs, api(rotaDaConsulta(clinica)))).statusCode).toBe(403);
    const s = await entrar('SINT.AUDITOR');
    const antes = trilha.eventos.length;
    const d = (await get(s, api(rotaDaConsulta(clinica)))).json() as {
      colunas: { campo: string; filtro?: string }[];
    };
    const f = d.colunas.find((c) => c.filtro === 'igual')!;
    const p = await get(s, `${api(rotaDaConsulta(clinica))}/linhas?f.${f.campo}=1`);
    expect(p.statusCode).toBe(200);
    expect(trilha.eventos.slice(antes).map((e) => e.evento)).toContain(
      EVENTOS_AUDITAVEIS.registrosListados.codigo,
    );
  });
});

describe('correção do M14: escopo do M06 nas consultas', () => {
  it('fonte: restrito sem coluna falha fechado; com coluna, só os valores aceitos; a API responde 403', async () => {
    const { problemaDaConsulta } = await import('./consultas.controller.js');
    const f = fonteConsultasMemoria();
    const publico = CONSULTAS_DECLARADAS.find((c) => c.modulo === 'faturamento')!;
    const semEscopo = declaracaoSintetica(publico);
    const base = declaracaoSintetica(publico);
    const comEscopo = {
      ...base,
      colunas: [
        ...base.colunas,
        { coluna: 'fonte_pagadora_id', campo: 'fontePagadoraId', rotulo: 'Fonte pagadora', tipo: 'inteiro' as const },
      ],
      escopos: { convenio: 'fonte_pagadora_id' },
    };
    const ctx = { rede: 'r', hospital: 'aa' };
    await expect(f.pagina({ ...ctx, escopo: { convenio: ['1'] } }, semEscopo, [], null, 10)).rejects.toBeInstanceOf(
      ErroEscopo,
    );
    // Uma fonte nova (a memória guarda as linhas sintéticas por consulta, geradas das colunas da primeira leitura).
    const f2 = fonteConsultasMemoria();
    const p = await f2.pagina({ ...ctx, escopo: { convenio: ['2'] } }, comEscopo, [], null, 10);
    expect(p.linhas.length).toBeGreaterThan(0);
    expect(p.linhas.every((l) => String(l['fontePagadoraId']) === '2')).toBe(true);
    expect((await f2.pagina({ ...ctx, escopo: { convenio: null } }, comEscopo, [], null, 10)).linhas.length).toBe(5);
    expect(problemaDaConsulta(new ErroEscopo('x')).getStatus()).toBe(403);
  });

  it('a declaração do banco: id como chave, filtro nas colunas indexadas, máscara de pessoa e o estabelecimento', () => {
    const publico = CONSULTAS_DECLARADAS.find((c) => c.classe === 'pessoal')!;
    const d = declaracaoSintetica(publico, 'tabela_teste');
    expect(d.chave).toEqual(['id']);
    expect(d.colunas.find((c) => c.coluna === 'nome')?.mascarada).toBe(true);
    expect(d.colunas.find((c) => c.coluna === 'criado_em')?.filtro).toBe('periodo');
    expect(d.colunas.find((c) => c.coluna === 'codigo')?.filtro).toBe('igual');
    expect(d.porEstabelecimento).toBeNull();
  });
});
