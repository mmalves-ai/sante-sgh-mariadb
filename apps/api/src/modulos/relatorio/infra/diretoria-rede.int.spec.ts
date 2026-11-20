// Integração do BI consolidado da Rede nas DUAS cópias (M57, etapa 3; regras 8, 10, 11 e 12; ficha, seção 10): a API
// inteira, com a sessão sintética da diretoria da Rede (só o perfil `diretoria-rede`) e o movimento REAL lido banco a
// banco (a cópia 3351 como `pc` e a 3352 como o estabelecimento sintético `sx`; as duas cópias são o mesmo banco, então
// a parte de cada uma é igual e o consolidado soma as duas):
//   - regra 10: a diretoria da Rede vê o consolidado e não abre prontuário (403), sem nenhuma permissão `pep.*`;
//   - regra 8: em cada indicador, o numerador da Rede é a soma das partes e o denominador também (os dias do período
//     uma vez), e o valor sai da conta, não da média das taxas;
//   - o painel operacional da Rede soma as contagens dos dois bancos;
//   - regra 11: o registro dos serviços compartilhados grava, numa transação DESFEITA, só SGH_REDE_SERVICO_COMPART e a
//     SGH_TRILHA no banco da sessão; a lista lê os dois bancos em separado.
// Nenhum dado de pessoa sai (só contagens e somas). Rodar: flock …/copia.lock flock …/copia2/copia.lock env
// FB_PC_PORTA=3351 SGH_INT_REDE_PORTA2=3352 ./pnpm exec vitest run --config apps/api/vitest.integracao.config.ts
// src/modulos/relatorio/infra
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { contagensServicosCompartilhados, escritasDaTransacao, type Escritor } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { fonteInternacaoLegado } from '../../internacao/fonte.js';
import {
  type AmbienteDuasCopias,
  ambienteDuasCopias,
  DUAS_COPIAS,
  emDuasTransacoesDesfeitas,
  SEGUNDO,
} from '../../rede/infra/duas-copias.spec-util.js';
import { portaServicosRedeNasTransacoes } from '../../rede/servicos/porta-legado.js';

const envDaRede = (rede: string): Record<string, string> => ({
  ...envTeste,
  // A rede da sessão é a do núcleo das cópias (a leitura de outra rede é recusada pelo núcleo).
  REDE_PADRAO: rede,
  AMBIENTE: 'dev',
  ESTABELECIMENTOS: `pc,${SEGUNDO}`,
  FB_PC_HOST: '127.0.0.1',
  FB_PC_PORTA: '1',
  FB_PC_BANCO: '/x/pc.fdb',
  FB_PC_USUARIO: 'U',
  FB_PC_NOME: 'Estabelecimento da cópia 1',
  [`FB_${SEGUNDO.toUpperCase()}_HOST`]: '127.0.0.1',
  [`FB_${SEGUNDO.toUpperCase()}_PORTA`]: '2',
  [`FB_${SEGUNDO.toUpperCase()}_BANCO`]: '/x/sx.fdb',
  [`FB_${SEGUNDO.toUpperCase()}_USUARIO`]: 'U',
  [`FB_${SEGUNDO.toUpperCase()}_NOME`]: 'Estabelecimento da cópia 2',
});
const seguro = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));

interface Sessao {
  cookie: string;
  csrf: string;
}

async function montarApp(
  a: AmbienteDuasCopias,
  transacoes: ReadonlyMap<string, Escritor> | null,
): Promise<NestFastifyApplication> {
  const env = envDaRede(a.rede);
  const app = await criarApp(lerConfiguracao(env), null, env, {
    trilha: new RegistradorTrilhaMemoria(),
    internacao: fonteInternacaoLegado(a.nucleo),
    ...(transacoes ? { servicosRede: portaServicosRedeNasTransacoes(transacoes) } : {}),
  });
  await app.init();
  return app;
}

async function entrar(app: NestFastifyApplication, login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'pc', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const cookie = (r.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
  return { cookie, csrf: /sgh_csrf=([^;]+)/.exec(cookie)?.[1] ?? '' };
}

describe.skipIf(!DUAS_COPIAS)('BI consolidado da Rede nas duas cópias', () => {
  let a: AmbienteDuasCopias;
  let app: NestFastifyApplication;
  let rede: Sessao;
  beforeAll(async () => {
    a = await ambienteDuasCopias();
    app = await montarApp(a, null);
    rede = await entrar(app, 'SINT.DIRETORIA.REDE');
  }, 900_000);
  afterAll(async () => {
    await app?.close();
    await a?.nucleo.encerrar();
  });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie: rede.cookie } });

  it('regra 10: a diretoria da Rede sem nenhuma permissão do prontuário; o prontuário responde 403', async () => {
    const s = (await get('/api/sessao')).json() as { permissoes: string[] };
    expect(s.permissoes).toContain('relatorio.biRede.acessar');
    expect(s.permissoes.filter((p) => p.startsWith('pep.'))).toEqual([]);
    for (const url of ['/api/pep/paciente/1/cabecalho', '/api/pep/paciente/1/linha-do-tempo'])
      expect((await get(url)).statusCode).toBe(403);
  });

  it('regra 8: o consolidado dos dois bancos é a soma das partes (numerador e denominador), não a média', async () => {
    const t0 = performance.now();
    const r = await get('/api/relatorios/bi/rede?de=2025-01&ate=2025-06');
    const ms = Math.round(performance.now() - t0);
    expect(r.statusCode).toBe(200);
    const b = r.json() as {
      estabelecimentos: { codigo: string; situacao: string }[];
      indicadores: {
        ficha: { codigo: string; denominador: string | null };
        recusa: unknown;
        ultimo: {
          periodo: string;
          numerador: number;
          denominador: number | null;
          valor: number | null;
          parcelas: {
            estabelecimento: string;
            numerador: number;
            denominador: number | null;
            valor: number | null;
          }[];
        } | null;
      }[];
    };
    expect(b.estabelecimentos.map((e) => [e.codigo, e.situacao])).toEqual([
      ['pc', 'incluido'],
      [SEGUNDO, 'incluido'],
    ]);
    const resumo: Record<string, string> = {};
    for (const i of b.indicadores) {
      expect(i.recusa).toBeNull();
      const u = i.ultimo!;
      expect(u.parcelas.map((p) => p.estabelecimento)).toEqual(['pc', SEGUNDO]);
      const [p1, p2] = u.parcelas as [(typeof u.parcelas)[0], (typeof u.parcelas)[0]];
      // As duas cópias são o mesmo banco: as partes são iguais.
      expect(p1.numerador).toBe(p2.numerador);
      expect(u.numerador).toBeCloseTo(p1.numerador + p2.numerador, 2);
      if (i.ficha.codigo === 'mediaPacientesDia') expect(u.denominador).toBe(p1.denominador);
      else if (i.ficha.denominador)
        expect(u.denominador).toBeCloseTo((p1.denominador ?? 0) + (p2.denominador ?? 0), 2);
      // Com as partes iguais, a taxa da Rede é a de cada parte (Σ÷Σ = a÷b); a contagem dobra.
      // O censo médio diário da Rede (Σ pacientes-dia ÷ dias do mês) é o dobro do de cada parte.
      if (i.ficha.codigo === 'mediaPacientesDia') expect(u.valor).toBeCloseTo(2 * (p1.valor ?? 0), 1);
      else if (i.ficha.denominador) expect(u.valor).toBeCloseTo(p1.valor ?? 0, 1);
      else expect(u.valor).toBe(2 * p1.numerador);
      resumo[i.ficha.codigo] =
        `${seguro(u.numerador)}/${u.denominador === null ? '-' : seguro(u.denominador)}`;
    }
    console.log(
      `BI da Rede (2 bancos, ${ms} ms, último mês fechado, Rede numerador/denominador):`,
      JSON.stringify(resumo),
    );
  }, 600_000);

  it('o painel operacional da Rede soma as contagens dos dois bancos', async () => {
    const r = await get('/api/relatorios/bi/rede/paineis/operacional?de=2025-05&ate=2025-06');
    expect(r.statusCode).toBe(200);
    const p = r.json() as {
      series: {
        codigo: string;
        valores: { valor: number | null }[];
        parcelas: { valores: { valor: number | null }[] }[];
      }[];
    };
    expect(p.series.length).toBeGreaterThan(0);
    for (const s of p.series)
      for (let k = 0; k < s.valores.length; k++)
        expect(s.valores[k]!.valor).toBe(
          (s.parcelas[0]!.valores[k]!.valor ?? 0) + (s.parcelas[1]!.valores[k]!.valor ?? 0),
        );
  }, 600_000);

  it('regra 11: o registro dos serviços grava só SGH_ no banco da sessão (transação desfeita); a lista lê os dois', async () => {
    // As contagens das tabelas que o registro escreve, em READ ONLY e em cada banco, antes e depois do ROLLBACK: um
    // commit que escapasse da transação desfeita (por outra conexão ou pela porta) mudaria alguma delas.
    const contagens = async () => {
      const r: Record<string, unknown> = {};
      for (const h of ['pc', SEGUNDO])
        r[h] = await a.nucleo.lerSomente(
          { rede: a.rede, hospital: h, traceId: `int-m57-3-contagem-${h}` },
          (l) => contagensServicosCompartilhados(l),
        );
      return r;
    };
    const antes = await contagens();
    await emDuasTransacoesDesfeitas(a, async (transacoes) => {
      const app2 = await montarApp(a, transacoes);
      try {
        const s = await entrar(app2, 'SINT.DIRETORIA.REDE');
        const post = (url: string, payload: unknown) =>
          app2.inject({
            method: 'POST',
            url,
            payload: payload as Record<string, unknown>,
            headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `int-${Math.random()}` },
          });
        const r = await post('/api/rede/servicos', {
          area: 'compras',
          titulo: 'Compra conjunta SINTETICA de teste',
          estabelecimentos: ['pc', SEGUNDO],
        });
        expect(r.statusCode).toBe(201);
        const x = r.json() as { id: number; estabelecimento: string };
        expect(x.estabelecimento).toBe('pc');
        const alt = await post(`/api/rede/servicos/pc/${x.id}`, { situacao: 'em_estudo' });
        expect(alt.json()).toMatchObject({ mudou: true, registro: { situacao: 'em_estudo' } });
        const l = (
          await app2.inject({ method: 'GET', url: '/api/rede/servicos', headers: { cookie: s.cookie } })
        ).json() as { itens: { id: number; estabelecimento: string }[]; foraDoAr: string[] };
        expect(l.foraDoAr).toEqual([]);
        expect(l.itens.some((i) => i.id === x.id && i.estabelecimento === 'pc')).toBe(true);
        const escritasPc = [
          ...new Set((await escritasDaTransacao(transacoes.get('pc')!)).map((w) => w.tabela)),
        ].sort();
        const escritasSx = [
          ...new Set((await escritasDaTransacao(transacoes.get(SEGUNDO)!)).map((w) => w.tabela)),
        ].sort();
        expect(escritasPc).toEqual(['SGH_REDE_SERVICO_COMPART', 'SGH_TRILHA']);
        expect(escritasSx).toEqual([]);
        console.log(
          'serviços compartilhados: tabelas escritas pc',
          JSON.stringify(escritasPc),
          'sx',
          JSON.stringify(escritasSx),
        );
      } finally {
        await app2.close();
      }
    });
    expect(await contagens()).toEqual(antes);
  }, 600_000);
});
