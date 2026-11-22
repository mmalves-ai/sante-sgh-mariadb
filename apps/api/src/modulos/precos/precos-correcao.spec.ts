// M12, correção da verificação, pela HTTP com a sessão real sobre a fonte sintética e a fonte de preços EM
// MEMÓRIA (nada conecta a banco; dados sintéticos): o total da consulta é a soma dos componentes (soma dos
// componentes) também nos modelos CH e PORTE; os casos de sante-api test/valores.test.js; a comparação da
// importação com o valor anterior; corrigir e encerrar o plano; portes pelo convênio; credenciamento pelo
// profissional e o valor da consulta só no Particular; vigências de diárias e mat/med; o desfazer pré-confere
// todas as partes e retoma o que falta.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { credenciaisNaResposta } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { FontePrecosMemoria } from './fonte-memoria.js';
import { moduloPrecos } from './modulo.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'precos' };
const trilha = new RegistradorTrilhaMemoria();
const fonte = new FontePrecosMemoria('dev');
let app: NestFastifyApplication;
const ctxTeste = {
  cliente: '',
  estabelecimento: null,
  usuario: null,
  correlacao: 't',
  rede: '',
  hospital: 'aa',
  traceId: 't',
};
let chave = 0;
const respostas: { url: string; corpo: unknown }[] = [];

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: { precos: async () => ({ modulo: (ctx) => moduloPrecos(ctx, { fonte }) }) },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  // Regra 8 sobre TODAS as respostas desta suíte: nenhuma chave ou valor de credencial.
  expect(
    respostas.flatMap((r) => credenciaisNaResposta(r.corpo).map((a) => `${r.url} ${a.caminho}`)),
  ).toEqual([]);
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

async function get(s: Sessao, url: string) {
  const r = await app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
  if (r.headers['content-type']?.toString().includes('json')) respostas.push({ url, corpo: r.json() });
  return r;
}
const enviar = (s: Sessao, metodo: 'POST' | 'PATCH', url: string, payload: unknown) =>
  app.inject({
    method: metodo,
    url,
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      'idempotency-key': `teste-m12c-${++chave}-${Date.now()}`,
    },
    payload: payload as Record<string, unknown>,
  });

describe('consulta de valor vigente: o total é a regra da sante-api (soma dos 5 componentes)', () => {
  it('modelo CH e PORTE: total = soma dos componentes, igual à grade; o modelo fica só na explicação', async () => {
    const s = await entrar('SINT.FATURISTA');
    const ch = (
      await get(s, '/api/precos/consulta?convenio=53&tipo=honorario&item=53001&data=2026-06-01')
    ).json();
    // 100 + 7,5 + 1,25 + 0 + 0,5 (TBVLRTHM); o modelo CH daria 0,5 × 12,5 = 6,25.
    expect(ch).toMatchObject({ modelo: 'CH', total: 109.25, estimativaPeloModelo: 6.25, falta: [] });
    const grade = (await get(s, '/api/precos/honorarios/53/itens?data=2026-06-01&busca=53001')).json();
    expect(grade.itens[0].total).toBe(ch.total);
    const porte = (
      await get(s, '/api/precos/consulta?convenio=71&tipo=honorario&item=71001&data=2026-06-01')
    ).json();
    // 100 + 15 + 0 + 30 + 2; o modelo PORTE daria 210 × 1.
    expect(porte).toMatchObject({ modelo: 'PORTE', total: 147, estimativaPeloModelo: 210 });
    expect(porte.passos.join(' ')).toMatch(/estimativa, não é o total/);
    const valor = (
      await get(s, '/api/precos/consulta?convenio=305&tipo=honorario&item=305001&data=2026-06-01')
    ).json();
    expect(valor).toMatchObject({ modelo: 'VALOR', total: 100, estimativaPeloModelo: null });
  });

  it('casos de sante-api test/valores.test.js: sem tabela da conta, item inexistente, convênio inexistente', async () => {
    const s = await entrar('SINT.FATURISTA');
    const semThm = (
      await get(s, '/api/precos/consulta?convenio=60&tipo=honorario&conta=externa&item=61001')
    ).json();
    expect(semThm).toMatchObject({ tabela: null, total: null, falta: ['tabela'] });
    expect(semThm.passos).toEqual(['Convênio sem tabela de honorários para esta conta.']);
    const internacao = (
      await get(
        s,
        '/api/precos/consulta?convenio=60&tipo=honorario&conta=internacao&item=61001&data=2026-06-01',
      )
    ).json();
    expect(internacao).toMatchObject({ tabela: 61, total: 100 });
    const nenhum = (await get(s, '/api/precos/consulta?convenio=305&tipo=honorario&item=999999')).json();
    expect(nenhum).toMatchObject({ item: null, total: null, falta: ['item'] });
    expect((await get(s, '/api/precos/consulta?convenio=9999&tipo=honorario&item=1')).statusCode).toBe(404);
  });

  it('Particular: o valor da consulta por médico vem só de FCCODCON; outro convênio não tem', async () => {
    const s = await entrar('SINT.FATURISTA');
    const part = (await get(s, '/api/faturamento/credenciamento?convenio=10')).json();
    expect(part.itens.length).toBeGreaterThan(0);
    expect(part.itens.every((i: { valorConsulta: number | null }) => i.valorConsulta === 250)).toBe(true);
    const outro = (await get(s, '/api/faturamento/credenciamento?convenio=305')).json();
    expect(outro.itens.every((i: { valorConsulta: number | null }) => i.valorConsulta === null)).toBe(true);
  });
});

describe('motor: credenciamento pelo profissional; portes pelo convênio; vigências de diária e mat/med', () => {
  it('credenciamento: registro no conselho ou trecho do nome, sem acento', async () => {
    const s = await entrar('SINT.FATURISTA');
    const nome = (await get(s, '/api/faturamento/credenciamento?profissional=sint%C3%A9tico%20b')).json();
    expect(nome.itens.map((i: { profissional: string }) => i.profissional)).toEqual([
      'PROFISSIONAL SINTÉTICO B',
    ]);
    const crm = (await get(s, '/api/faturamento/credenciamento?profissional=99001')).json();
    expect(crm.itens.map((i: { conselho: number }) => i.conselho)).toEqual([99001]);
  });

  it('portes: pela tabela ou pela tabela de porte do contrato do convênio', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const todas = (await get(s, '/api/faturamento/portes')).json();
    expect(new Set(todas.itens.map((i: { tabela: number }) => i.tabela))).toEqual(new Set([1, 2]));
    const t2 = (await get(s, '/api/faturamento/portes?tabela=2')).json();
    expect(t2.itens.every((i: { tabela: number }) => i.tabela === 2)).toBe(true);
    // TBCONVEN.PORTE = 1 nos convênios sintéticos.
    const conv = (await get(s, '/api/faturamento/portes?convenio=305')).json();
    expect(conv.itens.length).toBe(3);
    expect(conv.itens.every((i: { tabela: number }) => i.tabela === 1)).toBe(true);
    const inexistente = (await get(s, '/api/faturamento/portes?convenio=9999')).json();
    expect(inexistente).toMatchObject({ itens: [], avisos: ['Convênio não encontrado.'] });
    const unimed = (await get(s, '/api/faturamento/unimed?busca=hemograma')).json();
    expect(unimed.itens.map((i: { codigo: number }) => i.codigo)).toEqual([40304361]);
  });

  it('diárias e mat/med: a linha do tempo das vigências do item', async () => {
    const s = await entrar('SINT.FATURISTA');
    const d = (await get(s, '/api/precos/diarias/5/itens/100/vigencias')).json();
    expect(d).toMatchObject({ tipo: 'diaria', codigo: 100, nome: 'DIÁRIA DE APARTAMENTO SINTÉTICA' });
    expect(d.vigencias.map((v: { data: string; vigente: boolean }) => [v.data, v.vigente])).toEqual([
      ['2026-01-15', true],
      ['2025-01-01', false],
    ]);
    const m = (await get(s, '/api/precos/matmed/700/itens/700100/vigencias')).json();
    expect(m.vigencias[0]).toMatchObject({ valor: 3.5, pmc: 4, pf: 3, edicao: 1001, vigente: true });
    expect((await get(s, '/api/precos/diarias/5/itens/1/vigencias')).statusCode).toBe(404);
  });
});

describe('importação: a comparação mostra o valor anterior e o nome', () => {
  it('o item alterado traz o vigente (antes) e o do arquivo (depois); o removido, só o antes', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const c = await enviar(s, 'POST', '/api/precos/importacoes', {
      tabela: 306,
      arquivo: 'tabela-306-antes.csv',
      conteudo: 'codigo;valor_ch\n306003;150,5\n306004;130\n888888;10\n',
    });
    expect(c.statusCode).toBe(201);
    const det = (await get(s, `/api/precos/importacoes/${c.json().id as number}?porPagina=50`)).json();
    const alt = det.linhas.find((l: { codigo: number }) => l.codigo === 306003);
    expect(alt).toMatchObject({
      comparacao: 'alterado',
      nome: 'PROCEDIMENTO SINTÉTICO 306-3',
      antes: { ch: 120, co: 0, filme: 0, anes: 0, outros: 0 },
      depois: { ch: 150.5 },
    });
    const rem = det.linhas.find((l: { comparacao: string }) => l.comparacao === 'removido');
    expect(rem.antes).not.toBeNull();
    expect(rem.depois).toBeNull();
    const novo = det.linhas.find((l: { codigo: number }) => l.codigo === 888888);
    expect(novo).toMatchObject({ comparacao: 'novo', antes: null });
    expect(novo.motivo).not.toMatch(/SPDATA/);
  });
});

describe('plano do contrato: corrigir e encerrar (nunca apagar)', () => {
  it('inclui, encerra com fim e desativa; versão velha dá 409; fim antes do início, 400', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const n = await enviar(s, 'POST', '/api/cadastros/convenios/306/planos', {
      nome: 'PLANO SINTÉTICO B',
      planoLegado: null,
      inicio: '2026-01-01',
      fim: null,
      justificativa: 'plano sintético',
      senha: SENHA,
    });
    expect(n.statusCode).toBe(201);
    const id = n.json().id as number;
    const url = `/api/cadastros/convenios/306/planos/${id}`;
    const enc = await enviar(s, 'PATCH', url, {
      versao: 1,
      fim: '2026-06-30',
      ativo: false,
      justificativa: 'encerrar o plano sintético',
      senha: SENHA,
    });
    expect(enc.statusCode).toBe(200);
    expect(enc.json()).toMatchObject({ id, versao: 2 });
    const plano = (await get(s, '/api/cadastros/convenios/306'))
      .json()
      .planos.find((p: { id: number }) => p.id === id);
    expect(plano).toMatchObject({ fim: '2026-06-30', ativo: false, versao: 2, nome: 'PLANO SINTÉTICO B' });
    const velha = await enviar(s, 'PATCH', url, {
      versao: 1,
      nome: 'OUTRO',
      justificativa: 'versão velha',
      senha: SENHA,
    });
    expect(velha.statusCode).toBe(409);
    const antes = await enviar(s, 'PATCH', url, {
      versao: 2,
      fim: '2025-12-31',
      justificativa: 'fim antes do início',
      senha: SENHA,
    });
    expect(antes.statusCode).toBe(400);
    const nada = await enviar(s, 'PATCH', url, { versao: 2, justificativa: 'nada a mudar', senha: SENHA });
    expect(nada.statusCode).toBe(400);
    const f = await entrar('SINT.FATURISTA');
    expect(
      (await enviar(f, 'PATCH', url, { versao: 2, nome: 'X', justificativa: 'sem permissão', senha: SENHA }))
        .statusCode,
    ).toBe(403);
    expect(trilha.eventos.some((l) => l.evento === 'convenio.plano.alterado')).toBe(true);
  });
});

describe('desfazer do lote: pré-confere todas as partes e retoma o que falta', () => {
  it('item usado em conta recusa o lote inteiro, nada removido', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const r = await enviar(s, 'POST', '/api/precos/honorarios/305/reajuste', {
      codigos: [305007, 305008],
      percentual: 5,
      justificativa: 'reajuste para o desfazer',
      senha: SENHA,
    });
    expect(r.statusCode, r.body).toBe(200);
    const lote = r.json().lote as string;
    fonte.usadosEmConta.add('305|305008');
    const d = await enviar(s, 'POST', `/api/precos/reajustes/${lote}/desfazer`, {
      justificativa: 'desfazer recusado',
      senha: SENHA,
    });
    fonte.usadosEmConta.delete('305|305008');
    expect(d.statusCode).toBe(409);
    expect(d.json().codigo).toBe('vigencia-usada');
    const l = (await get(s, '/api/precos/reajustes?tabela=305'))
      .json()
      .lotes.find((x: { lote: string }) => x.lote === lote);
    expect(l).toMatchObject({ desfeitos: 0, desfeito: false });
  });

  it('desfeito em parte: o lote aparece "em parte" e um novo pedido completa só o que falta', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const r = await enviar(s, 'POST', '/api/precos/honorarios/305/reajuste', {
      codigos: [305009, 305010],
      percentual: 5,
      justificativa: 'reajuste em duas partes',
      senha: SENHA,
    });
    const lote = r.json().lote as string;
    const linhas = await fonte.linhasDoLote(ctxTeste, lote);
    const primeiro = linhas[0]!;
    // Uma parte já desfeita (como se o pedido anterior tivesse parado depois dela).
    await fonte.executar(
      'preco.desfazerReajuste',
      ctxTeste,
      {
        tabela: 305,
        data: primeiro.data,
        lote,
        parte: 1,
        partes: 2,
        justificativa: 'primeira parte',
        itens: [{ codigo: primeiro.codigo, valores: primeiro.valores }],
      },
      {
        ...ctxTeste,
        login: 'SINT.FATURAMENTO',
        chaveIdempotencia: `parte-1-${lote}`,
        estacao: 'teste',
        reautenticadoEm: Date.now(),
      },
    );
    const parcial = (await get(s, '/api/precos/reajustes?tabela=305'))
      .json()
      .lotes.find((x: { lote: string }) => x.lote === lote);
    expect(parcial).toMatchObject({ itens: 2, desfeitos: 1, desfeito: false });
    const d = await enviar(s, 'POST', `/api/precos/reajustes/${lote}/desfazer`, {
      justificativa: 'completa o desfazer',
      senha: SENHA,
    });
    expect(d.statusCode).toBe(200);
    expect(d.json().linhas).toBe(1);
    const fim = (await get(s, '/api/precos/reajustes?tabela=305'))
      .json()
      .lotes.find((x: { lote: string }) => x.lote === lote);
    expect(fim).toMatchObject({ desfeitos: 2, desfeito: true });
    const de = await enviar(s, 'POST', `/api/precos/reajustes/${lote}/desfazer`, {
      justificativa: 'de novo',
      senha: SENHA,
    });
    expect(de.statusCode).toBe(409);
    expect(de.json().codigo).toBe('sem-efeito');
  });
});
