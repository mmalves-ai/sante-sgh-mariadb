// M12 pela HTTP, com a sessão real sobre a fonte sintética e a fonte de preços EM MEMÓRIA (nada conecta a banco):
// lista com busca por palavra, contrato em abas sem credencial e com as constantes ocultas, suspender e
// reativar (reautenticação, recusa da diária de acompanhante), alterar contrato com controle otimista,
// proposta e reajuste com vetos e confirmações, desfazer do lote, valor vigente em duas datas, importação
// versionada (comparação e publicação), códigos de prestador e colunas bancárias pela permissão.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { moduloPrecos } from './modulo.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'precos' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: { precos: async () => ({ modulo: (ctx) => moduloPrecos(ctx) }) },
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

const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m12-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown, metodo: 'POST' | 'PUT' = 'POST') =>
  app.inject({ method: metodo, url, headers: h(s), payload: payload as Record<string, unknown> });

describe('convênios e contrato (M12)', () => {
  it('lista com busca por palavra e situação; contrato em abas sem credencial', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const l = await get(s, '/api/cadastros/convenios?busca=operadora%20alfa');
    expect(l.statusCode).toBe(200);
    expect(l.json().itens.map((c: { codigo: number }) => c.codigo)).toContain(305);
    const susp = await get(s, '/api/cadastros/convenios?situacao=suspensos');
    expect(susp.json().itens.map((c: { codigo: number }) => c.codigo)).toEqual([315]);
    expect(susp.json().itens[0].aceitaAtendimento.aceita).toBe(false);
    const c = await get(s, '/api/cadastros/convenios/305');
    expect(c.statusCode).toBe(200);
    const corpo = c.json();
    expect(corpo.abas.map((a: { id: string }) => a.id)).toEqual([
      'cadastro',
      'tabelas',
      'modificadores',
      'faturabilidade',
      'pacotes',
      'tiss',
      'financeiro',
    ]);
    // Modelo próprio: nenhuma constante oculta nem campo "a confirmar".
    expect(corpo.constantesOcultas).toBe(0);
    expect(JSON.stringify(corpo)).not.toMatch(/"SENHA"|CPF_RESPONSAVEL|TBCONVEN/);
    const cadastro = corpo.abas.find((a: { id: string }) => a.id === 'cadastro');
    expect(cadastro.editavel).toBe(true);
    expect(cadastro.campos.find((x: { campo: string }) => x.campo === 'nome')).toMatchObject({
      editavel: true,
    });
    const todos = corpo.abas.flatMap((a: { campos: { aConfirmar: boolean }[] }) => a.campos);
    expect(todos.some((x: { aConfirmar: boolean }) => x.aConfirmar)).toBe(false);
    expect(corpo.permissoes).toEqual({ alterarSituacao: true, editarContrato: true });
    const f = await entrar('SINT.FATURISTA');
    const cf = await get(f, '/api/cadastros/convenios/305');
    expect(cf.json().permissoes).toEqual({ alterarSituacao: false, editarContrato: false });
    expect((await get(f, '/api/cadastros/convenios/99')).statusCode).toBe(404);
  });

  it('suspender e reativar: senha de novo, autoria, recusa da diária de acompanhante e sem efeito', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const sem = await post(s, '/api/cadastros/convenios/306/situacao', {
      operacao: 'suspender',
      justificativa: 'teste sintético',
      senha: 'errada',
    });
    expect(sem.statusCode).toBe(401);
    const imp = await get(s, '/api/cadastros/convenios/306/situacao/impacto?operacao=suspender');
    expect(imp.json()).toMatchObject({ situacaoAtual: 'A', situacaoDepois: 'I', recusa: null });
    const ok = await post(s, '/api/cadastros/convenios/306/situacao', {
      operacao: 'suspender',
      justificativa: 'teste sintético',
      senha: SENHA,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ operacao: 'convenio.alterarSituacao', destino: 'memoria' });
    expect((await get(s, '/api/cadastros/convenios/306/aceita-atendimento')).json().aceita).toBe(false);
    const de = await post(s, '/api/cadastros/convenios/306/situacao', {
      operacao: 'suspender',
      justificativa: 'teste sintético',
      senha: SENHA,
    });
    expect(de.statusCode).toBe(409);
    expect(de.json().codigo).toBe('sem-efeito');
    const dth = await post(s, '/api/cadastros/convenios/50/situacao', {
      operacao: 'suspender',
      justificativa: 'teste sintético',
      senha: SENHA,
    });
    expect(dth.statusCode).toBe(409);
    expect(dth.json().codigo).toBe('diaria-acompanhante-invalida');
    const volta = await post(s, '/api/cadastros/convenios/306/situacao', {
      operacao: 'reativar',
      justificativa: 'teste sintético',
      senha: SENHA,
    });
    expect(volta.statusCode).toBe(200);
    expect(trilha.eventos.some((e) => e.evento === 'convenio.situacao.alterada')).toBe(true);
    const f = await entrar('SINT.FATURISTA');
    expect(
      (
        await post(f, '/api/cadastros/convenios/306/situacao', {
          operacao: 'suspender',
          justificativa: 'x',
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('alterar contrato: só campos editáveis da aba; colisão devolve os campos', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const colide = await post(
      s,
      '/api/cadastros/convenios/305/contrato',
      {
        aba: 'financeiro',
        valores: { prazoPagamentoDias: 45 },
        lidos: { prazoPagamentoDias: 15 },
        justificativa: 'prazo novo',
        senha: SENHA,
      },
      'PUT',
    );
    expect(colide.statusCode).toBe(409);
    expect(colide.json().campos).toEqual(['prazoPagamentoDias']);
    const fora = await post(
      s,
      '/api/cadastros/convenios/305/contrato',
      {
        aba: 'cadastro',
        valores: { prazoPagamentoDias: 45 },
        lidos: { prazoPagamentoDias: 30 },
        justificativa: 'aba errada',
        senha: SENHA,
      },
      'PUT',
    );
    expect(fora.statusCode).toBe(400);
    const ok = await post(
      s,
      '/api/cadastros/convenios/305/contrato',
      {
        aba: 'financeiro',
        valores: { prazoPagamentoDias: 45 },
        lidos: { prazoPagamentoDias: 30 },
        justificativa: 'prazo novo',
        senha: SENHA,
      },
      'PUT',
    );
    expect(ok.statusCode).toBe(200);
    const c = (await get(s, '/api/cadastros/convenios/305')).json();
    const fin = c.abas.find((a: { id: string }) => a.id === 'financeiro');
    expect(fin.campos.find((x: { campo: string }) => x.campo === 'prazoPagamentoDias').valor).toBe(45);
    const plano = await post(s, '/api/cadastros/convenios/305/planos', {
      nome: 'PLANO SINTÉTICO',
      planoLegado: 1,
      inicio: '2026-01-01',
      fim: null,
      justificativa: 'plano do contrato',
      senha: SENHA,
    });
    expect(plano.statusCode).toBe(201);
    expect((await get(s, '/api/cadastros/convenios/305')).json().planos).toHaveLength(1);
  });
});

describe('tabelas de preço, reajuste e desfazer (M12)', () => {
  it('itens com a vigência na data; proposta, reajuste com autoria, desfazer', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const t = (await get(s, '/api/precos/tabelas?tipo=honorarios')).json().tabelas;
    expect(t.find((x: { codigo: number }) => x.codigo === 10)).toMatchObject({ compartilhada: true });
    expect(t.find((x: { codigo: number }) => x.codigo === 53)).toMatchObject({ modelo: 'CH' });
    const antes = (await get(s, '/api/precos/honorarios/305/itens?data=2025-06-01&porPagina=5')).json();
    expect(antes.itens[0]).toMatchObject({ codigo: 305001, vigencia: '2025-01-01', total: 80 });
    const depois = (await get(s, '/api/precos/honorarios/305/itens?data=2026-06-01&porPagina=5')).json();
    expect(depois.itens[0]).toMatchObject({ vigencia: '2026-01-15', total: 100 });
    const prop = await post(s, '/api/precos/honorarios/305/reajuste/proposta', {
      codigos: [305001, 305002],
      percentual: 10,
    });
    expect(prop.statusCode).toBe(200);
    expect(prop.json().vetos).toEqual([]);
    expect(prop.json().linhas.map((l: { novos: { ch: number } }) => l.novos.ch)).toEqual([110, 121]);
    const r = await post(s, '/api/precos/honorarios/305/reajuste', {
      codigos: [305001, 305002],
      percentual: 10,
      justificativa: 'reajuste sintético',
      senha: SENHA,
    });
    expect(r.statusCode).toBe(200);
    const lote = r.json().lote as string;
    expect(r.json()).toMatchObject({ linhas: 2, partes: 1 });
    const v = (await get(s, '/api/precos/honorarios/305/itens/305001/vigencias')).json();
    expect(v.vigencias[0]).toMatchObject({
      vigente: true,
      autoria: { autor: 'SINT.FATURAMENTO', origem: 'reajuste' },
    });
    expect(v.vigencias[1].autoria).toBeNull();
    const lotes = (await get(s, '/api/precos/reajustes?tabela=305')).json().lotes;
    expect(lotes[0]).toMatchObject({ lote, itens: 2, desfeito: false });
    const d = await post(s, `/api/precos/reajustes/${lote}/desfazer`, {
      justificativa: 'desfazer sintético',
      senha: SENHA,
    });
    expect(d.statusCode).toBe(200);
    expect(d.json().linhas).toBe(2);
    const de = await post(s, `/api/precos/reajustes/${lote}/desfazer`, {
      justificativa: 'de novo',
      senha: SENHA,
    });
    expect(de.statusCode).toBe(409);
    expect(
      (await get(s, '/api/precos/honorarios/305/itens/305001/vigencias')).json().vigencias[0].autoria,
    ).toBeNull();
  });

  it('tabela compartilhada exige confirmação; modelo CH é vetado; vigência futura sem decisão também', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const sem = await post(s, '/api/precos/honorarios/10/reajuste', {
      codigos: [10001],
      percentual: 3,
      justificativa: 'compartilhada',
      senha: SENHA,
    });
    expect(sem.statusCode).toBe(409);
    expect(sem.json().codigo).toBe('confirmacao-pendente');
    const com = await post(s, '/api/precos/honorarios/10/reajuste', {
      codigos: [10001],
      percentual: 3,
      justificativa: 'compartilhada',
      senha: SENHA,
      confirmacoes: { tabelaCompartilhada: true },
    });
    expect(com.statusCode).toBe(200);
    const amb = await post(s, '/api/precos/honorarios/53/reajuste/proposta', {
      codigos: [53001],
      percentual: 3,
    });
    expect(amb.json().vetos.map((v: { codigo: string }) => v.codigo)).toContain('modelo-ch');
    const futura = await post(s, '/api/precos/honorarios/305/reajuste/proposta', {
      codigos: [305003],
      percentual: 3,
      data: '2099-01-01',
    });
    expect(futura.json().vetos.map((v: { codigo: string }) => v.codigo)).toContain('data-futura');
  });

  it('valor vigente em duas datas com a explicação do modelo', async () => {
    const s = await entrar('SINT.FATURISTA');
    const a = (
      await get(s, '/api/precos/consulta?convenio=305&tipo=honorario&item=305004&data=2025-06-01')
    ).json();
    const b = (
      await get(s, '/api/precos/consulta?convenio=305&tipo=honorario&item=305004&data=2026-06-01')
    ).json();
    expect([a.total, b.total]).toEqual([110, 130]);
    expect(b).toMatchObject({ tabela: 305, modelo: 'VALOR', vigencia: '2026-01-15' });
    expect(b.passos.length).toBeGreaterThan(1);
    const porte = (
      await get(s, '/api/precos/consulta?convenio=305&tipo=honorario&item=305001&data=2026-06-01')
    ).json();
    expect(porte.modelo).toBe('VALOR');
  });

  it('importação versionada: compara e publica como reajuste por arquivo', async () => {
    const s = await entrar('SINT.FATURAMENTO');
    const csv = 'codigo;valor_ch\n306001;111,1111\n306002;110\n999999;10\n';
    const c = await post(s, '/api/precos/importacoes', {
      tabela: 306,
      arquivo: 'tabela-306.csv',
      conteudo: csv,
    });
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ situacao: 'comparada', totais: { novos: 1, alterados: 1, iguais: 1 } });
    const id = c.json().id as number;
    const det = (await get(s, `/api/precos/importacoes/${id}`)).json();
    expect(det.linhas.map((l: { comparacao: string }) => l.comparacao)).toContain('removido');
    const ap = await post(s, `/api/precos/importacoes/${id}/aprovar`, {
      justificativa: 'tabela nova da operadora',
      senha: SENHA,
      versao: det.versao,
    });
    expect(ap.statusCode).toBe(200);
    expect(ap.json().linhas).toBe(1);
    const lista = (await get(s, '/api/precos/importacoes')).json();
    expect(lista.cargas[0]).toMatchObject({ id, situacao: 'publicada' });
    const ruim = await post(s, '/api/precos/importacoes', {
      tabela: 306,
      arquivo: 'ruim.csv',
      conteudo: 'codigo;preco\n1;2',
    });
    expect(ruim.json().situacao).toBe('preparada');
    const f = await entrar('SINT.FATURISTA');
    expect(
      (await post(f, '/api/precos/importacoes', { tabela: 306, arquivo: 'x.csv', conteudo: csv })).statusCode,
    ).toBe(403);
  });
});

describe('motor de preços (consulta)', () => {
  it('códigos de prestador sem senha; colunas bancárias só com a permissão; saneamento', async () => {
    const f = await entrar('SINT.FATURISTA');
    expect((await get(f, '/api/cadastros/convenios/codigos-prestador')).statusCode).toBe(403);
    const s = await entrar('SINT.FATURAMENTO');
    const cod = await get(s, '/api/cadastros/convenios/codigos-prestador');
    expect(cod.statusCode).toBe(200);
    expect(JSON.stringify(cod.json().itens)).not.toMatch(/SENHA_PRESTADOR|LOGIN_PRESTADOR|"senha|"login/i);
    const banco = (await get(s, '/api/faturamento/credenciamento')).json();
    expect(banco.colunas.map((c: { campo: string }) => c.campo)).toContain('conta');
    const semBanco = (await get(f, '/api/faturamento/credenciamento')).json();
    expect(semBanco.colunas.map((c: { campo: string }) => c.campo)).not.toContain('conta');
    expect(semBanco.avisos[0]).toMatch(/bancárias/);
    const dp = (await get(s, '/api/faturamento/de-para-exames?convenio=305')).json();
    expect(dp.total).toBe(2);
    const san = (await get(s, '/api/precos/saneamento')).json();
    expect(san.porOrigem).toMatchObject({ indice: 1 });
  });
});
