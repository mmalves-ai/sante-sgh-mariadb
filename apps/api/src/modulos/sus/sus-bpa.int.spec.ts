// Integração do BPA (M51, etapa 2; ficha, seção 10) na cópia, numa transação SEMPRE desfeita, com o escritor só SGH_ e a
// guarda do arquivo em memória:
//   1. a produção SUS real da competência 2025-09 (convênio 1: a cópia não tem conta do SUS, DP-35) e a crítica dela;
//   2. a simulação: os três convênios mais frequentes da competência tratados como SUS — a leitura inteira (fichas,
//      itens com o executante, SIGTAP, as quatro listas de compatibilidade), a crítica com o validador de compatibilidade
//      pela SIGTAP da competência (gravada e desfeita), e o arquivo BPA-Mag das fichas sem bloqueante com a SIGTAP
//      "atualizada" (vigência aberta, como faz a integração da CIHA): 0 erro de estrutura;
//   3. as contagens das tabelas SGH_FAT_SUS_* e da trilha da integração iguais antes e depois do ROLLBACK.
// Só contagens, tempos e códigos SIGTAP saem no log (nenhum dado de pessoa).
import { cnsValido } from '@sgh/contratos';
import {
  catalogoSigtapDaCompetencia,
  compatibilidadesDaCompetencia,
  conferirEstrutura,
  gerarArquivoBpa,
  LEIAUTE_BPA_MAG,
  montarBpa,
  resumoCriticas,
} from '@sgh/dominio-faturamento';
import {
  contagensFaturamentoSus,
  conveniosAmbulatoriaisDaCompetencia,
  type Leitor,
  somenteSgh,
} from '@sgh/legado';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';
import { armazemSusMemoria } from './armazem.js';
import { dadosBpaDoLegado, portaSusNasTransacoes } from './porta-legado.js';
import { ServicoSus, type SessaoSus } from './servico.js';

const COMPETENCIA = '202509';
const INTERVALO = { inicio: '2025-09-01', fim: '2025-09-30' };

function medir(msg: string): void {
  console.log(msg);
  const pasta = resolve(import.meta.dirname, '../../../../../.tmp');
  mkdirSync(pasta, { recursive: true });
  appendFileSync(resolve(pasta, 'm51-e2-int.log'), `${new Date().toISOString()} ${msg}\n`);
}

function sessao(hospital: string, rede: string, conveniosSus: readonly number[]): SessaoSus {
  return {
    rede,
    hospital,
    login: 'SGH.INTEGRACAO',
    hoje: '2026-10-26',
    convenios: null,
    parametros: {
      cnes: '3132471',
      conveniosSus,
      conveniosParticular: [],
      fontePadrao: 'plano-privado',
      fontePorConvenio: new Map(),
      habilitacoes: new Set<string>(),
      bpa: {
        orgaoOrigem: 'PRONTOCARDIO',
        siglaOrigem: 'PC',
        cnpj: '00000000000191',
        orgaoDestino: 'SECRETARIA MUNICIPAL DE SAUDE',
        indicadorDestino: 'M',
      },
      apac: { uf: '33' },
    },
    liberado: async () => true,
    trilha: (evento, operacao, alvo) => ({
      rede,
      hospital,
      usuario: 'SGH.INTEGRACAO',
      evento,
      recurso: 'faturamento.sus',
      operacao,
      tabelaAlvo: alvo.tabela,
      idAlvo: alvo.id,
      chaveNaturalAlvo: null,
      resultado: 'sucesso',
      estacao: 'SGH-INTEGRACAO:m51e2',
      correlacao: 'int-m51e2',
      origem: 'SGH-INTEGRACAO:m51e2',
      ...(alvo.diferenca ? { diferenca: alvo.diferenca } : {}),
    }),
  };
}

const contagens = (l: Leitor) => contagensFaturamentoSus(l, 'SGH-INTEGRACAO:m51e2');

describe.skipIf(!PODE_ESCREVER)('BPA na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  const retrato = () => a.nucleo.lerSomente({ ...a.c, traceId: 'int-m51e2-contagens' }, contagens);
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('produção SUS real, simulação com o validador de compatibilidade e o arquivo no leiaute do BPA-Mag', async () => {
    const antes = await retrato();
    let dentro: Record<string, number> = {};
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m51e2' }, async (e0) => {
      const e = somenteSgh(e0);
      const sv = new ServicoSus(portaSusNasTransacoes(new Map([[a.cod, e]])), armazemSusMemoria());
      // 1. A produção SUS real (convênio 1).
      const real = sessao(a.cod, a.c.rede, [1]);
      if (!(await sv.listarCompetencias(real, 'bpa')).some((c) => c.competencia === COMPETENCIA))
        await sv.abrir(real, { instrumento: 'bpa', competencia: COMPETENCIA });
      const r0 = await sv.criticar(real, { instrumento: 'bpa', competencia: COMPETENCIA });
      medir(
        `[m51e2] produção SUS real ${COMPETENCIA}: atendimentos=${r0.registros}; fora (não SUS)=${r0.foraPorSerSus}; ` +
          `porRegra=${JSON.stringify(r0.porRegra)}; ${r0.tempoMs} ms`,
      );
      expect(r0.registros).toBe(0);

      // 2. A simulação: os convênios mais frequentes tratados como SUS.
      const convs = await conveniosAmbulatoriaisDaCompetencia(e, INTERVALO, 3);
      const sus = convs.map((x) => x.convenio);
      medir(
        `[m51e2] simulação: ${convs.length} convênios, ${convs.reduce((n, x) => n + x.fichas, 0)} fichas`,
      );
      expect(sus.length).toBeGreaterThan(0);
      const sim = sessao(a.cod, a.c.rede, sus);
      const t0 = performance.now();
      const r1 = await sv.criticar(sim, { instrumento: 'bpa', competencia: COMPETENCIA });
      medir(
        `[m51e2] crítica simulada ${COMPETENCIA}: ${Math.round(performance.now() - t0)} ms (leitura e montagem ` +
          `${r1.tempoMs} ms); atendimentos=${r1.registros}; bloqueantes=${r1.bloqueantes}; avisos=${r1.avisos}; ` +
          `porRegra=${JSON.stringify(r1.porRegra)}`,
      );
      expect(r1.bloqueantes + r1.avisos).toBeGreaterThan(0);

      // O arquivo com a SIGTAP "atualizada" (vigência aberta) e as compatibilidades reais da competência.
      const t1 = performance.now();
      const dados = await dadosBpaDoLegado(e, INTERVALO, sus, []);
      const tLeitura = Math.round(performance.now() - t1);
      const comp = dados.compatibilidades;
      medir(
        `[m51e2] leitura: ${dados.atendimentos.length} fichas, ${dados.atendimentos.reduce((n, x) => n + x.itens.length, 0)} ` +
          `itens, ${dados.procedimentos.length} SIGTAP; compatibilidades cid=${comp.cids.length} cbo=${comp.cbos.length} ` +
          `hab=${comp.habilitacoes.length} leito=${comp.leitos.length}; ${tLeitura} ms`,
      );
      const fichas = dados.atendimentos.map((x) => ({
        conta: x.conta.conta,
        atendimento: x.conta.atendimento,
        convenio: x.conta.convenio,
        data: x.conta.data,
        cidPrincipal: x.conta.cidPrincipal,
        paciente: x.conta.paciente,
        itens: x.itens,
      }));
      const aberta = <T extends { competenciaFinal: number }>(xs: readonly T[]) =>
        xs.map((x) => ({ ...x, competenciaFinal: 0 }));
      const contexto = (cbos: boolean) => ({
        competencia: COMPETENCIA,
        cnes: '3132471',
        convenios: { sus, particular: [] },
        procedimento: catalogoSigtapDaCompetencia(
          COMPETENCIA,
          aberta(dados.procedimentos),
          [],
          aberta(dados.registros),
        ),
        compatibilidades: compatibilidadesDaCompetencia(COMPETENCIA, {
          cids: aberta(comp.cids),
          cbos: cbos ? aberta(comp.cbos) : [],
          habilitacoes: aberta(comp.habilitacoes),
          leitos: aberta(comp.leitos),
        }),
        habilitacoes: new Set<string>(),
        cnsValido,
        cidExiste: (cid: string) => dados.cids.has(cid),
      });
      // (a) A SIGTAP atualizada com as compatibilidades da cópia: o validador acusa o CBO do executante (a lista de CBO
      // da cópia é de 2013 e não tem as ocupações dos executantes de hoje).
      const m = montarBpa(fichas, contexto(true));
      const rs = resumoCriticas(m.criticas);
      medir(
        `[m51e2] simulação (a) SIGTAP atualizada e compatibilidades da cópia: BPA-C ${m.consolidado.length}, BPA-I ` +
          `${m.individualizado.length}; críticas porRegra=${JSON.stringify(rs.porRegra)}`,
      );
      expect(rs.porRegra['cbo-incompativel'] ?? 0).toBeGreaterThan(0);
      // (b) Sem a lista de CBO (como se a do Ministério estivesse carregada e compatível): o arquivo das fichas sem
      // bloqueante no leiaute do BPA-Mag, 0 erro de estrutura.
      const t2 = performance.now();
      const m2 = montarBpa(fichas, contexto(false));
      const arq = gerarArquivoBpa(
        COMPETENCIA,
        '3132471',
        sim.parametros.bpa,
        m2.consolidado,
        m2.individualizado,
        m2.atendimentos,
      );
      const tArquivo = Math.round(performance.now() - t2);
      medir(
        `[m51e2] simulação (b) sem a lista de CBO: BPA-C ${m2.consolidado.length} linhas ` +
          `(${m2.consolidado.reduce((n, x) => n + x.quantidade, 0)} procedimentos), BPA-I ${m2.individualizado.length} ` +
          `linhas, ${m2.atendimentos} atendimentos; arquivo ${arq.linhas} linhas, ${arq.folhas} folhas, controle ` +
          `${arq.controle}; montagem e arquivo ${tArquivo} ms; críticas porRegra=` +
          `${JSON.stringify(resumoCriticas(m2.criticas).porRegra)}`,
      );
      expect(m2.consolidado.length).toBeGreaterThan(0);
      expect(conferirEstrutura(LEIAUTE_BPA_MAG, arq.conteudo)).toEqual([]);
      dentro = await contagens(e);
    });
    const depois = await retrato();
    medir(
      `[m51e2] contagens antes=${JSON.stringify(antes)} dentro=${JSON.stringify(dentro)} depois=${JSON.stringify(depois)}`,
    );
    expect(depois).toEqual(antes);
    expect(dentro['SGH_FAT_SUS_CRITICA'] ?? 0).toBeGreaterThan(antes['SGH_FAT_SUS_CRITICA'] ?? 0);
  }, 1_800_000);
});
