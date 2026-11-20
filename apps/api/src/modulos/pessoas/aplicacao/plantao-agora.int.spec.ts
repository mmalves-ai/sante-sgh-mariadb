// Fatia F3 (M52.3) sobre a cópia (transação DESFEITA; ficha, seções 4, 6 e 8; regras 8 a 10): a escala de enfermagem
// publicada da competência seguinte com o noturno que atravessa a meia-noite e o sobreaviso; "quem está de plantão
// agora" no instante das 2 h (o noturno "desde ontem", o sobreaviso com o tempo de chegada, o conselho e a
// especialidade do registro da cópia) com o p95 da consulta pelo índice por início; o acionamento do sobreaviso com o
// prazo e a chegada atrasada; a troca pedida, aceita (registrada pela coordenação) e aprovada, com os plantões mudando
// de vínculo, a trilha da escala e a SGH_OUTBOX; e o dimensionamento registrado com a classificação de uma unidade de
// internação da cópia (só contagens). Vínculos sintéticos (CPF só como HMAC de mentira); registros de conselho da cópia
// só pelo ID, em memória; nada é impresso além de códigos, contagens e tempos.
import {
  type ChaveGravada,
  incluirVinculoPesSgh,
  plantoesNoInstantePesSgh,
  type PrerequisitoGravado,
  somenteSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import {
  type AmbienteM27,
  ambienteM27,
  PODE_ESCREVER,
  percentil,
} from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { portaEscalaNasTransacoes } from '../escala/porta-escala-legado.js';
import { ServicoEscala } from '../escala/servico-escala.js';
import { ServicoPlantao } from '../escala/servico-plantao.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';

const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-25T10:00:00',
});
const n = (v: unknown) => Number(v ?? 0);
const p2 = (x: number) => String(x).padStart(2, '0');

async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'];
}

describe.skipIf(!PODE_ESCREVER)(
  'troca, plantão agora, sobreaviso e dimensionamento (cópia, transação desfeita)',
  () => {
    let a: AmbienteM27;
    beforeAll(async () => {
      a = await ambienteM27();
    }, 900_000);
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('plantão agora no instante (noturno e sobreaviso) → acionamento → troca aprovada → dimensionamento', async () => {
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m52-plantao' }, async (e) => {
        const [cc] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
          [],
          { teto: 1 },
        );
        const [un] = await e.consultar('SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', [], {
          teto: 1,
        });
        // Dois registros COREN ativos da cópia (só o ID e o profissional, em memória).
        const profs = await e.consultar(
          "SELECT FIRST 2 c.ID_TBPROFIS P, c.ID R FROM TBCBOPRO c WHERE c.CONS_PROF = 'COREN' AND c.ATIVO = 'T' AND c.COD > 0 AND c.ID_TBPROFIS > 0 ORDER BY c.ID",
          [],
          { teto: 2 },
        );
        const unidade = n(un?.['COD']);
        const [ob0] = await e.consultar('SELECT COALESCE(MAX(ID), 0) M FROM SGH_OUTBOX', [], { teto: 1 });
        const s0 = somenteSgh(e);
        const vinculo = (hmac: string, profissional: number, nome: string) =>
          incluirVinculoPesSgh(s0, {
            hospital: a.c.hospital,
            pessoa: null,
            cpfHmac: hmac,
            cpfCifrado: 'v1.sintetico',
            nome,
            profissional,
            usuario: null,
            tipo: 'clt',
            matricula: null,
            cargo: 'Enfermeira',
            funcao: null,
            cargaSemanal: 36,
            centroCusto: n(cc?.['COD']),
            unidade,
            setor: null,
            admissao: '2026-01-01',
            por: 'SGH.TESTE',
          });
        const um = await vinculo('f'.repeat(64), n(profs[0]?.['P']), 'ENFERMEIRA SINTETICA M52.3 UM');
        const dois = await vinculo('9'.repeat(64), n(profs[1]?.['P']), 'ENFERMEIRA SINTETICA M52.3 DOIS');

        const trilha = new RegistradorTrilhaMemoria();
        const pessoas = portaPessoasNaTransacao(e, a.executor);
        const porta = portaEscalaNasTransacoes(new Map([[a.c.hospital, e]]));
        const recursos = ['pessoas.escala', 'pessoas.dimensionamento'];
        const config = fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => recursos.map(chave),
          prerequisitosIniciais: () => recursos.map(cumprido),
        });
        const escala = new ServicoEscala(porta, pessoas, trilha, config, null);
        const hoje = await pessoas.hoje(a.c);
        const [ano, mes] = hoje.split('-').map(Number) as [number, number];
        const comp = mes === 12 ? `${ano + 1}-01` : `${ano}-${p2(mes + 1)}`;
        const dia = (d: number) => `${comp}-${p2(d)}`;
        // O relógio do serviço no dia 2 da competência às 23 h de Brasília (o sobreaviso do dia 2 está em curso).
        const relogio = { agora: new Date(`${dia(2)}T23:00:00-03:00`) };
        const plantao = new ServicoPlantao(escala, porta, pessoas, trilha, config, null, () => relogio.agora);
        let k = 0;
        const s = (login = 'SGH.TESTE'): SessaoCadastro => ({
          req: {
            headers: { 'idempotency-key': `int-m52-pla-${Date.now().toString(36)}-${++k}` },
            ip: '127.0.0.1',
            sgh: { sessao: { unidadeAtiva: null, usuario: { id: '0', login } } },
          } as never,
          hospital: a.c.hospital,
          rede: a.c.rede,
          login,
          porta: a.c,
          pode: () => true,
        });
        const pl = (
          esc: number,
          v: number,
          ini: string,
          fim: string,
          extra: Record<string, unknown> = {},
        ) => ({
          escala: esc,
          vinculo: v,
          tipo: 'presencial' as const,
          inicio: ini,
          fim,
          chegadaMin: null,
          motivo: null,
          ...extra,
        });

        const esc = (
          await escala.criarEscala(s(), {
            unidade,
            setor: 'SETOR SINTETICO M52.3',
            competencia: comp,
            tipo: 'enfermagem',
            cobertura: { manha: 0, tarde: 0, noite: 0 },
          })
        ).id;
        // O noturno do dia 1 (19 h às 7 h do dia 2), o sobreaviso do dia 2 (24 h, 30 min para chegar) e os plantões da troca.
        const noturno = (
          await escala.incluirPlantao(s(), pl(esc, um.id, `${dia(1)}T19:00`, `${dia(2)}T07:00`))
        ).id;
        const sobre = (
          await escala.incluirPlantao(
            s(),
            pl(esc, dois.id, `${dia(2)}T00:00`, `${dia(3)}T00:00`, { tipo: 'sobreaviso', chegadaMin: 30 }),
          )
        ).id;
        const pa = (await escala.incluirPlantao(s(), pl(esc, um.id, `${dia(10)}T07:00`, `${dia(10)}T19:00`)))
          .id;
        const pb = (
          await escala.incluirPlantao(s(), pl(esc, dois.id, `${dia(12)}T07:00`, `${dia(12)}T19:00`))
        ).id;
        const v0 = (await porta.escala(a.c, esc))!.versao;
        const antes = (await plantao.plantaoAgora(s(), { instante: `${dia(2)}T02:00` })).linhas.filter(
          (l) => l.escala === esc,
        ).length;
        await escala.publicar(s(), { escala: esc, versao: v0, justificativaFuro: null });

        // Regra 10: às 2 h do dia 2, o noturno (desde ontem) e o sobreaviso.
        const agora = await plantao.plantaoAgora(s(), {
          instante: `${dia(2)}T02:00`,
          setor: 'SINTETICO M52.3',
        });
        const linhas = agora.linhas.filter((l) => l.escala === esc);
        // p95 da consulta do instante (índice por início; ficha, seção 4: p95 < 300 ms).
        const tempos: number[] = [];
        for (let i = 0; i < 20; i++) {
          const t0 = performance.now();
          await plantoesNoInstantePesSgh(e, a.c.hospital, `${dia(2)}T02:00`, `${dia(1)}T02:00`, {});
          tempos.push(performance.now() - t0);
        }
        const as7 = (await plantao.plantaoAgora(s(), { instante: `${dia(2)}T07:00` })).linhas
          .filter((l) => l.escala === esc)
          .map((l) => l.tipo);

        // Acionamento às 23 h do dia 2: prazo 23 h 30; a chegada às 23 h 40 (relógio às 23 h 45) é atrasada.
        const ac = await plantao.acionar(s(), {
          plantao: sobre,
          motivo: 'Paciente grave sintético',
          atendimento: null,
        });
        const jaAcionado = await codigo(
          plantao.acionar(s(), { plantao: sobre, motivo: 'Segundo chamado sintético', atendimento: null }),
        );
        const naoSobreaviso = await codigo(
          plantao.acionar(s(), { plantao: noturno, motivo: 'Chamado sintético errado', atendimento: null }),
        );
        relogio.agora = new Date(`${dia(2)}T23:45:00-03:00`);
        const chegada = await plantao.registrarChegada(s(), {
          acionamento: ac.id,
          versao: 0,
          chegouEm: `${dia(2)}T23:40`,
        });
        const acion = (await plantao.plantaoAgora(s(), { instante: `${dia(2)}T23:45` })).linhas.find(
          (l) => l.plantao === sobre,
        )?.acionamento;

        // Regra 8: a troca do dia 10 (UM) pelo dia 12 (DOIS), registrada em nome da colega e aprovada.
        const t = await plantao.pedirTroca(s(), {
          tipo: 'troca',
          plantao: pa,
          versao: 0,
          colega: dois.id,
          plantaoColega: pb,
          versaoColega: 0,
          motivo: 'Troca sintética da integração',
        });
        const emTroca = await codigo(
          plantao.pedirTroca(s(), {
            tipo: 'cessao',
            plantao: pa,
            versao: 0,
            colega: dois.id,
            plantaoColega: null,
            versaoColega: null,
            motivo: 'Segundo pedido sintético',
          }),
        );
        await plantao.responderTroca(s(), {
          troca: t.id,
          versao: 0,
          aceite: true,
          confirmacao: 'Confirmação sintética da integração',
        });
        // Quatro olhos: quem registrou o aceite não aprova; outra pessoa da coordenação aprova.
        const propria = await codigo(
          plantao.decidirTroca(s(), { troca: t.id, versao: 1, aprovar: true, motivo: null }),
        );
        await plantao.decidirTroca(s('SGH.TESTE.APROVA'), {
          troca: t.id,
          versao: 1,
          aprovar: true,
          motivo: null,
        });
        const [donoA] = await e.consultar(
          'SELECT ID_VINCULO V FROM SGH_PES_PLANTAO WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
          [String(pa)],
          { teto: 1 },
        );
        const [donoB] = await e.consultar(
          'SELECT ID_VINCULO V FROM SGH_PES_PLANTAO WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
          [String(pb)],
          { teto: 1 },
        );
        const troca = (await plantao.trocas(s(), { estado: 'aprovada', minhas: false })).itens.find(
          (x) => x.id === t.id,
        );
        const eventos = await e.consultar(
          "SELECT COUNT(*) N FROM SGH_PES_ESCALA_EVENTO WHERE ID_ESCALA = CAST(CAST(? AS VARCHAR(20)) AS BIGINT) AND ACAO = 'alterado' AND MOTIVO STARTING WITH 'Troca '",
          [String(esc)],
          { teto: 1 },
        );
        const outbox = await e.consultar(
          'SELECT TIPO, COUNT(*) N FROM SGH_OUTBOX WHERE ID > ? GROUP BY TIPO',
          [n(ob0?.['M'])],
          { teto: 20 },
        );

        // Regra 9: o dimensionamento com a classificação do turno de uma unidade de internação da cópia (contagens).
        const [bloco] = await e.consultar('SELECT FIRST 1 BLOCO FROM RIBLOCOS ORDER BY ORDEM, BLOCO', [], {
          teto: 1,
        });
        const ui = String(bloco?.['BLOCO'] ?? '').trim();
        const dim = await plantao.registrarDimensionamento(s(), {
          unidade,
          setor: 'SETOR SINTETICO M52.3',
          data: dia(2),
          turno: 'noite',
          jornadaSemanalHoras: 36,
          ist: 0.15,
          fonte: ui ? 'classificacao' : 'informada',
          unidadeInternacao: ui || null,
          pacientes: ui
            ? null
            : { minimos: 10, intermediarios: 8, altaDependencia: 2, semiIntensivos: 0, intensivos: 0 },
        });
        const [dimLido] = (await plantao.dimensionamentos(s(), { unidade })).itens.filter(
          (x) => x.id === dim.id,
        );
        const informado = await plantao.registrarDimensionamento(s(), {
          unidade,
          setor: 'SETOR SINTETICO M52.3',
          data: dia(2),
          turno: 'manha',
          jornadaSemanalHoras: 36,
          ist: 0.15,
          fonte: 'informada',
          unidadeInternacao: null,
          pacientes: { minimos: 10, intermediarios: 8, altaDependencia: 2, semiIntensivos: 0, intensivos: 0 },
        });
        const [inf] = (await plantao.dimensionamentos(s(), { unidade })).itens.filter(
          (x) => x.id === informado.id,
        );

        return {
          antes,
          linhas: linhas.map((l) => [
            l.tipo,
            l.desdeOntem,
            l.chegadaMin,
            (l.conselho ?? '').startsWith('COREN'),
          ]),
          especialidade: linhas.some((l) => l.especialidade !== null),
          as7,
          p95InstanteMs: Math.round(percentil(tempos, 95)),
          prazo: ac.mensagem.endsWith('23:30.'),
          jaAcionado,
          naoSobreaviso,
          chegadaAtrasada: chegada.alertas.length,
          acionamento: acion ? [acion.situacao, acion.atrasado] : null,
          emTroca,
          propria,
          trocaEstado: troca?.estado,
          trocou: [n(donoA?.['V']) === dois.id, n(donoB?.['V']) === um.id],
          eventosTroca: n(eventos[0]?.['N']),
          outbox: Object.fromEntries(outbox.map((x) => [String(x['TIPO']).trim(), n(x['N'])])),
          dimFonte: dimLido?.fonte,
          dimParcelas: (dimLido?.calculo.parcelas.length ?? 0) > 0,
          informado: inf
            ? [inf.calculo.totalProfissionais, inf.calculo.enfermeiros, inf.calculo.coberturaSugerida]
            : null,
        };
      });
      console.log(JSON.stringify(r));
      expect(r).toMatchObject({
        antes: 0,
        linhas: [
          ['presencial', true, null, true],
          ['sobreaviso', false, 30, true],
        ],
        especialidade: true,
        as7: ['sobreaviso'],
        prazo: true,
        jaAcionado: 'ja-acionado',
        naoSobreaviso: 'nao-e-sobreaviso',
        chegadaAtrasada: 1,
        acionamento: ['chegou', true],
        emTroca: 'plantao-em-troca',
        propria: 'aprovar-o-que-registrou',
        trocaEstado: 'aprovada',
        trocou: [true, true],
        eventosTroca: 2,
        dimParcelas: true,
        informado: [25, 9, 5],
      });
      expect(r.outbox).toMatchObject({
        PESSOAS_ESCALA_PUBLICADA: 1,
        PESSOAS_SOBREAVISO_ACIONADO: 1,
        PESSOAS_TROCA_PEDIDA: 1,
        PESSOAS_TROCA_APROVADA: 1,
        PESSOAS_ESCALA_ALTERADA: 2,
      });
      expect(r.p95InstanteMs).toBeLessThan(300);
    });
  },
);
