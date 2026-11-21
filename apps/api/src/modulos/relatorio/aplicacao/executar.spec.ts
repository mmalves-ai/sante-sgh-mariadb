// Regras 1, 3 e 4 pela HTTP (M34), com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a
// banco): SQL livre não entra (só o código de um relatório do catálogo; parâmetro desconhecido, fora do tipo ou do
// período máximo é recusado pelo Zod do relatório); emitir exige a permissão do relatório (as opções dos relatórios
// que ele substitui), a chave liberada e o acesso de origem; o tempo esgotado vira mensagem em português; a coluna de
// pessoa sai mascarada sem a permissão; toda emissão fica registrada. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { RELATORIOS_CATALOGO } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { moduloRelatorio } from '../modulo.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { PortaRelatorioMemoria } from '../porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const relatorio = new PortaRelatorioMemoria(trilha);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(
    lerConfiguracao({ ...env, API_MODULOS: 'relatorio' }),
    null,
    { ...env, API_MODULOS: 'relatorio' },
    {
      trilha,
      registro: { relatorio: async () => ({ modulo: (ctx) => moduloRelatorio(ctx, { porta: relatorio }) }) },
    },
  );
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
export async function entrarComo(a: NestFastifyApplication, login: string): Promise<Sessao> {
  const r = await a.inject({
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
const entrar = (login: string) => entrarComo(app, login);
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste-m34-${++chave}-${Date.now()}` },
    payload: payload as object,
  });

describe('catálogo (seção 7)', () => {
  it('todos os relatórios aparecem com a liberação e o que a sessão pode; a diretoria emite os seus', async () => {
    const s = await entrar('SINT.DIRETORIA');
    const c = (await get(s, '/relatorios/catalogo')).json() as {
      codigo: string;
      liberado: boolean;
      podeExecutar: boolean;
      veDadoPessoal: boolean;
    }[];
    expect(c.map((x) => x.codigo).sort()).toEqual(RELATORIOS_CATALOGO.map((r) => r.codigo).sort());
    expect(c.every((x) => x.liberado)).toBe(true);
    // A diretoria tem o painel (6785) e as estatísticas: os relatórios da onda 0; não tem o censo dos internados.
    expect(c.find((x) => x.codigo === 'atendimentosPorDia')!.podeExecutar).toBe(true);
    expect(c.find((x) => x.codigo === 'contasNaoFechadas')!.podeExecutar).toBe(false);
    expect(c[0]!.veDadoPessoal).toBe(false);
    expect(JSON.stringify(c)).not.toMatch(/SPDATA|legado|sistema atual|SELECT|FROM /i);
  });
});

describe('emissão (regras 1 e 3)', () => {
  it('emite com o parâmetro tipado; o relativo é resolvido; o total sai; a emissão fica registrada', async () => {
    const s = await entrar('SINT.DIRETORIA');
    const r = await post(s, '/relatorios/catalogo/atendimentosPorDia/executar', {
      parametros: { inicio: '2026-10-01', fim: '2026-10-03' },
    });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.quantidade).toBe(6);
    expect(b.totais.atendimentos).toBe(
      b.linhas.reduce((a: number, l: { atendimentos: number }) => a + l.atendimentos, 0),
    );
    expect(b.dadosAte).toMatch(/cópia diária/);
    const ex = (await get(s, '/relatorios/execucoes?relatorio=atendimentosPorDia')).json();
    expect(ex[0]).toMatchObject({
      relatorio: 'atendimentosPorDia',
      tipo: 'execucao',
      linhas: 6,
      situacao: 'ok',
    });
    expect(JSON.stringify(ex)).not.toContain('2026-10-01');
  });

  it('SQL livre não entra: código fora do catálogo, parâmetro desconhecido, fora do tipo ou do período', async () => {
    const s = await entrar('SINT.ADMIN');
    expect((await post(s, '/relatorios/catalogo/SELECT%201/executar', { parametros: {} })).statusCode).toBe(
      404,
    );
    expect((await post(s, '/relatorios/catalogo/naoExiste/executar', { parametros: {} })).statusCode).toBe(
      404,
    );
    const sql = await post(s, '/relatorios/catalogo/atendimentosPorDia/executar', {
      parametros: { inicio: "2026-10-01' OR 1=1 --", fim: '2026-10-02' },
    });
    expect(sql.statusCode).toBe(400);
    const extra = await post(s, '/relatorios/catalogo/atendimentosPorDia/executar', {
      parametros: { inicio: '2026-10-01', fim: '2026-10-02', sql: 'DROP TABLE X' },
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json().detail).toMatch(/Parâmetro desconhecido: sql/);
    const longo = await post(s, '/relatorios/catalogo/contasNaoFechadas/executar', {
      parametros: { inicio: '2026-01-01', fim: '2026-10-01', tipo: 'todas' },
    });
    expect(longo.statusCode).toBe(400);
    expect(longo.json().detail).toMatch(/Período acima do máximo/);
    const ruim = await post(s, '/relatorios/catalogo/contasNaoFechadas/executar', {
      parametros: { inicio: '2026-10-01', fim: '2026-10-02', tipo: 'X' },
    });
    expect(ruim.json().detail).toMatch(/opção inválida/);
  });

  it('sem a permissão do relatório, 403 (ninguém ganha acesso que não tinha)', async () => {
    const s = await entrar('SINT.RECEPCAO');
    const r = await post(s, '/relatorios/catalogo/faturamentoPorConvenio/executar', {
      parametros: { mesInicio: '2026-09', mesFim: '2026-09', regua: 'competencia' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('acima do tempo, cancelada com a mensagem em português e registrada como cancelada', async () => {
    const s = await entrar('SINT.ADMIN');
    relatorio.lento = true;
    try {
      const r = await post(s, '/relatorios/catalogo/examesPorSetor/executar', {
        parametros: { inicio: '2026-10-01', fim: '2026-10-02' },
      });
      expect(r.statusCode).toBe(422);
      expect(r.json()).toMatchObject({ codigo: 'consulta-cancelada' });
      expect(r.json().detail).toMatch(/passou do tempo máximo de 30 s e foi cancelado/);
    } finally {
      relatorio.lento = false;
    }
    const ex = (await get(s, '/relatorios/execucoes?relatorio=examesPorSetor')).json();
    expect(ex[0]).toMatchObject({ situacao: 'cancelada', linhas: 0 });
  });
});

describe('máscara do dado de pessoa (regra 4)', () => {
  it('sem a permissão, o nome sai mascarado; com ela, sai o nome', async () => {
    const adm = await entrar('SINT.ADMIN');
    const sem = await entrar('SINT.LEITOS');
    const p = { parametros: { dia: '2026-10-20' } };
    const a = (await post(adm, '/relatorios/catalogo/internadosNaData/executar', p)).json();
    expect(a.mascarado).toBe(false);
    expect(a.linhas[0].paciente).toBe('Paciente Fictício Um');
    const r = await post(sem, '/relatorios/catalogo/internadosNaData/executar', p);
    expect(r.statusCode).toBe(200);
    expect(r.json().mascarado).toBe(true);
    expect(JSON.stringify(r.json())).not.toContain('Fictício');
  });
});
