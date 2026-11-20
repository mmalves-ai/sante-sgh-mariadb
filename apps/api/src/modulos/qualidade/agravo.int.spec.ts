// M48, etapa 4 (notificação compulsória), sobre a cópia (transação DESFEITA, sob a trava; ficha, seções 4, 5, 7 e 8;
// regras 3, 8 e 11): a API inteira (sessão sintética SINT.VIGILANCIA, guardas e interceptores) com a porta da
// notificação compulsória sobre UMA transação da cópia:
//   - a fila de gatilhos lida dos registros reais (CID notificável no atendimento, resultado reagente, óbito) e o resumo;
//   - regra 8: o caso aberto a partir de um gatilho real sai da fila, tem o prazo da periodicidade do cadastro de CID
//     (imediata 24 h, semanal 7 dias) e a ficha do modelo do Sinan pré-preenchida;
//   - a notificação entregue (ficha impressa) e o descarte de outro caso, com a versão lida;
//   - o exame configurado substitui a lista padrão;
//   - regra 11: a trilha só com os IDs (nenhuma linha nova com o CID ou o nome do paciente);
//   - as leituras com o tempo (a ficha pede o lote a cada 15 minutos; a meta da tela é p95 < 1 s);
//   - o ROLLBACK conferido pelas contagens das SGH_QUA_AGRAVO_* e da maior chave da SGH_TRILHA.
// Nada de paciente sai daqui: só contagens, códigos e tempos (abaixo de 5 vira "<5").
import { writeFileSync } from 'node:fs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Leitor } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  type AmbienteM27,
  ambienteM27,
  PODE_ESCREVER,
  percentil,
} from '../acesso/aplicacao/copia.spec-util.js';
import { portaAgravoNaTransacao } from './porta-agravo-legado.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const n = (v: unknown) => Number(v ?? 0);
const mascara = (x: number) => (x > 0 && x < 5 ? '<5' : String(x));
const passo = (s: string) => console.log(`[m48.4] ${s}`);
const TABELAS = ['SGH_QUA_AGRAVO_CASO', 'SGH_QUA_AGRAVO_EXAME'];
const R = '/api/qualidade/vigilancia/agravos';
// A cópia é um retrato de 2026 com o último atendimento em 07/2026: o relógio da porta é posto no fim dessa janela para a
// fila de 30 dias ter gatilhos reais (D-RELOGIO-INT-48.4); prazos, "no futuro" e atraso seguem o mesmo relógio.
const RELOGIO_DA_COPIA = process.env['M48_4_RELOGIO'] ?? '2026-07-04T23:00:00';

interface Gatilho {
  chave: string;
  origem: 'cid' | 'exame' | 'obito';
  atendimento: number;
  exame: number | null;
  paciente: { id: number; nome: string };
  cid: string;
  periodicidade: 'imediata' | 'semanal';
  gatilhoEm: string;
  prazoEm: string;
}

async function contagens(l: Pick<Leitor, 'consultar'>): Promise<number[]> {
  const r: number[] = [];
  for (const t of TABELAS)
    r.push(n((await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 }))[0]?.['N']));
  const [m] = await l.consultar('SELECT MAX(ID) M FROM SGH_TRILHA', [], { teto: 1 });
  r.push(n(m?.['M']));
  return r;
}

async function tempos(vezes: number, fn: () => Promise<unknown>): Promise<number> {
  const xs: number[] = [];
  for (let i = 0; i < vezes; i++) {
    const t0 = performance.now();
    await fn();
    xs.push(performance.now() - t0);
  }
  return Math.round(percentil(xs, 95));
}

const horas = (de: string, ate: string) =>
  (new Date(`${ate.slice(0, 19)}Z`).getTime() - new Date(`${de.slice(0, 19)}Z`).getTime()) / 3_600_000;

describe.skipIf(!PODE_ESCREVER)('notificação compulsória na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  let antes: number[];
  beforeAll(async () => {
    a = await ambienteM27();
    antes = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m48-4' }, (l) => contagens(l));
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('fila real, caso aberto do gatilho com o prazo e a ficha, notificação, descarte, exame e os tempos', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m48-4-agravo' }, async (e) => {
      const [maxTrilha] = await e.consultar('SELECT MAX(ID) M FROM SGH_TRILHA', [], { teto: 1 });
      const trilhaAntes = n(maxTrilha?.['M']);
      const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
        trilha: new RegistradorTrilhaMemoria(),
        agravo: { ...portaAgravoNaTransacao(e, a.cod), relogio: () => Promise.resolve(RELOGIO_DA_COPIA) },
        vigiaEnfermagem: null,
        vigia: null,
      });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      let seq = 0;
      try {
        const s = await app.inject({
          method: 'POST',
          url: '/api/sessao',
          payload: { estabelecimento: 'aa', login: 'SINT.VIGILANCIA', senha: SENHA },
        });
        expect(s.statusCode).toBe(201);
        const set = s.headers['set-cookie'] as string[];
        const cookie = set.map((c) => c.split(';')[0]).join('; ');
        const csrf =
          set
            .find((c) => c.startsWith('sgh_csrf='))
            ?.split(';')[0]
            ?.slice(9) ?? '';
        const get = (url: string) => app.inject({ method: 'GET', url: `${R}${url}`, headers: { cookie } });
        const post = (url: string, payload: unknown) =>
          app.inject({
            method: 'POST',
            url: `${R}${url}`,
            headers: {
              cookie,
              'x-csrf': csrf,
              'idempotency-key': `int-m48-4-${String(++seq)}-${Date.now()}`,
            },
            payload: payload as object,
          });
        const ok = (x: { statusCode: number; body: string }) => {
          expect(x.statusCode, x.body.slice(0, 300)).toBeLessThan(300);
          return JSON.parse(x.body) as Record<string, unknown>;
        };

        // ── Resumo e fila ──
        const resumo = ok(await get('/resumo'));
        expect(resumo['ligada']).toBe(true);
        expect(String(resumo['agora']).slice(0, 16)).toBe(RELOGIO_DA_COPIA.slice(0, 16));
        const fila = ok(await get('/gatilhos?dias=30')) as unknown as { itens: Gatilho[]; cortada: boolean };
        const porOrigem = { cid: 0, exame: 0, obito: 0 };
        for (const g of fila.itens) porOrigem[g.origem] += 1;
        passo(
          `fila de 30 dias: ${mascara(fila.itens.length)} gatilhos (cid ${mascara(porOrigem.cid)}, exame ${mascara(porOrigem.exame)}, óbito ${mascara(porOrigem.obito)}); cortada=${String(fila.cortada)}`,
        );
        // Regra 3: o prazo do gatilho é o da periodicidade do cadastro de CID.
        for (const g of fila.itens)
          expect(horas(g.gatilhoEm, g.prazoEm)).toBe(g.periodicidade === 'imediata' ? 24 : 168);

        const cids = ok(await get('/cids')) as unknown as { total: number; itens: { cid: string }[] };
        expect(cids.total).toBeGreaterThan(0);
        passo(`lista nacional: ${mascara(cids.total)} CIDs notificáveis`);

        let abertos = 0;
        let ficha = { perguntas: 0, preenchidas: 0, generica: false, modelo: false };
        const segredos: string[] = [];
        // Um paciente por agravo: a fila já traz só os que ainda não viraram caso (deduplicação de 30 dias).
        const escolhidos: Gatilho[] = [];
        for (const g of fila.itens) {
          if (escolhidos.length === 2) break;
          if (
            escolhidos.some((x) => x.paciente.id === g.paciente.id && x.cid.slice(0, 3) === g.cid.slice(0, 3))
          )
            continue;
          escolhidos.push(g);
        }
        const casos: { id: number; versao: number }[] = [];
        for (const g of escolhidos) {
          segredos.push(g.cid, g.paciente.nome);
          const ab = ok(
            await post('/casos', {
              origem: g.origem,
              exame: g.origem === 'exame' ? g.exame : null,
              atendimento: g.atendimento,
              paciente: g.paciente.id,
              cid: g.cid,
              gatilhoEm: g.gatilhoEm.slice(0, 16),
              observacao: null,
            }),
          );
          expect(ab['periodicidade']).toBe(g.periodicidade);
          expect(String(ab['prazoEm']).slice(0, 16)).toBe(g.prazoEm.slice(0, 16));
          const id = n(ab['id']);
          casos.push({ id, versao: n(ok(await get(`/casos/${String(id)}`))['versao']) });
          abertos += 1;
        }
        // A cópia tem poucos gatilhos na janela: o segundo caso é aberto pela vigilância (manual) para o mesmo
        // paciente, com outro agravo da lista nacional, e é o que se descarta.
        const primeiro = escolhidos[0];
        const outroCid = cids.itens.find(
          (c) => primeiro && c.cid.slice(0, 3) !== primeiro.cid.slice(0, 3),
        )?.cid;
        if (casos.length < 2 && primeiro && outroCid) {
          segredos.push(outroCid);
          const ab = ok(
            await post('/casos', {
              origem: 'manual',
              exame: null,
              atendimento: null,
              paciente: primeiro.paciente.id,
              cid: outroCid,
              gatilhoEm: RELOGIO_DA_COPIA.slice(0, 11) + '08:00',
              observacao: 'Busca ativa do teste de integração (desfeita)',
            }),
          );
          const id = n(ab['id']);
          casos.push({ id, versao: n(ok(await get(`/casos/${String(id)}`))['versao']) });
          abertos += 1;
        }
        if (casos[0]) {
          const f = ok(await get(`/casos/${String(casos[0].id)}/ficha`)) as unknown as {
            perguntas: unknown[];
            preenchidas: number;
            generica: boolean;
            modelo: unknown;
          };
          ficha = {
            perguntas: f.perguntas.length,
            preenchidas: f.preenchidas,
            generica: f.generica,
            modelo: f.modelo !== null,
          };
          expect(ficha.preenchidas).toBeGreaterThan(0);
          // O que virou caso sai da fila.
          const depois = ok(await get('/gatilhos?dias=30')) as unknown as { itens: Gatilho[] };
          expect(depois.itens.map((x) => x.chave)).not.toContain(escolhidos[0]?.chave);
          const not = ok(
            await post(`/casos/${String(casos[0].id)}/notificacao`, {
              versao: casos[0].versao,
              autoridade: 'SMS',
              canal: 'fichaImpressa',
              numero: null,
              notificadoEm: String(resumo['agora']).slice(0, 16),
              recebidoPor: null,
              observacao: null,
            }),
          );
          expect(n(not['versao'])).toBe(casos[0].versao + 1);
          // A versão antiga é recusada.
          const velho = await post(`/casos/${String(casos[0].id)}/descarte`, {
            versao: casos[0].versao,
            motivo: 'outro',
            justificativa: 'Teste de concorrência sintético',
          });
          expect(velho.statusCode).toBe(409);
        }
        expect(casos.length).toBeGreaterThanOrEqual(2);
        if (casos[1]) {
          ok(
            await post(`/casos/${String(casos[1].id)}/descarte`, {
              versao: casos[1].versao,
              motivo: 'naoConfirmado',
              justificativa: 'Descarte do teste de integração (desfeito)',
            }),
          );
          expect(ok(await get(`/casos/${String(casos[1].id)}`))['situacao']).toBe('descartado');
          // O descartado não segura a fila nem o mesmo agravo (D-DEDUP-48.4): pode abrir de novo.
        }
        passo(
          `casos abertos de gatilhos reais: ${String(abertos)}; ficha: ${String(ficha.perguntas)} perguntas, ${String(ficha.preenchidas)} pré-preenchidas, modelo=${String(ficha.modelo)}, genérica=${String(ficha.generica)}`,
        );

        // ── Exame configurado substitui a padrão ──
        const padrao = ok(await get('/gatilhos-exame')) as unknown as { itens: { fonte: string }[] };
        expect(padrao.itens.every((x) => x.fonte === 'padrao')).toBe(true);
        ok(
          await post('/gatilhos-exame', {
            gatilho: null,
            versao: null,
            padrao: 'DENGUE',
            exceto: 'IGG',
            cid: 'A90',
            ativo: true,
          }),
        );
        const conf = ok(await get('/gatilhos-exame')) as unknown as { itens: { fonte: string }[] };
        expect(conf.itens).toHaveLength(1);
        expect(conf.itens[0]?.fonte).toBe('configurado');

        // ── Regra 11: a trilha só com os IDs ──
        const [novas] = await e.consultar('SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID > ?', [trilhaAntes], {
          teto: 1,
        });
        let vazou = 0;
        for (const x of segredos) {
          const [v] = await e.consultar(
            'SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID > ? AND (CHAVE_NATURAL_ALVO CONTAINING ? OR ID_ALVO = ?)',
            [trilhaAntes, x, x],
            { teto: 1 },
          );
          vazou += n(v?.['N']);
        }
        expect(vazou).toBe(0);
        expect(n(novas?.['N'])).toBeGreaterThanOrEqual(1 + abertos);

        // ── Tempos ──
        const t = {
          resumo: await tempos(3, () => get('/resumo')),
          gatilhos7: await tempos(3, () => get('/gatilhos?dias=7')),
          gatilhos30: await tempos(3, () => get('/gatilhos?dias=30')),
          casos: await tempos(5, () => get('/casos')),
          ficha: casos[0] ? await tempos(3, () => get(`/casos/${String(casos[0]!.id)}/ficha`)) : null,
          cids: await tempos(3, () => get('/cids?busca=DENGUE')),
        };
        passo(`p95 (ms): ${JSON.stringify(t)}`);
        return {
          t,
          gatilhos: fila.itens.length,
          porOrigem,
          abertos,
          ficha,
          cids: cids.total,
          trilha: n(novas?.['N']),
        };
      } finally {
        await app.close();
      }
    });
    expect(r.t.gatilhos30).toBeLessThan(10_000);
    writeFileSync(
      process.env['M48_4_INT_SAIDA'] ?? '/dev/null',
      JSON.stringify({
        tempos: r.t,
        gatilhos: mascara(r.gatilhos),
        porOrigem: {
          cid: mascara(r.porOrigem.cid),
          exame: mascara(r.porOrigem.exame),
          obito: mascara(r.porOrigem.obito),
        },
        abertos: r.abertos,
        ficha: r.ficha,
        cids: r.cids,
        trilha: r.trilha,
      }),
    );
    const depois = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m48-4-depois' }, (l) => contagens(l));
    expect(depois).toEqual(antes);
  }, 900_000);
});
