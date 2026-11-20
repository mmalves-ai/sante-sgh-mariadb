// M48, etapa 2, sobre a cópia (transação DESFEITA, sob a trava; ficha, seções 4, 5, 7, 8 e 10; regras 1, 4, 5 e 11): a
// API inteira (sessões sintéticas, guardas, interceptores) com a porta da qualidade sobre UMA transação da cópia:
//   - o fluxo do NSP até o fim: notificar (a partir de um atendimento real, só pelo ID) → triar → distribuir a uma conta
//     ativa da cópia → análise pelos 5 porquês → plano 5W2H (o responsável é a conta ativa; incluir, concluir com a
//     evidência, verificar a eficácia) → concluir a análise (a notificação vai a "concluída", o prazo de 60 dias cumprido);
//   - a sugestão dispensada grava só o resumo (sem a origem nem o login em coluna de texto);
//   - a vigilância de produto: abrir com o item e o lote reais de uma saída do estoque, os expostos pela API (só números,
//     contados) e o andamento;
//   - as leituras da etapa pela API com o tempo (p95; meta: < 500 ms nas listas e detalhes, < 3 s no painel e nos
//     expostos, que agregam o período e o lote);
//   - a anônima vinda de sugestão com a hora pelo início do turno (não casa com o minuto do registro de origem) e o
//     resumo da sugestão resolvida que não se recalcula sem a chave (HMAC; o SHA-256 da semente não aparece);
//   - a trilha nova sem o ID do atendimento (regra 11) e o ROLLBACK conferido pelas contagens das SGH_QUA_* e da
//     SGH_PEP_CHECAGEM_EXT e pela maior chave da SGH_TRILHA.
// A dose marcada como não administrada POR FORA (a PRCHKGERAL alterada pelo outro sistema simulado da massa) está em
// packages/testes/src/integracao/m48-e2-sugestao.int.spec.ts (a escrita por fora fica só na massa).
// Nada de paciente sai daqui: o atendimento, a conta e o lote ficam só em memória; só contagens, códigos e tempos.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { semeDaSugestaoResolvida } from '@sgh/dominio-qualidade';
import { type Leitor, registrarChecagemNoNovo } from '@sgh/legado';
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
import { inicioDoTurno } from './servico-seguranca.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const NOTIFICADOR = 'SINT.ENFERMEIRO';
const n = (v: unknown) => Number(v ?? 0);
const mascara = (x: number) => (x > 0 && x < 5 ? '<5' : String(x));
const passo = (s: string) => console.log(`[m48.2] ${s}`);
const TABELAS = [
  'SGH_QUA_NOTIFICACAO',
  'SGH_QUA_NOTIF_EVENTO',
  'SGH_QUA_ANALISE',
  'SGH_QUA_PLANO_ACAO',
  'SGH_QUA_SUGESTAO_RESOLVIDA',
  'SGH_QUA_TECNOVIG',
  'SGH_QUA_TECNOVIG_EVENTO',
  // O registro da checagem que o cenário da sugestão grava por fora (registrarChecagemNoNovo; sem glicemia, nada vai
  // à SGH_PEP_SINAL_VITAL).
  'SGH_PEP_CHECAGEM_EXT',
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

async function tempos(vezes: number, fn: () => Promise<{ statusCode: number }>): Promise<number> {
  const xs: number[] = [];
  for (let i = 0; i < vezes; i++) {
    const t0 = performance.now();
    const r = await fn();
    xs.push(performance.now() - t0);
    expect(r.statusCode).toBe(200);
  }
  return Math.round(percentil(xs, 95));
}

describe.skipIf(!PODE_ESCREVER)('segurança do paciente, etapa 2, na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  let antes: number[];
  beforeAll(async () => {
    a = await ambienteM27();
    antes = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m48-2' }, (l) => contagens(l));
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('notificação → análise → plano 5W2H → conclusão; sugestão; vigilância de produto com os expostos', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m48-2-fluxo' }, async (e) => {
      const [at] = await e.consultar(
        `SELECT FIRST 1 a.ID FROM ATCABECATEND a
          WHERE COALESCE(a.ATIVO, 'T') = 'T' AND a.ID_TBUNIDAD IS NOT NULL ORDER BY a.ID DESC`,
        [],
        { teto: 1 },
      );
      const atendimento = n(at?.['ID']);
      expect(atendimento).toBeGreaterThan(0);
      const { a: conta } = await usuariosAtivos(e);
      // Um item e um lote de uma saída do estoque (só em memória; o formato do lote é o do contrato).
      const lotes = await e.consultar(
        `SELECT FIRST 50 g.ITEM, TRIM(s.LOTE) LOTE FROM GERASVALSAIDLOTE s
           JOIN GELANSAI g ON g.ID_GELANSAI = s.ID_GELANSAI
          WHERE s.LOTE IS NOT NULL AND g.ITEM IS NOT NULL`,
        [],
        { teto: 50, tempoMaximoMs: 30_000 },
      );
      const lote = lotes
        .map((x) => ({ item: n(x['ITEM']), lote: String(x['LOTE'] ?? '') }))
        .find((x) => x.item > 0 && /^[A-Za-z0-9./ _-]{1,30}$/.test(x.lote));
      const [maxTrilha] = await e.consultar('SELECT MAX(ID) M FROM SGH_TRILHA', [], { teto: 1 });
      const trilhaAntes = n(maxTrilha?.['M']);

      const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
        trilha: new RegistradorTrilhaMemoria(),
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
      const post = (s: Sessao, url: string, payload: unknown = {}) =>
        app.inject({
          method: 'POST',
          url: `/api${url}`,
          headers: {
            cookie: s.cookie,
            'x-csrf': s.csrf,
            'idempotency-key': `int-m48-2-${String(++seq)}-${Date.now()}`,
          },
          payload: payload as object,
        });
      const ok = (x: { statusCode: number; body: string; json: () => unknown }) => {
        const c =
          x.statusCode >= 400 ? String((x.json() as { codigo?: string }).codigo ?? x.statusCode) : 'ok';
        expect(c, x.body.slice(0, 300)).toBe('ok');
        return x.json() as Record<string, unknown>;
      };

      try {
        const notif = await entrar(NOTIFICADOR);
        const nsp = await entrar('SINT.NSP');
        const f = ok(await get(notif, '/qualidade/notificacoes/formulario')) as {
          agora: string;
          unidades: { codigo: number }[];
        };
        const agora = f.agora;
        const ano = agora.slice(0, 4);
        const ocorrido = new Date(Date.parse(`${agora.slice(0, 19)}Z`) - 3 * 3_600_000)
          .toISOString()
          .slice(0, 16);
        const enviada = ok(
          await post(notif, '/qualidade/notificacoes', {
            atendimento,
            unidade: null,
            local: null,
            ocorridoEm: ocorrido,
            tipo: 'queda',
            tipoOutro: null,
            chegouAoPaciente: true,
            danoPercebido: 'moderado',
            descricao: 'SINTETICO M48.2: queda ao sair do leito (texto de teste).',
            anonima: false,
            origem: { tela: '/enfermagem/checagem' },
          }),
        ) as { protocolo: string };
        const lista = ok(
          await get(nsp, `/qualidade/nsp/notificacoes?protocolo=${encodeURIComponent(enviada.protocolo)}`),
        ) as { itens: { id: number; protocolo: string }[] };
        const id = lista.itens.find((x) => x.protocolo === enviada.protocolo)?.id ?? 0;
        expect(id).toBeGreaterThan(0);
        const det = ok(await get(nsp, `/qualidade/nsp/notificacoes/${String(id)}`)) as {
          notificacao: { versao: number };
        };
        const tri = ok(
          await post(nsp, `/qualidade/nsp/notificacoes/${String(id)}/triar`, {
            versao: det.notificacao.versao,
            tipo: 'queda',
            tipoOutro: null,
            classificacao: 'eventoAdverso',
            dano: 'moderado',
            neverEvent: false,
            justificativa: null,
          }),
        ) as { versao: number };
        ok(
          await post(nsp, `/qualidade/nsp/notificacoes/${String(id)}/distribuir`, {
            versao: tri.versao,
            gestor: conta,
            unidade: f.unidades[0]?.codigo ?? 0,
            prazoAnalise: `${ano}-12-31`,
            orientacao: null,
          }),
        );
        passo('notificação gravada, triada e distribuída a uma conta ativa');

        // A análise pelos 5 porquês (o NSP analisa todas as distribuídas).
        const url = `/qualidade/analises/${String(id)}`;
        const t0 = ok(await get(nsp, url)) as {
          analise: unknown;
          gravacao: { acoes: { analisar: boolean } };
        };
        expect(t0.analise).toBeNull();
        expect(t0.gravacao.acoes.analisar).toBe(true);
        const a1 = ok(
          await post(nsp, url, {
            versao: 0,
            conteudo: {
              metodo: 'cincoPorques',
              porques: ['Paciente caiu ao levantar', 'Grade abaixada no plantão noturno'],
            },
            causaRaiz: null,
            fatores: ['equipe'],
            licoes: null,
            concluir: false,
            semAcaoJustificativa: null,
          }),
        ) as { versao: number };
        const resp = ok(
          await get(nsp, `/qualidade/acoes/responsaveis?busca=${encodeURIComponent(conta.slice(0, 4))}`),
        ) as { itens: { login: string }[] };
        expect(resp.itens.length).toBeGreaterThan(0);
        const inc = ok(
          await post(nsp, `${url}/acoes`, {
            tipo: 'incluir',
            acao: {
              oQue: 'SINTETICO: checar a grade a cada ronda',
              porQue: 'Grade abaixada no plantão',
              onde: 'Unidade da notificação',
              quando: `${ano}-12-31`,
              quem: conta,
              como: 'Item novo no checklist da ronda',
              quanto: 'sem custo',
            },
          }),
        ) as { id: number; versao: number };
        const conc = ok(
          await post(nsp, `${url}/acoes`, {
            tipo: 'situacao',
            id: inc.id,
            versao: inc.versao,
            situacao: 'concluida',
            texto: 'SINTETICO: checklist da ronda publicado.',
          }),
        ) as { versao: number };
        ok(
          await post(nsp, `${url}/acoes`, {
            tipo: 'eficacia',
            id: inc.id,
            versao: conc.versao,
            eficacia: 'eficaz',
            texto: 'SINTETICO: nenhuma queda na unidade em 30 dias.',
          }),
        );
        ok(
          await post(nsp, url, {
            versao: a1.versao,
            conteudo: {
              metodo: 'cincoPorques',
              porques: ['Paciente caiu ao levantar', 'Grade abaixada no plantão noturno'],
            },
            causaRaiz: 'Rotina de checagem da grade ausente no plantão noturno',
            fatores: ['equipe', 'organizacao'],
            licoes: 'A ronda confere a grade.',
            concluir: true,
            semAcaoJustificativa: null,
          }),
        );
        const fim = ok(await get(nsp, url)) as {
          analise: { situacao: string };
          plano: { total: number; concluidas: number; eficazes: number };
          notificacao: { situacao: string };
        };
        expect(fim.analise.situacao).toBe('concluida');
        expect(fim.notificacao.situacao).toBe('concluida');
        expect(fim.plano).toMatchObject({ total: 1, concluidas: 1, eficazes: 1 });
        const [cumprido] = await e.consultar(
          'SELECT ANALISE_CONCLUIDA_EM C FROM SGH_QUA_NOTIFICACAO WHERE ID = ?',
          [id],
          { teto: 1 },
        );
        expect(cumprido?.['C']).toBeTruthy();
        passo('análise, plano (incluir, concluir, eficácia) e conclusão gravados; notificação concluída');

        // A sugestão a partir de uma dose omitida gravada POR FORA (o registro da checagem do M25, pelo gravador dele, na
        // mesma transação desfeita; IDs da prescrição sintéticos, o atendimento real só pelo ID): o notificador a vê,
        // notifica anônimo a partir dela e ela some; a notificação guarda só a fonte (D-SUG-ANON-48.2).
        await registrarChecagemNoNovo(
          e,
          { hospital: a.cod, usuarioLegado: NOTIFICADOR, idempotencyKey: 'int-m48-2-omitida' },
          {
            prescricao: 999_999_301,
            atendimento,
            paciente: 999_999_302,
            cbo: 1,
            marcacoes: [
              {
                horario: 999_999_303,
                item: 999_999_304,
                situacaoLida: ' ',
                situacao: 'N',
                quantidade: 0,
                justificativa: null,
                papel: 'principal',
              },
            ],
            sgh: {
              horaReal: ocorrido,
              pulseiraLida: false,
              motivoSemPulseira: null,
              gtin: null,
              lote: null,
              validade: null,
              conferente: null,
              dispositivo: null,
              origemOffline: false,
              avisos: [],
              motivo: 'faltaItem',
              observacao: null,
            },
            glicemia: null,
          },
        );
        const [ck] = await e.consultar(
          `SELECT CAST(MAX(ID) AS VARCHAR(20)) ID FROM SGH_PEP_CHECAGEM_EXT
            WHERE HOSPITAL = ? AND ID_PRCHKGERAL = ? AND USUARIO = ?`,
          [a.cod, 999_999_303, NOTIFICADOR],
          { teto: 1 },
        );
        const origemOmitida = `omitida:${String(ck?.['ID'] ?? '')}`;
        const comOmitida = ok(await get(notif, '/qualidade/sugestoes')) as {
          ligada: boolean;
          itens: { origem: string; atendimento: number | null }[];
        };
        expect(comOmitida.ligada).toBe(true);
        const sugerida = comOmitida.itens.find((x) => x.origem === origemOmitida);
        expect(sugerida, 'a dose omitida gravada por fora vira sugestão').toBeTruthy();
        expect(sugerida?.atendimento).toBe(atendimento);
        expect((ok(await get(nsp, '/qualidade/sugestoes')) as { itens: unknown[] }).itens).toEqual([]);
        const daSugestao = ok(
          await post(notif, '/qualidade/notificacoes', {
            atendimento,
            unidade: null,
            local: null,
            ocorridoEm: ocorrido,
            tipo: 'medicacao',
            tipoOutro: null,
            chegouAoPaciente: true,
            danoPercebido: 'nenhum',
            descricao: 'SINTETICO M48.2: dose não administrada por falta do item (texto de teste).',
            anonima: true,
            origem: { tela: '/enfermagem/checagem', sugestao: origemOmitida },
          }),
        ) as { protocolo: string };
        const [fonte] = await e.consultar(
          'SELECT ORIGEM_SUGESTAO O, NOTIFICADOR U FROM SGH_QUA_NOTIFICACAO WHERE HOSPITAL = ? AND PROTOCOLO = ?',
          [a.cod, daSugestao.protocolo],
          { teto: 1 },
        );
        expect(String(fonte?.['O'] ?? '').trim()).toBe('omitida');
        expect(fonte?.['U'] ?? null).toBeNull();
        // Regra 1: a hora vai pelo início do turno; o atendimento com o minuto não casa com o registro de origem.
        const [hora] = await e.consultar(
          `SELECT CAST(OCORRIDO_EM AS VARCHAR(24)) H FROM SGH_QUA_NOTIFICACAO WHERE HOSPITAL = ? AND PROTOCOLO = ?`,
          [a.cod, daSugestao.protocolo],
          { teto: 1 },
        );
        const turno = inicioDoTurno(ocorrido);
        expect(
          String(hora?.['H'] ?? '')
            .slice(0, 16)
            .replace(' ', 'T'),
        ).toBe(turno);
        if (turno !== ocorrido) {
          const [casa] = await e.consultar(
            `SELECT COUNT(*) N FROM SGH_PEP_CHECAGEM_EXT k JOIN SGH_QUA_NOTIFICACAO q
                ON q.HOSPITAL = k.HOSPITAL AND q.ID_ATCABECATEND = k.ID_ATCABECATEND AND q.OCORRIDO_EM = k.HORA_REAL
              WHERE q.HOSPITAL = ? AND q.PROTOCOLO = ?`,
            [a.cod, daSugestao.protocolo],
            { teto: 1 },
          );
          expect(n(casa?.['N']), 'a anônima não aponta o registro de origem pelo minuto').toBe(0);
        }
        // O resumo da sugestão resolvida não é o SHA-256 da semente (HMAC com a chave fora do banco).
        const semChave = ['pc', 'aa', a.cod].map((h) =>
          createHash('sha256')
            .update(semeDaSugestaoResolvida(h, NOTIFICADOR, origemOmitida), 'utf8')
            .digest('hex'),
        );
        const [recalculado] = await e.consultar(
          `SELECT COUNT(*) N FROM SGH_QUA_SUGESTAO_RESOLVIDA WHERE RESUMO IN (?, ?, ?)`,
          semChave,
          { teto: 1 },
        );
        expect(n(recalculado?.['N']), 'o resumo não se recalcula sem a chave').toBe(0);
        const depois = ok(await get(notif, '/qualidade/sugestoes')) as { itens: { origem: string }[] };
        expect(depois.itens.map((x) => x.origem)).not.toContain(origemOmitida);
        passo(
          'sugestão da dose omitida gravada por fora: vista, notificada anônima e resolvida (só a fonte guardada)',
        );
        // A sugestão dispensada: só o resumo (nem a origem nem o login em texto).
        const sug = ok(await get(notif, '/qualidade/sugestoes')) as { ligada: boolean };
        expect(sug.ligada).toBe(true);
        ok(await post(notif, '/qualidade/sugestoes/dispensar', { origem: 'omitida:999999001' }));
        const [vazou] = await e.consultar(
          `SELECT COUNT(*) N FROM SGH_QUA_SUGESTAO_RESOLVIDA WHERE RESUMO CONTAINING ? OR RESUMO CONTAINING ?`,
          ['999999001', 'ENFERMEIRO'],
          { teto: 1 },
        );

        // A vigilância de produto, com o item e o lote reais quando a cópia tem saída com lote.
        const ab = ok(
          await post(nsp, '/qualidade/tecnovigilancia', {
            acao: 'abrir',
            area: 'tecnovigilancia',
            tipo: 'queixaTecnica',
            item: lote?.item ?? null,
            produto: lote ? null : 'SINTETICO equipo de teste',
            lote: lote?.lote ?? null,
            serie: null,
            fabricante: null,
            registroAnvisa: null,
            descricao: 'SINTETICO M48.2: vazamento na conexão (texto de teste).',
            notificacao: id,
            alerta: null,
            conduta: 'segregado',
          }),
        ) as { id: number; versao: number };
        const q = ok(await get(nsp, `/qualidade/tecnovigilancia/${String(ab.id)}`)) as {
          calculaExpostos: boolean;
          protocoloNotificacao: string | null;
        };
        expect(q.protocoloNotificacao).toBe(enviada.protocolo);
        expect(q.calculaExpostos).toBe(lote !== undefined);
        let expostos = -1;
        if (lote) {
          const ex = ok(await get(nsp, `/qualidade/tecnovigilancia/${String(ab.id)}/expostos`)) as {
            expostos: { atendimento: number }[];
          };
          expostos = ex.expostos.length;
          for (const x of ex.expostos)
            expect(Object.keys(x).sort()).toEqual([
              'atendimento',
              'data',
              'origem',
              'paciente',
              'quantidade',
            ]);
        }
        ok(
          await post(nsp, `/qualidade/tecnovigilancia/${String(ab.id)}/andamento`, {
            versao: ab.versao,
            situacao: 'emInvestigacao',
            conduta: 'segregado',
            notivisaNumero: null,
            texto: 'SINTETICO: lote segregado para investigação.',
          }),
        );
        passo(
          `vigilância de produto aberta (${lote ? 'item e lote reais' : 'sem lote na cópia'}), andamento gravado`,
        );

        // As leituras da etapa pela API, com o tempo.
        const medicoes: Record<string, number> = {
          analises: await tempos(10, () => get(nsp, '/qualidade/analises')),
          analise: await tempos(10, () => get(nsp, url)),
          minhas: await tempos(10, () => get(nsp, '/qualidade/acoes/minhas')),
          sugestoes: await tempos(10, () => get(notif, '/qualidade/sugestoes')),
          vigilancia: await tempos(10, () => get(nsp, '/qualidade/tecnovigilancia')),
          registro: await tempos(10, () => get(nsp, `/qualidade/tecnovigilancia/${String(ab.id)}`)),
          painel: await tempos(5, () => get(nsp, '/qualidade/nsp/painel')),
        };
        if (lote)
          medicoes['expostos'] = await tempos(5, () =>
            get(nsp, `/qualidade/tecnovigilancia/${String(ab.id)}/expostos`),
          );

        // Regra 11: nenhuma linha nova da trilha com o ID do atendimento.
        const [comAtendimento] = await e.consultar(
          `SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID > ? AND (ID_ALVO = ? OR CHAVE_NATURAL_ALVO CONTAINING ?)`,
          [trilhaAntes, String(atendimento), String(atendimento)],
          { teto: 1 },
        );
        const [novas] = await e.consultar('SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID > ?', [trilhaAntes], {
          teto: 1,
        });
        return {
          medicoes,
          vazouSugestao: n(vazou?.['N']),
          comAtendimento: n(comAtendimento?.['N']),
          trilhaNova: n(novas?.['N']),
          expostos,
          comLote: lote !== undefined,
        };
      } finally {
        await app.close();
      }
    });

    passo(`p95 (ms): ${JSON.stringify(r.medicoes)}`);
    passo(
      `trilha nova: ${mascara(r.trilhaNova)} linhas, com o atendimento: ${r.comAtendimento}; sugestão com a origem ou o login: ${r.vazouSugestao}; expostos: ${r.comLote ? mascara(r.expostos) : 'sem lote'}`,
    );
    const saida = process.env['SGH_INT_SAIDA'];
    if (saida)
      writeFileSync(
        saida,
        JSON.stringify(
          {
            p95ms: r.medicoes,
            trilhaNova: mascara(r.trilhaNova),
            trilhaComAtendimento: r.comAtendimento,
            sugestaoComOrigemOuLogin: r.vazouSugestao,
            expostos: r.comLote ? mascara(r.expostos) : 'sem lote',
          },
          null,
          2,
        ),
      );
    expect(r.vazouSugestao).toBe(0);
    expect(r.comAtendimento).toBe(0);
    expect(r.trilhaNova).toBeGreaterThan(0);
    for (const k of ['analises', 'analise', 'minhas', 'sugestoes', 'vigilancia', 'registro'])
      expect(r.medicoes[k], k).toBeLessThan(500);
    expect(r.medicoes['painel']).toBeLessThan(3_000);
    if (r.comLote) expect(r.medicoes['expostos']).toBeLessThan(3_000);
  }, 900_000);

  it('o ROLLBACK devolve tudo (contagens das SGH_QUA_* e a maior chave da trilha iguais)', async () => {
    const depois = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m48-2' }, (l) => contagens(l));
    expect(depois).toEqual(antes);
  });
});
