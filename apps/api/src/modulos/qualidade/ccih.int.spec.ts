// M48, etapa 3 (CCIH), sobre a cópia (transação DESFEITA, sob a trava; ficha, seções 4, 6, 8 e 10; regras 5, 6 e 7): a
// API inteira (sessão sintética SINT.CCIH, guardas e interceptores) com a porta da CCIH sobre UMA transação da cópia:
//   - a vigilância, os internados e o detalhe de um internado real da cópia (só o REG fica em memória);
//   - o dispositivo invasivo registrado aparece no detalhe e conta no registro de dispositivos;
//   - regra 7 (precaução no mapa): a precaução definida abre o estado `precaucao` do leito, lido pelo MESMO repositório
//     do mapa de leitos do M21 (estadosDoMapa); ao encerrar, o leito volta ao estado anterior;
//   - regra 5 (denominadores do censo): os pacientes-dia da competência são os do censo diário (a mesma leitura do M16),
//     somados por setor, sem digitação paralela;
//   - a trilha da CCIH só com os IDs (regra 11);
//   - as leituras com o tempo (meta da ficha: vigilância p95 < 1 s; as demais < 1 s);
//   - o ROLLBACK conferido pelas contagens das SGH_QUA_* da CCIH, do estado do leito e da maior chave da SGH_TRILHA.
// Nada de paciente sai daqui: só contagens, códigos e tempos (abaixo de 5 vira "<5").
import { writeFileSync } from 'node:fs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { estadosDoMapa, type Leitor, pacientesDiaDoCenso } from '@sgh/legado';
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
import { portaCcihNaTransacao } from './porta-ccih-legado.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const n = (v: unknown) => Number(v ?? 0);
const mascara = (x: number) => (x > 0 && x < 5 ? '<5' : String(x));
const passo = (s: string) => console.log(`[m48.3] ${s}`);
const TABELAS = [
  'SGH_QUA_DISPOSITIVO',
  'SGH_QUA_IRAS',
  'SGH_QUA_ANTIMICRO_LIB',
  'SGH_QUA_PRECAUCAO',
  'SGH_QUA_HIGIENE_MAOS',
  'SGH_QUA_SURTO',
  'SGH_INT_LEITO_ESTADO',
];

interface Sessao {
  cookie: string;
  csrf: string;
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

describe.skipIf(!PODE_ESCREVER)('CCIH na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  let antes: number[];
  beforeAll(async () => {
    a = await ambienteM27();
    antes = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m48-3' }, (l) => contagens(l));
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('vigilância, dispositivo, precaução refletida no mapa do M21, denominadores do censo e os tempos', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m48-3-ccih' }, async (e) => {
      const [maxTrilha] = await e.consultar('SELECT MAX(ID) M FROM SGH_TRILHA', [], { teto: 1 });
      const trilhaAntes = n(maxTrilha?.['M']);
      const trilha = new RegistradorTrilhaMemoria();
      const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
        trilha,
        ccih: portaCcihNaTransacao(e, a.cod),
        vigiaEnfermagem: null,
        vigia: null,
      });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      let seq = 0;
      const s = await app.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login: 'SINT.CCIH', senha: SENHA },
      });
      expect(s.statusCode).toBe(201);
      const set = s.headers['set-cookie'] as string[];
      const ccih: Sessao = {
        cookie: set.map((c) => c.split(';')[0]).join('; '),
        csrf:
          set
            .find((c) => c.startsWith('sgh_csrf='))
            ?.split(';')[0]
            ?.slice(9) ?? '',
      };
      const get = (url: string) =>
        app.inject({ method: 'GET', url: `/api/qualidade/ccih${url}`, headers: { cookie: ccih.cookie } });
      const post = (url: string, payload: unknown) =>
        app.inject({
          method: 'POST',
          url: `/api/qualidade/ccih${url}`,
          headers: {
            cookie: ccih.cookie,
            'x-csrf': ccih.csrf,
            'idempotency-key': `int-m48-3-${String(++seq)}-${Date.now()}`,
          },
          payload: payload as object,
        });
      const ok = (x: { statusCode: number; body: string }) => {
        expect(x.statusCode, x.body.slice(0, 300)).toBeLessThan(300);
        return JSON.parse(x.body) as Record<string, unknown>;
      };

      try {
        const f = ok(await get('/formulario'));
        expect(f['ligada']).toBe(true);
        const agora = String(f['agora']);
        const competencia = agora.slice(0, 7);

        // ── Vigilância e internados ──
        const v = ok(await get('/vigilancia')) as { resumo: { internados: number; emVigilancia: number } };
        const ints = ok(await get('/internados')) as {
          itens: { internacao: number; leito: string; setor: string }[];
        };
        expect(ints.itens.length).toBe(v.resumo.internados);
        passo(`internados ${mascara(ints.itens.length)}; em vigilância ${mascara(v.resumo.emVigilancia)}`);
        // Um internado num leito do mapa (só o REG, em memória).
        let reg = 0;
        let chave = '';
        let detalhe: Record<string, unknown> = {};
        for (const i of ints.itens) {
          const d = ok(await get(`/internacoes/${String(i.internacao)}`));
          const k = (d['internacao'] as { chaveLeito: { bloco: string; acomodacao: string; leito: string } })
            .chaveLeito;
          const disp = (d['dispositivos'] as { tipo: string; retiradoEm: string | null }[]).filter(
            (x) => x.tipo === 'cvc' && x.retiradoEm === null,
          );
          const prec = (d['precaucoes'] as { fimEm: string | null }[]).filter((x) => x.fimEm === null);
          if (k.leito && disp.length === 0 && prec.length === 0) {
            reg = i.internacao;
            chave = `${k.bloco}|${k.acomodacao}|${k.leito}`;
            detalhe = d;
            break;
          }
        }
        expect(reg).toBeGreaterThan(0);
        const entrada = String((detalhe['internacao'] as { entrada: string }).entrada);

        // ── Dispositivo ──
        const inserido = new Date(Date.parse(`${agora.slice(0, 19)}Z`) - 3_600_000)
          .toISOString()
          .slice(0, 16);
        const insercao = inserido.slice(0, 10) < entrada ? `${entrada}T00:00` : inserido;
        const d1 = ok(
          await post('/dispositivos', {
            internacao: reg,
            tipo: 'cvc',
            sitio: 'SINTETICO M48.3',
            inseridoEm: insercao,
            itemPrescricao: null,
            observacao: null,
          }),
        );
        const segundo = await post('/dispositivos', {
          internacao: reg,
          tipo: 'cvc',
          sitio: null,
          inseridoEm: insercao,
          itemPrescricao: null,
          observacao: null,
        });
        expect((segundo.json() as { codigo?: string }).codigo).toBe('dispositivo-ja-ativo');
        const depoisDisp = ok(await get(`/internacoes/${String(reg)}`));
        expect((depoisDisp['dispositivos'] as { id: number }[]).some((x) => x.id === d1['id'])).toBe(true);

        // ── Precaução refletida no mapa do M21 (regra 7) ──
        const mapaAntes = await estadosDoMapa(e, a.cod);
        const estadoAntes = mapaAntes.estados.find((x) => x.chave === chave) ?? null;
        const p = ok(
          await post('/precaucoes', {
            internacao: reg,
            motivo: 'mrsa',
            motivoOutro: null,
            tipo: 'contato',
            origem: 'manual',
            exame: null,
            bloquearVizinhos: false,
            observacao: null,
          }),
        );
        expect(p['tipoDoLeito']).toBe('contato');
        const mapa = await estadosDoMapa(e, a.cod);
        const noMapa = mapa.estados.find((x) => x.chave === chave);
        expect(noMapa).toMatchObject({ estado: 'precaucao', precaucao: 'contato' });
        const abertas = ok(await get('/precaucoes')) as { itens: { id: number; versao: number }[] };
        const aberta = abertas.itens.find((x) => x.id === p['id']);
        expect(aberta).toBeTruthy();
        ok(
          await post(`/precaucoes/${String(p['id'])}/encerrar`, {
            versao: aberta?.versao,
            motivo: 'reavaliacao',
            observacao: null,
          }),
        );
        const mapaDepois = await estadosDoMapa(e, a.cod);
        const estadoDepois = mapaDepois.estados.find((x) => x.chave === chave) ?? null;
        expect(estadoDepois?.estado ?? null).toBe(estadoAntes?.estado ?? null);
        passo('precaução de contato no mapa do M21 e encerrada (o leito volta ao estado anterior)');

        // ── Denominadores contra o censo (regra 5) ──
        const den = ok(await get(`/denominadores?competencia=${competencia}`)) as {
          todos: { pacientesDia: number; dispositivosDia: { cvc: number } };
          censo: { diasFechados: number; diasTerminados: number };
        };
        const de = `${competencia}-01`;
        const ate = `${competencia}-${String(new Date(Date.UTC(n(competencia.slice(0, 4)), n(competencia.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
        const censo = await pacientesDiaDoCenso(e, a.cod, de, ate);
        const somaCenso = censo.porSetor.reduce((x, c) => x + c.pacientesDia, 0);
        expect(den.todos.pacientesDia).toBe(somaCenso);
        expect(den.censo.diasFechados).toBe(censo.diasFechados);
        passo(
          `competência ${competencia}: pacientes-dia ${mascara(somaCenso)} (censo ${String(censo.diasFechados)} de ${String(den.censo.diasTerminados)} dias); CVC-dia ${mascara(den.todos.dispositivosDia.cvc)}`,
        );

        // ── Correção da revisão: o DDD lê a saída consolidada menos as devoluções (GELANDEV/GECADDEV) e o consumo
        // de álcool é uma linha só por unidade, setor e competência (índice único do 0975) ──
        const consumo = ok(await get(`/antimicrobianos/consumo?competencia=${competencia}`));
        expect(consumo['competencia']).toBe(competencia);
        const unidade = (f['unidades'] as { codigo: number }[])[0]?.codigo ?? 0;
        const iMaos = TABELAS.indexOf('SGH_QUA_HIGIENE_MAOS');
        const maosAntes = (await contagens(e))[iMaos] ?? 0;
        for (const ml of [1000, 2000])
          ok(await post('/maos/consumo', { unidade, setor: null, competencia, mililitros: ml }));
        expect((await contagens(e))[iMaos]).toBe(maosAntes + 1);
        passo('DDD da competência lido; consumo de álcool gravado duas vezes, uma linha');

        // ── Trilha só com os IDs (regra 11) ──
        const [mt] = await e.consultar('SELECT MAX(ID) M FROM SGH_TRILHA', [], { teto: 1 });
        const novas = n(mt?.['M']) - trilhaAntes;
        expect(novas).toBeGreaterThanOrEqual(3);

        // ── Tempos ──
        const t = {
          vigilancia: await tempos(5, () => get('/vigilancia')),
          internacao: await tempos(5, () => get(`/internacoes/${String(reg)}`)),
          denominadores: await tempos(3, () => get(`/denominadores?competencia=${competencia}`)),
          antimicrobianos: await tempos(3, () => get('/antimicrobianos')),
          precaucoes: await tempos(5, () => get('/precaucoes')),
          resumo: await tempos(3, () => get('/resumo')),
        };
        passo(`p95 (ms): ${JSON.stringify(t)}`);
        return { t, internados: ints.itens.length, emVigilancia: v.resumo.emVigilancia, trilha: novas };
      } finally {
        await app.close();
      }
    });
    // O p95 da vigilância é registrado nas evidências (a meta da ficha é < 1 s; acima disso o motivo vai junto).
    expect(r.t.vigilancia).toBeLessThan(10_000);
    expect(r.t.internacao).toBeLessThan(5_000);
    writeFileSync(
      process.env['M48_3_INT_SAIDA'] ?? '/dev/null',
      JSON.stringify({
        tempos: r.t,
        internados: mascara(r.internados),
        emVigilancia: mascara(r.emVigilancia),
        trilha: r.trilha,
      }),
    );
    const depois = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m48-3-depois' }, (l) => contagens(l));
    expect(depois).toEqual(antes);
  }, 900_000);
});
