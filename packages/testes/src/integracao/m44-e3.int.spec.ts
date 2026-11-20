// Etapa 3 do M44 sobre a cópia (ficha, seções 9 e 10; regras 8 e 14), sempre em transação desfeita e sob a trava:
//   - regulação estadual com o simulador (regra 14; `regulacao.int-spec.ts` da ficha): o número à mão na solicitação de
//     leito; com o conector (DP-29), o pedido à central na SGH_OUTBOX NA MESMA TRANSAÇÃO (carga só com IDs e códigos) e
//     a resposta do simulador registrada como linha do conector com a impressão da mensagem; o número de outra
//     solicitação recusado; o monitoramento da transação mostra só tabelas SGH_ (0 tabela legada); a configuração de
//     regulação recebida lida em consulta (só contagens);
//   - protocolo gerenciado (regra 8) num atendimento real do PA da cópia: a definição, a inclusão, a meta cumprida, a
//     perdida com o motivo, o encerramento e nada depois dele; as leituras do relógio dentro do tempo-alvo; duas
//     publicações concorrentes da mesma versão (uma vence, a outra recebe a recusa sem esperar além da trava).
// Saída só com contagens, códigos e tempos (nenhum nome).
import { createHash } from 'node:crypto';
import { EVENTO_OUTBOX_REGULACAO } from '@sgh/contratos';
import { decidirRegulacao, respostaSimuladaDaCentral } from '@sgh/dominio-internacao';
import { conteudoCanonico, PROTOCOLOS_GERENCIADOS_SINTETICOS } from '@sgh/dominio-recepcao';
import {
  atendimentoExternoDeAmostra,
  configuracaoRegulacao,
  ErroOperacao,
  escritasDaTransacao,
  incluirProtocoloSgh,
  protocoloDoPaciente,
  protocolosDoPeriodo,
  protocolosDosAtendimentos,
  publicarGerenciadoSgh,
  registrarEventoProtocoloSgh,
  registrarRegulacaoSgh,
  regulacoesDasSolicitacoes,
  solicitarLeitoSgh,
  somenteSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, contar, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

const USUARIO = 'SGH.TESTE.M44';
const DOR = PROTOCOLOS_GERENCIADOS_SINTETICOS.find((p) => p.tipo === 'dor-toracica')!;
const IMPRESSAO = createHash('sha256')
  .update(conteudoCanonico(DOR as never))
  .digest('hex');

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).message}`;
  }
}

describe.skipIf(!PODE_ESCREVER)('M44 etapa 3 na cópia (transação desfeita)', () => {
  let a: Ambiente;

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      regulacao: await contar(l, 'SELECT COUNT(*) N FROM SGH_INT_REGULACAO'),
      outbox: await contar(l, 'SELECT COUNT(*) N FROM SGH_OUTBOX'),
      gerenciado: await contar(l, 'SELECT COUNT(*) N FROM SGH_PA_PROTOC_GERENCIADO'),
      protocolos: await contar(l, 'SELECT COUNT(*) N FROM SGH_PA_PROTOC_PACIENTE'),
      eventos: await contar(l, 'SELECT COUNT(*) N FROM SGH_PA_PROTOC_PAC_EVT'),
    }));

  const solicitar = (e: Escritor, paciente: number) =>
    solicitarLeitoSgh(somenteSgh(e), {
      hospital: a.cod,
      origem: 'externa',
      paciente,
      atendimento: null,
      cabecalho: null,
      internacao: null,
      cirurgia: null,
      prioridade: 'urgente',
      prazoMin: 240,
      perfil: { intensiva: false, precaucao: null, tiposAcomodacao: [] },
      clinica: 'M',
      especialidade: null,
      cid: null,
      justificativa: 'Indicacao SINTETICA M44 da integracao (regulacao)',
      situacaoLegado: 7,
      vinculo: 1,
      usuario: USUARIO,
    });

  it('regra 14: o número à mão; o conector pela outbox na mesma transação e o simulador; 0 tabela legada', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const s = somenteSgh(e);
      const sol = await solicitar(e, 990_000_101);
      const outra = await solicitar(e, 990_000_102);
      const base = {
        hospital: a.cod,
        solicitacao: sol,
        central: 'estadual',
        sentido: 'saida' as const,
        numero: 'SINT-2026-4401',
        situacao: 'solicitada',
        origem: 'manual' as const,
        observacao: null,
        anterior: null,
        mensagemHash: null,
        por: USUARIO,
        outbox: null,
      };
      // O pedido à central com o conector: a linha e o evento da outbox na mesma transação.
      const ida = await registrarRegulacaoSgh(s, {
        ...base,
        outbox: { rede: a.nucleo.rede, tipo: EVENTO_OUTBOX_REGULACAO },
      });
      const [ob] = await e.consultar(
        `SELECT TIPO, CARGA, SITUACAO FROM SGH_OUTBOX WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [ida.outbox],
        { teto: 1 },
      );
      const carga = JSON.parse(String(ob?.['CARGA'] ?? '{}')) as Record<string, string>;
      // A volta: o simulador da central (sem rede) responde; a linha do conector entra sobre a vigente.
      const vig = (await regulacoesDasSolicitacoes(e, a.cod, [sol])).at(-1)!;
      const resp = respostaSimuladaDaCentral({
        numero: vig.numero,
        situacao: 'solicitada',
        prioridade: 'urgente',
      });
      const decisao = decidirRegulacao(
        { id: vig.id, numero: vig.numero, central: 'estadual', situacao: 'solicitada' },
        { numero: resp.numero, central: 'estadual', situacao: resp.situacao },
      );
      const volta = await registrarRegulacaoSgh(s, {
        ...base,
        situacao: resp.situacao,
        origem: 'conector',
        anterior: vig.id,
        mensagemHash: createHash('sha256').update(resp.mensagem).digest('hex'),
        por: 'SGH.CONECTOR',
      });
      // Colisão sobre a mesma vigente e o número de outra solicitação.
      const colisao = await codigo(
        registrarRegulacaoSgh(s, { ...base, anterior: vig.id, situacao: 'negada' }),
      );
      const emUso = await codigo(registrarRegulacaoSgh(s, { ...base, solicitacao: outra }));
      const lidas = await regulacoesDasSolicitacoes(e, a.cod, [sol, outra]);
      const tabelas = (await escritasDaTransacao(e)).map((w) => w.tabela).sort();
      return {
        outbox: {
          tipo: String(ob?.['TIPO'] ?? '').trim(),
          situacao: String(ob?.['SITUACAO'] ?? '').trim(),
          carga,
        },
        decisao: decisao.ok,
        volta: { situacao: resp.situacao, idMaior: volta.id > ida.id },
        colisao,
        emUso,
        lidas: lidas.map((x) => `${x.origem}:${x.situacao}`),
        soSgh: tabelas.every((t) => t.startsWith('SGH_')),
        tabelas,
      };
    });
    console.log(`[${a.cod}] regulação: ${JSON.stringify(r)}`);
    expect(r.outbox.tipo).toBe(EVENTO_OUTBOX_REGULACAO);
    expect(r.outbox.situacao).toBe('pendente');
    expect(Object.keys(r.outbox.carga).sort()).toEqual(['central', 'regulacao', 'sentido', 'solicitacao']);
    expect(r).toMatchObject({
      decisao: true,
      volta: { situacao: 'autorizada', idMaior: true },
      colisao: 'regulacao-desatualizada',
      emUso: 'numero-em-uso',
      lidas: ['manual:solicitada', 'conector:autorizada'],
      soSgh: true,
    });
    expect(r.tabelas).toContain('SGH_OUTBOX');
    expect(await retrato()).toEqual(antes);
  }, 300_000);

  it('a configuração de regulação recebida (consulta, só contagens) dentro do tempo-alvo', async () => {
    const t0 = performance.now();
    const c = await a.nucleo.lerSomente(ctx(a), (l) => configuracaoRegulacao(l));
    const ms = Math.round(performance.now() - t0);
    const servicos = c.sistemas.reduce((s, x) => s + x.servicos, 0);
    const valores = c.tabelas.reduce((s, x) => s + x.valores, 0);
    console.log(
      `[${a.cod}] configuração de regulação: sistemas ${c.sistemas.length}, serviços ${servicos}, endpoints ${c.endpoints.length}, tabelas ${c.tabelas.length}, valores ${valores}; ${ms} ms`,
    );
    expect(c.sistemas.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2_000);
  }, 120_000);

  it('regra 8: num atendimento real do PA, a inclusão, as metas, o encerramento e nada depois; leituras do relógio', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const s = somenteSgh(e);
      const at = await atendimentoExternoDeAmostra(e);
      if (!at) throw new Error('Nenhum atendimento externo na cópia.');
      const v = await publicarGerenciadoSgh(s, {
        hospital: a.cod,
        tipo: DOR.tipo,
        nome: DOR.nome,
        conteudo: DOR,
        impressao: IMPRESSAO,
        notas: 'Versao SINTETICA M44 da integracao',
        autor: USUARIO,
        aprovador: 'SGH.TESTE.APROVADOR',
      });
      const inclusao = {
        hospital: a.cod,
        cabecalho: at.cabecalho,
        reg: Number(at.cabecalho) % 2_000_000_000,
        paciente: at.paciente,
        tipo: DOR.tipo,
        gerenciado: v.id,
        origem: 'enfermeiro' as const,
        sugeridoPor: null,
        criterios: ['dor-precordial'],
        chegadaEm: '2026-10-24T10:00',
        autor: USUARIO,
        vinculo: 1,
      };
      const id = await incluirProtocoloSgh(s, inclusao);
      const segunda = await codigo(incluirProtocoloSgh(s, inclusao));
      const ev = (codigoMeta: string, situacao: string, motivo: string | null, quando: string | null) => ({
        hospital: a.cod,
        protocoloPaciente: id,
        tipoEvento: 'meta' as const,
        codigo: codigoMeta,
        situacao,
        ocorridoEm: quando,
        prazoEm: '2026-10-24T10:10:00',
        motivo,
        por: USUARIO,
      });
      await registrarEventoProtocoloSgh(s, ev('ecg', 'cumprida', null, '2026-10-24T10:08'));
      await registrarEventoProtocoloSgh(s, ev('troponina', 'perdida', 'Coleta SINTETICA atrasada', null));
      const semMotivo = await codigo(
        registrarEventoProtocoloSgh(s, ev('avaliacao-medica', 'perdida', null, null)),
      );
      await registrarEventoProtocoloSgh(s, {
        ...ev('encerramento', 'transferido', 'Encaminhado SINTETICO', null),
        tipoEvento: 'encerramento',
        prazoEm: null,
      });
      const depois = await codigo(
        registrarEventoProtocoloSgh(s, ev('avaliacao-medica', 'cumprida', null, '2026-10-24T10:15')),
      );
      const t0 = performance.now();
      const doAtendimento = await protocolosDosAtendimentos(e, a.cod, [at.cabecalho]);
      const msAtendimentos = Math.round(performance.now() - t0);
      const t1 = performance.now();
      const doPeriodo = await protocolosDoPeriodo(e, a.cod, '2026-01-01T00:00', '2099-01-01T00:00');
      const msPeriodo = Math.round(performance.now() - t1);
      const um = await protocoloDoPaciente(e, a.cod, id);
      const tabelas = (await escritasDaTransacao(e)).map((w) => w.tabela);
      return {
        segunda,
        semMotivo: semMotivo.startsWith('outro:') && semMotivo.includes('SGH_CK_PA_PROTOC_EVT_MOTIVO'),
        depois,
        eventos: um?.eventos.map((x) => `${x.tipo}:${x.situacao}`),
        chegada: um?.chegadaEm,
        noAtendimento: doAtendimento.filter((x) => x.id === id).length,
        noPeriodo: doPeriodo.some((x) => x.id === id),
        msAtendimentos,
        msPeriodo,
        soSgh: tabelas.every((t) => t.startsWith('SGH_')),
      };
    });
    console.log(`[${a.cod}] protocolo gerenciado: ${JSON.stringify(r)}`);
    expect(r).toMatchObject({
      segunda: 'ja-incluido',
      semMotivo: true,
      depois: 'protocolo-encerrado',
      eventos: ['meta:cumprida', 'meta:perdida', 'encerramento:transferido'],
      chegada: '2026-10-24T10:00:00',
      noAtendimento: 1,
      noPeriodo: true,
      soSgh: true,
    });
    expect(r.msAtendimentos).toBeLessThan(1_000);
    expect(r.msPeriodo).toBeLessThan(1_000);
    expect(await retrato()).toEqual(antes);
  }, 300_000);

  it('duas publicações concorrentes da mesma versão: uma vence, a outra recebe a recusa', async () => {
    const antes = await retrato();
    const pub = (e: Escritor, notas: string) =>
      codigo(
        publicarGerenciadoSgh(somenteSgh(e), {
          hospital: a.cod,
          tipo: 'sepse',
          nome: 'Sepse SINTETICA',
          conteudo: { tipo: 'sepse' },
          impressao: 'c'.repeat(64),
          notas,
          autor: USUARIO,
          aprovador: 'SGH.TESTE.APROVADOR',
        }),
      );
    let soltar: () => void = () => undefined;
    let pronto: (v: string) => void = () => undefined;
    const primeiro = new Promise<string>((x) => (pronto = x));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      pronto(await pub(e, 'Primeira'));
      await new Promise<void>((x) => (soltar = x));
    });
    const r1 = await primeiro;
    const t0 = performance.now();
    const r2 = await a.nucleo.desfazendoNaCopia(ctx(a), (e) => pub(e, 'Segunda'));
    const ms = Math.round(performance.now() - t0);
    soltar();
    await segurando;
    console.log(`[${a.cod}] publicação concorrente: primeira ${r1}, segunda ${r2} em ${ms} ms`);
    expect([r1, r2]).toEqual(['gravou', 'versao-concorrente']);
    expect(await retrato()).toEqual(antes);
  }, 300_000);

  it('revisão do M44.3: o mesmo número em duas solicitações ao mesmo tempo: uma grava, a outra numero-em-uso', async () => {
    const antes = await retrato();
    const registrar = async (e: Escritor, paciente: number) => {
      const sol = await solicitar(e, paciente);
      return codigo(
        registrarRegulacaoSgh(somenteSgh(e), {
          hospital: a.cod,
          solicitacao: sol,
          central: 'estadual',
          sentido: 'saida',
          numero: 'SINT-2026-4499',
          situacao: 'solicitada',
          origem: 'manual',
          observacao: null,
          anterior: null,
          mensagemHash: null,
          por: USUARIO,
          outbox: null,
        }),
      );
    };
    let soltar: () => void = () => undefined;
    let pronto: (v: string) => void = () => undefined;
    const primeiro = new Promise<string>((x) => (pronto = x));
    // A primeira transação grava e fica aberta (sem confirmar): a segunda não vê a linha dela pela leitura.
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      pronto(await registrar(e, 990_000_111));
      await new Promise<void>((x) => (soltar = x));
    });
    const r1 = await primeiro;
    const t0 = performance.now();
    const r2 = await a.nucleo.desfazendoNaCopia(ctx(a), (e) => registrar(e, 990_000_112));
    const ms = Math.round(performance.now() - t0);
    soltar();
    await segurando;
    console.log(`[${a.cod}] número concorrente: primeira ${r1}, segunda ${r2} em ${ms} ms`);
    expect([r1, r2]).toEqual(['gravou', 'numero-em-uso']);
    expect(await retrato()).toEqual(antes);
  }, 300_000);
});
