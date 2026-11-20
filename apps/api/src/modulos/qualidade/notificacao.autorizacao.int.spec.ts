// M48, etapa 1, sobre a cópia (transação DESFEITA, sob a trava; ficha, seções 4, 5, 8 e 10; regras 1, 3 e 11): a API
// inteira (sessões sintéticas, guardas, interceptores e o log) com a porta da qualidade sobre UMA transação da cópia:
//   - regra 1 (anonimato): a notificação anônima de um login sintético, a partir de um atendimento real da cópia (só
//     pelo ID), não deixa o login em nenhuma coluna de texto das SGH_QUA_*, nas linhas novas da SGH_TRILHA, nas
//     SGH_CFG_COEX_* nem no log capturado; a identificada (outro login) é o controle positivo (o login aparece);
//   - o fluxo do NSP na cópia: lista, triagem com a reclassificação, distribuição a uma conta ativa da cópia (a busca do
//     gestor), devolutiva lida pelo número e o código, os campos do Notivisa (o paciente só com iniciais) e a
//     transcrição; a trilha do NSP só com o ID e o protocolo (regra 11);
//   - o reenvio pela mesma chave não grava outra linha de trilha; o gestor da área lê pela API só a distribuída a ele,
//     sem o notificador e sem o autor de cada passo (regra 1);
//   - as leituras da etapa com o tempo (meta: p95 < 300 ms no contexto pela PK; < 500 ms nas demais);
//   - o ROLLBACK conferido pelas contagens das SGH_QUA_* e pela maior chave da SGH_TRILHA (iguais antes e depois).
// Nada de paciente sai daqui: o atendimento e a conta do gestor ficam só em memória; só contagens, códigos e tempos.
import { writeFileSync } from 'node:fs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  buscarUsuariosGestao,
  contextoDaNotificacao,
  distribuirNotificacaoSgh,
  feriadosDoPeriodo,
  type Leitor,
  notificacaoPorProtocoloSgh,
  notificacoesComPrazoSgh,
  notificacoesSgh,
  somenteSgh,
  unidadesParaNotificacao,
} from '@sgh/legado';
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
  usuariosAtivos,
} from '../acesso/aplicacao/copia.spec-util.js';
import { portaQualidadeNaTransacao } from './porta-legado.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const ANONIMO = 'SINT.ENFERMEIRO';
const IDENTIFICADO = 'SINT.MEDICO';
const n = (v: unknown) => Number(v ?? 0);
const mascara = (x: number) => (x > 0 && x < 5 ? '<5' : String(x));
const passo = (s: string) => console.log(`[m48.1] ${s}`);

interface Sessao {
  cookie: string;
  csrf: string;
}

/** Tabelas por prefixo e as colunas de texto de cada uma (CHAR, VARCHAR e BLOB de texto). */
async function colunasDeTexto(
  l: Pick<Leitor, 'consultar'>,
  prefixo: string,
  minimo = 15,
): Promise<Map<string, string[]>> {
  // Só as colunas que cabem o termo (a CHAR(1) não o contém, e o Firebird recusa o parâmetro maior que a coluna).
  const linhas = await l.consultar(
    `SELECT TRIM(rf.RDB$RELATION_NAME) T, TRIM(rf.RDB$FIELD_NAME) C
       FROM RDB$RELATION_FIELDS rf
       JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
       JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
      WHERE rf.RDB$RELATION_NAME STARTING WITH ? AND r.RDB$VIEW_BLR IS NULL
        AND ((f.RDB$FIELD_TYPE IN (14, 37) AND COALESCE(f.RDB$CHARACTER_LENGTH, f.RDB$FIELD_LENGTH) >= ?)
             OR (f.RDB$FIELD_TYPE = 261 AND f.RDB$FIELD_SUB_TYPE = 1))
      ORDER BY 1, 2`,
    [prefixo, minimo],
    { teto: 2000 },
  );
  const m = new Map<string, string[]>();
  for (const x of linhas) {
    const t = String(x['T']);
    m.set(t, [...(m.get(t) ?? []), String(x['C'])]);
  }
  return m;
}

/** Linhas que contêm o termo em alguma coluna de texto (o filtro extra restringe às linhas novas). */
async function ocorrencias(
  l: Pick<Leitor, 'consultar'>,
  tabelas: Map<string, string[]>,
  termo: string,
  filtro: (t: string) => { sql: string; params: unknown[] } = () => ({ sql: '', params: [] }),
): Promise<number> {
  let total = 0;
  for (const [t, cols] of tabelas) {
    const f = filtro(t);
    const onde = cols.map((c) => `${c} CONTAINING ?`).join(' OR ');
    const [r] = await l.consultar(
      `SELECT COUNT(*) N FROM ${t} WHERE (${onde})${f.sql}`,
      [...cols.map(() => termo), ...f.params],
      { teto: 1 },
    );
    total += n(r?.['N']);
  }
  return total;
}

async function contagensQua(l: Pick<Leitor, 'consultar'>): Promise<number[]> {
  const r: number[] = [];
  for (const t of ['SGH_QUA_NOTIFICACAO', 'SGH_QUA_NOTIF_EVENTO', 'SGH_QUA_NOTIF_PROTOCOLO'])
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

describe.skipIf(!PODE_ESCREVER)('notificação de incidentes na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  let antes: number[];
  beforeAll(async () => {
    a = await ambienteM27();
    antes = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m48' }, (l) => contagensQua(l));
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('regra 1: a anônima não deixa o login em lugar nenhum; o fluxo do NSP com a trilha só pelo ID', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m48-notificacao' }, async (e) => {
      // Um atendimento ativo da cópia (só o ID, em memória) e uma conta ativa para gestor da área.
      const [at] = await e.consultar(
        `SELECT FIRST 1 a.ID FROM ATCABECATEND a
          WHERE COALESCE(a.ATIVO, 'T') = 'T' AND a.ID_TBUNIDAD IS NOT NULL ORDER BY a.ID DESC`,
        [],
        { teto: 1 },
      );
      const atendimento = n(at?.['ID']);
      expect(atendimento).toBeGreaterThan(0);
      const { a: gestor } = await usuariosAtivos(e);
      const [maxTrilha] = await e.consultar('SELECT MAX(ID) M FROM SGH_TRILHA', [], { teto: 1 });
      const trilhaAntes = n(maxTrilha?.['M']);

      // O log da API inteira (stdout e stderr) enquanto as requisições correm.
      const capturado: string[] = [];
      const escrever = {
        out: process.stdout.write.bind(process.stdout),
        err: process.stderr.write.bind(process.stderr),
      };
      const capturar =
        (orig: typeof process.stdout.write) =>
        (pedaco: string | Uint8Array, ...resto: unknown[]): boolean => {
          capturado.push(typeof pedaco === 'string' ? pedaco : Buffer.from(pedaco).toString('utf8'));
          return (orig as (...x: unknown[]) => boolean)(pedaco, ...resto);
        };
      const trilha = new RegistradorTrilhaMemoria();
      const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
        trilha,
        qualidade: portaQualidadeNaTransacao(e, a.cod),
        vigiaEnfermagem: null,
        vigia: null,
      });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      let seq = 0;
      const entrar = async (login: string): Promise<Sessao> => {
        const s = await app.inject({
          method: 'POST',
          url: '/api/sessao',
          payload: { estabelecimento: 'aa', login, senha: SENHA },
        });
        expect(s.statusCode).toBe(201);
        const set = s.headers['set-cookie'] as string[];
        return {
          cookie: set.map((c) => c.split(';')[0]).join('; '),
          csrf:
            set
              .find((c) => c.startsWith('sgh_csrf='))
              ?.split(';')[0]
              ?.slice(9) ?? '',
        };
      };
      const get = (s: Sessao, url: string) =>
        app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
      const post = (s: Sessao, url: string, payload: unknown = {}, chave?: string) =>
        app.inject({
          method: 'POST',
          url: `/api${url}`,
          headers: {
            cookie: s.cookie,
            'x-csrf': s.csrf,
            'idempotency-key': chave ?? `int-m48-${String(++seq)}-${Date.now()}`,
          },
          payload: payload as object,
        });
      const codigoDe = (x: { statusCode: number; json: () => unknown }) =>
        x.statusCode >= 400 ? String((x.json() as { codigo?: string }).codigo ?? x.statusCode) : 'ok';

      process.stdout.write = capturar(escrever.out) as typeof process.stdout.write;
      process.stderr.write = capturar(escrever.err) as typeof process.stderr.write;
      try {
        const anon = await entrar(ANONIMO);
        const ident = await entrar(IDENTIFICADO);
        const nsp = await entrar('SINT.NSP');
        const f = await get(anon, '/qualidade/notificacoes/formulario');
        expect(f.statusCode).toBe(200);
        const agora = String((f.json() as { agora: string }).agora);
        const ocorrido = new Date(Date.parse(`${agora.slice(0, 19)}Z`) - 2 * 3_600_000)
          .toISOString()
          .slice(0, 16);
        const corpo = (x: Record<string, unknown>) => ({
          atendimento,
          unidade: null,
          local: null,
          ocorridoEm: ocorrido,
          tipo: 'queda',
          tipoOutro: null,
          chegouAoPaciente: true,
          danoPercebido: 'obito',
          descricao: 'SINTETICO M48: queda ao sair do leito (texto de teste).',
          anonima: false,
          origem: { tela: '/pep/prontuario' },
          ...x,
        });
        const rAnon = await post(anon, '/qualidade/notificacoes', corpo({ anonima: true }));
        expect(codigoDe(rAnon)).toBe('ok');
        const anonima = rAnon.json() as { protocolo: string; codigoAcompanhamento: string };
        const chaveIdent = `int-m48-reenvio-${Date.now()}`;
        const rIdent = await post(
          ident,
          '/qualidade/notificacoes',
          corpo({ danoPercebido: 'leve' }),
          chaveIdent,
        );
        expect(codigoDe(rIdent)).toBe('ok');
        const identificada = rIdent.json() as { protocolo: string };
        passo(`duas notificações gravadas na transação (${anonima.protocolo.slice(0, 8)}…)`);
        // O reenvio pela mesma chave: o mesmo número, nenhuma linha nova (nem na SGH_QUA_*, nem na SGH_TRILHA).
        const rep = await post(
          ident,
          '/qualidade/notificacoes',
          corpo({ danoPercebido: 'leve' }),
          chaveIdent,
        );
        expect(codigoDe(rep)).toBe('ok');
        expect(rep.json()).toMatchObject({ protocolo: identificada.protocolo, repetida: true });
        const [doReenvio] = await e.consultar(
          `SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID > ? AND EVENTO = 'qualidade.incidente.notificado'
              AND CHAVE_NATURAL_ALVO = ?`,
          [trilhaAntes, identificada.protocolo],
          { teto: 1 },
        );
        expect(n(doReenvio?.['N'])).toBe(1);
        passo('reenvio pela mesma chave: 1 linha de trilha da notificação');

        // O NSP: a lista, o detalhe (sem imprimir), a triagem e o fluxo.
        const l = await get(nsp, '/qualidade/nsp/notificacoes');
        expect(l.statusCode).toBe(200);
        const itens = (l.json() as { itens: { id: number; protocolo: string; anonima: boolean }[] }).itens;
        const idAnon = itens.find((x) => x.protocolo === anonima.protocolo)?.id ?? 0;
        expect(idAnon).toBeGreaterThan(0);
        const prox = (await get(nsp, '/qualidade/nsp/notificacoes/proxima')).json() as { id: number };
        expect(prox.id).toBe(idAnon); // óbito no topo (atenção imediata)
        const d = await get(nsp, `/qualidade/nsp/notificacoes/${idAnon}`);
        expect(d.statusCode).toBe(200);
        const det = (
          d.json() as {
            notificacao: {
              versao: number;
              notificador: string | null;
              paciente: unknown;
              prazos: { tipo: string }[];
            };
          }
        ).notificacao;
        expect(det.notificador).toBeNull();
        expect(det.paciente).not.toBeNull();
        expect(det.prazos.map((p) => p.tipo).sort()).toEqual(['analiseCausaRaiz', 'notivisaObito']);
        const t = await post(nsp, `/qualidade/nsp/notificacoes/${idAnon}/triar`, {
          versao: det.versao,
          tipo: 'queda',
          tipoOutro: null,
          classificacao: 'eventoAdverso',
          dano: 'obito',
          neverEvent: true,
          justificativa: 'SINTETICO M48: never event confirmado na triagem.',
        });
        expect(codigoDe(t)).toBe('ok');
        const v1 = (t.json() as { versao: number }).versao;
        const g = await get(nsp, `/qualidade/nsp/gestores?busca=${encodeURIComponent(gestor.slice(0, 4))}`);
        expect(g.statusCode).toBe(200);
        expect((g.json() as { itens: unknown[] }).itens.length).toBeGreaterThan(0);
        const unidades = (f.json() as { unidades: { codigo: number }[] }).unidades;
        const dist = await post(nsp, `/qualidade/nsp/notificacoes/${idAnon}/distribuir`, {
          versao: v1,
          gestor,
          unidade: unidades[0]?.codigo ?? 0,
          prazoAnalise: agora.slice(0, 4) + '-12-31',
          orientacao: null,
        });
        expect(codigoDe(dist)).toBe('ok');
        const v2 = (dist.json() as { versao: number }).versao;
        const dev = await post(nsp, `/qualidade/nsp/notificacoes/${idAnon}/devolutiva`, {
          versao: v2,
          texto: 'SINTETICO M48: revisamos o piso e a grade do leito.',
        });
        expect(codigoDe(dev)).toBe('ok');
        const v3 = (dev.json() as { versao: number }).versao;
        const acomp = await post(anon, '/qualidade/notificacoes/acompanhar', {
          protocolo: anonima.protocolo,
          codigo: anonima.codigoAcompanhamento,
        });
        expect(codigoDe(acomp)).toBe('ok');
        expect((acomp.json() as { devolutivas: unknown[] }).devolutivas).toHaveLength(1);
        const campos = await post(nsp, `/qualidade/nsp/notificacoes/${idAnon}/notivisa/campos`);
        expect(codigoDe(campos)).toBe('ok');
        const c = (campos.json() as { campos: { obito: boolean; paciente: { iniciais: string } | null } })
          .campos;
        expect(c.obito).toBe(true);
        expect(/^([A-Z]\.)+$/.test(c.paciente?.iniciais ?? '')).toBe(true);
        const tr = await post(nsp, `/qualidade/nsp/notificacoes/${idAnon}/notivisa/transcricao`, {
          versao: v3,
          numeroNotivisa: 'SINT-2026-1',
          transcritaEm: agora.slice(0, 16),
        });
        expect(codigoDe(tr)).toBe('ok');
        const pz = await get(nsp, '/qualidade/nsp/prazos/resumo');
        expect(pz.statusCode).toBe(200);
        passo('triagem, distribuição, devolutiva, Notivisa e transcrição gravados');

        // Regra 1, o gestor da área pela API: a conta da distribuição acima é da cópia (sem sessão sintética), então a
        // identificada é distribuída pela gravação do adaptador (`distribuirNotificacaoSgh`), NESTA transação
        // desfeita, a um login sintético; ele a vê sem quem notificou e sem o autor de cada passo, e a outra (de outro
        // gestor) responde como não encontrada.
        const GESTOR_SINT = 'SINT.ESCALA';
        const ni = await notificacaoPorProtocoloSgh(e, a.cod, identificada.protocolo);
        expect(ni).not.toBeNull();
        await distribuirNotificacaoSgh(somenteSgh(e), {
          hospital: a.cod,
          id: ni?.id ?? 0,
          versao: ni?.versao ?? 0,
          usuario: 'SINT.NSP',
          agora: agora.slice(0, 16),
          gestor: GESTOR_SINT,
          unidade: unidades[0]?.codigo ?? 0,
          prazoAnalise: agora.slice(0, 4) + '-12-31',
          orientacao: null,
        });
        const ges = await entrar(GESTOR_SINT);
        const lg = await get(ges, '/qualidade/gestor/notificacoes');
        expect(lg.statusCode).toBe(200);
        const itensG = (lg.json() as { itens: { id: number; protocolo: string }[] }).itens;
        expect(itensG.map((x) => x.protocolo)).toEqual([identificada.protocolo]);
        const dg = await get(ges, `/qualidade/gestor/notificacoes/${String(itensG[0]?.id ?? 0)}`);
        expect(dg.statusCode).toBe(200);
        const detG = (
          dg.json() as { notificacao: { notificador: string | null; eventos: { por: string | null }[] } }
        ).notificacao;
        expect(detG.notificador).toBeNull();
        expect(detG.eventos.length).toBeGreaterThan(0);
        expect(detG.eventos.every((x) => x.por === null)).toBe(true);
        expect(dg.body.toUpperCase()).not.toContain(IDENTIFICADO);
        expect((await get(ges, `/qualidade/gestor/notificacoes/${idAnon}`)).statusCode).toBe(404);
        passo(
          'gestor da área: só a distribuída a ele, sem o notificador nem o autor dos passos; a outra, 404',
        );
      } finally {
        process.stdout.write = escrever.out as typeof process.stdout.write;
        process.stderr.write = escrever.err as typeof process.stderr.write;
        await app.close();
      }

      // Regra 1: o login de quem notificou anônimo em lugar nenhum; o controle positivo acha o identificado.
      const qua = await colunasDeTexto(e, 'SGH_QUA_');
      const coex = await colunasDeTexto(e, 'SGH_CFG_COEX_');
      const trilhaCols = new Map([
        ['SGH_TRILHA', (await colunasDeTexto(e, 'SGH_TRILHA')).get('SGH_TRILHA') ?? []],
      ]);
      const novasDaTrilha = () => ({ sql: ' AND ID > ?', params: [trilhaAntes] });
      const achados = {
        qua: await ocorrencias(e, qua, ANONIMO),
        trilha: await ocorrencias(e, trilhaCols, ANONIMO, novasDaTrilha),
        coex: await ocorrencias(e, coex, ANONIMO),
        log: capturado.filter((x) => x.toUpperCase().includes(ANONIMO)).length,
      };
      const controle = {
        qua: await ocorrencias(e, qua, IDENTIFICADO),
        trilha: await ocorrencias(e, trilhaCols, IDENTIFICADO, novasDaTrilha),
      };
      const [linhasTrilha] = await e.consultar(
        `SELECT COUNT(*) N, SUM(CASE WHEN USUARIO = 'anonimo' AND ESTACAO IS NULL THEN 1 ELSE 0 END) A
           FROM SGH_TRILHA WHERE ID > ?`,
        [trilhaAntes],
        { teto: 1 },
      );
      // Regra 11: a trilha do NSP leva só o ID e o protocolo (nenhuma linha nova com o ID do atendimento).
      const [comAtendimento] = await e.consultar(
        `SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID > ? AND (ID_ALVO = ? OR CHAVE_NATURAL_ALVO CONTAINING ?)`,
        [trilhaAntes, String(atendimento), String(atendimento)],
        { teto: 1 },
      );

      // As leituras da etapa, com o tempo (na mesma transação).
      const l = e as unknown as Leitor;
      const medicoes = {
        contexto: await tempos(20, () => contextoDaNotificacao(l, atendimento)),
        unidades: await tempos(10, () => unidadesParaNotificacao(l)),
        lista: await tempos(10, () => notificacoesSgh(l, a.cod, { pagina: 1, porPagina: 50 })),
        prazos: await tempos(10, () => notificacoesComPrazoSgh(l, a.cod)),
        gestores: await tempos(10, () => buscarUsuariosGestao(l, gestor.slice(0, 4))),
        feriados: await tempos(10, () => feriadosDoPeriodo(l, '2026-01-01', '2027-12-31')),
      };
      return {
        achados,
        controle,
        linhasTrilha,
        comAtendimento: n(comAtendimento?.['N']),
        medicoes,
        coex: coex.size,
      };
    });

    passo(
      `anonimato: SGH_QUA_* ${r.achados.qua}, SGH_TRILHA nova ${r.achados.trilha}, SGH_CFG_COEX_* (${r.coex} tabelas) ${r.achados.coex}, log ${r.achados.log}`,
    );
    passo(
      `controle (identificada): SGH_QUA_* ${mascara(r.controle.qua)}, SGH_TRILHA ${mascara(r.controle.trilha)}`,
    );
    passo(
      `trilha nova: ${mascara(n(r.linhasTrilha?.['N']))} linhas, ${mascara(n(r.linhasTrilha?.['A']))} por anonimo sem estação; com o atendimento: ${r.comAtendimento}`,
    );
    passo(`p95 (ms): ${JSON.stringify(r.medicoes)}`);
    // Só agregados (contagens e tempos), para as evidências.
    const saida = process.env['SGH_INT_SAIDA'];
    if (saida)
      writeFileSync(
        saida,
        JSON.stringify(
          {
            anonimato: { ...r.achados, tabelasCoex: r.coex },
            controle: { qua: mascara(r.controle.qua), trilha: mascara(r.controle.trilha) },
            trilhaNova: {
              linhas: mascara(n(r.linhasTrilha?.['N'])),
              anonimoSemEstacao: mascara(n(r.linhasTrilha?.['A'])),
              comAtendimento: r.comAtendimento,
            },
            p95ms: r.medicoes,
          },
          null,
          2,
        ),
      );
    expect(r.achados).toEqual({ qua: 0, trilha: 0, coex: 0, log: 0 });
    expect(r.controle.qua).toBeGreaterThan(0);
    expect(r.controle.trilha).toBeGreaterThan(0);
    expect(n(r.linhasTrilha?.['A'])).toBe(1);
    expect(r.comAtendimento).toBe(0);
    expect(r.medicoes.contexto).toBeLessThan(300);
    for (const k of ['unidades', 'lista', 'prazos', 'gestores', 'feriados'] as const)
      expect(r.medicoes[k], k).toBeLessThan(500);
  }, 900_000);

  it('o ROLLBACK devolve tudo (contagens das SGH_QUA_* e a maior chave da trilha iguais)', async () => {
    const depois = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m48' }, (l) => contagensQua(l));
    expect(depois).toEqual(antes);
  });
});
