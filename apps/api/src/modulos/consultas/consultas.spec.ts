// M14 pela HTTP (consultas somente leitura), com a sessão real sobre a fonte sintética e as linhas sintéticas
// da consulta (nada conecta a banco): índice só com o que a pessoa lê, descrição sem nome de tabela, página
// com máscara e cursor, tabela grande recusada sem filtro, registro de dado de pessoa auditado, consulta clínica
// só para o perfil clínico e o auditor (evento de leitura de prontuário), exportação com justificativa e o painel
// da matriz. Também: inativação só no novo pela API do CRUD genérico e domínio oficial/travado sem gravação.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  CONSULTAS_DECLARADAS,
  DOMINIOS_DECLARADOS,
  EVENTOS_AUDITAVEIS,
  esquemaPainelMatriz,
  rotaDaConsulta,
} from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
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
    // O domínio de auditoria não é lido pelo auditor; a rota própria das consultas é.
    expect((await get(s, '/api/cadastros/dominios/auditoria/justificativaExportacao/itens')).statusCode).toBe(
      403,
    );
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
  it('painel da matriz: 1.503 tabelas, descartadas com justificativa; só o administrador', async () => {
    const s = await entrar('SINT.ADMIN');
    const r = await get(s, '/api/administracao/coexistencia/matriz');
    expect(r.statusCode).toBe(200);
    const p = esquemaPainelMatriz.parse(r.json());
    expect(p.resumo.total).toBe(1503);
    expect(p.resumo.descartadas).toBe(50);
    expect(p.tabelas.filter((t) => t.atendimento === 'descartada').every((t) => t.justificativa)).toBe(true);
    const rhs = await entrar('SINT.RH');
    expect((await get(rhs, '/api/administracao/coexistencia/matriz')).statusCode).toBe(403);
  });
});

describe('domínios do lote pela HTTP (M14)', () => {
  const soNoNovo = DOMINIOS_DECLARADOS.find(
    (d) =>
      d.marco === 'M14' && d.natureza === 'editavel' && d.modulo === 'pessoas' && d.acoes.includes('criar'),
  )!;
  const oficial = DOMINIOS_DECLARADOS.find((d) => d.marco === 'M14' && d.natureza === 'carga-referencia')!;
  it('inativação só no novo (sem coluna de situação): a lista mostra o item inativo; não reinativa', async () => {
    const s = await entrar('SINT.RH');
    const base = `/api/cadastros/dominios/${soNoNovo.modulo}/${soNoNovo.recurso}`;
    const d = await get(s, base);
    expect(d.statusCode).toBe(200);
    expect(d.json().inativacaoSoNoNovo).toBe(true);
    const lista = (await get(s, `${base}/itens`)).json() as { itens: { codigo: string; versao: string }[] };
    const alvo = lista.itens[1]!;
    const r = await app.inject({
      method: 'POST',
      url: `${base}/itens/${encodeURIComponent(alvo.codigo)}/inativar`,
      headers: h(s),
      payload: { motivo: 'não é mais usado (teste)', versao: alvo.versao },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ destino: 'memoria', operacao: `${soNoNovo.modulo}.inativarNoNovo` });
    const depois = (await get(s, `${base}/itens?inativos=sim`)).json() as {
      itens: { codigo: string; ativo: boolean }[];
    };
    expect(depois.itens.find((i) => i.codigo === alvo.codigo)?.ativo).toBe(false);
    const de2 = await app.inject({
      method: 'POST',
      url: `${base}/itens/${encodeURIComponent(alvo.codigo)}/inativar`,
      headers: h(s),
      payload: { motivo: 'não é mais usado (teste)', versao: alvo.versao },
    });
    expect(de2.statusCode).toBe(409);
    // Correção do M14: a reativação desfaz a inativação só no novo (e a segunda vez é recusada).
    const inativo = (await get(s, `${base}/itens?inativos=sim`))
      .json()
      .itens.find((i: { codigo: string }) => i.codigo === alvo.codigo) as { versao: string };
    const re = await app.inject({
      method: 'POST',
      url: `${base}/itens/${encodeURIComponent(alvo.codigo)}/reativar`,
      headers: h(s),
      // W0-02: a reativação pede o motivo (vai ao registro do evento junto do valor anterior).
      payload: { versao: inativo.versao, motivo: 'voltou a ser usado (teste)' },
    });
    expect(re.statusCode).toBe(200);
    expect(re.json()).toMatchObject({ operacao: `${soNoNovo.modulo}.reativarNoNovo` });
    expect(trilha.eventos.map((e) => e.evento)).toContain(EVENTOS_AUDITAVEIS.dominioReativadoNoNovo.codigo);
    const ativo = (await get(s, `${base}/itens`))
      .json()
      .itens.find((i: { codigo: string }) => i.codigo === alvo.codigo) as { ativo: boolean; versao: string };
    expect(ativo.ativo).toBe(true);
    const re2 = await app.inject({
      method: 'POST',
      url: `${base}/itens/${encodeURIComponent(alvo.codigo)}/reativar`,
      headers: h(s),
      payload: { versao: ativo.versao, motivo: 'de novo, para conferir' },
    });
    expect(re2.statusCode).toBe(409);
  });
  it('correção do M14: legenda do novo (motivo de alta, ato sem linha) e textos longos em leitura', async () => {
    const s = await entrar('SINT.ADMIN');
    const comLegenda = DOMINIOS_DECLARADOS.filter((d) => d.marco === 'M14');
    let viu = 0;
    for (const d of comLegenda) {
      const base = `/api/cadastros/dominios/${d.modulo}/${d.recurso}`;
      const desc = (await get(s, base)).json() as { legenda?: string; textosLongos?: { campo: string }[] };
      if (desc.legenda) {
        const itens = (await get(s, `${base}/itens`)).json().itens as { legenda?: string }[];
        if (itens.length) expect(itens.every((i) => typeof i.legenda === 'string')).toBe(true);
        viu++;
      }
      if (desc.textosLongos?.length) {
        const itens = (await get(s, `${base}/itens`)).json().itens as { codigo: string }[];
        const t = await get(s, `${base}/itens/${encodeURIComponent(itens[0]!.codigo)}/textos`);
        expect(t.statusCode).toBe(200);
        expect(Object.keys(t.json().textos)).toEqual(desc.textosLongos.map((c) => c.campo));
        viu++;
      }
    }
    expect(viu).toBeGreaterThan(3);
  });
  it('domínio oficial: só consulta (403 ao incluir)', async () => {
    const s = await entrar('SINT.ADMIN');
    const base = `/api/cadastros/dominios/${oficial.modulo}/${oficial.recurso}`;
    const d = await get(s, base);
    expect(d.json()).toMatchObject({ natureza: 'carga-referencia', permitidas: ['ler', 'exportar'] });
    const r = await app.inject({
      method: 'POST',
      url: `${base}/itens`,
      headers: h(s),
      payload: { valores: {} },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('correção do M14: escopo do M06 nas consultas', () => {
  it('fonte: restrito sem coluna falha fechado; com coluna, só os valores aceitos; a API responde 403', async () => {
    const { fonteConsultasMemoria } = await import('./fonte.js');
    const { problemaDaConsulta } = await import('./consultas.controller.js');
    const { CONSULTAS_LEGADO, ErroEscopo } = await import('@sgh/legado');
    const f = fonteConsultasMemoria();
    const comEscopo = CONSULTAS_LEGADO.find((d) => d.escopos?.convenio)!;
    const semEscopo = CONSULTAS_LEGADO.find((d) => !d.escopos && d.publico.modulo === 'faturamento')!;
    const ctx = { rede: 'r', hospital: 'aa' };
    await expect(
      f.pagina({ ...ctx, escopo: { convenio: ['1'] } }, semEscopo, [], null, 10),
    ).rejects.toBeInstanceOf(ErroEscopo);
    const campo = comEscopo.colunas.find((c) => c.coluna === comEscopo.escopos!.convenio)!.campo;
    const p = await f.pagina({ ...ctx, escopo: { convenio: ['2'] } }, comEscopo, [], null, 10);
    expect(p.linhas.length).toBeGreaterThan(0);
    expect(p.linhas.every((l) => String(l[campo]) === '2')).toBe(true);
    expect(
      (await f.pagina({ ...ctx, escopo: { convenio: null } }, comEscopo, [], null, 10)).linhas.length,
    ).toBe(5);
    expect(problemaDaConsulta(new ErroEscopo('x')).getStatus()).toBe(403);
  });
});
