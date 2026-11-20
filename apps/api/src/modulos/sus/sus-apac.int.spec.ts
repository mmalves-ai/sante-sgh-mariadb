// Integração da APAC (M51, etapa 3; ficha, seção 10) na cópia, numa transação SEMPRE desfeita, com o escritor só SGH_ e a
// guarda do arquivo em memória:
//   1. a competência APAC real de 2025-09 (convênio 1: a cópia não tem conta do SUS, DP-35): 0 APAC, 0 produção;
//   2. as leituras reais: os domínios do laudo de nefrologia (FAHEMO*), os solicitantes (FAMEDSOL) e o atendimento do
//      laudo (RECADATE, a conta e o paciente) — só contagens e a presença dos campos no log;
//   3. a simulação pelo serviço: os três convênios mais frequentes da competência tratados como SUS; o laudo num
//      atendimento real (o procedimento de um item dele), a autorização (número e CNS do autorizador sintéticos), a
//      crítica da competência APAC (a leitura inteira da produção) e a continuidade — gravados e desfeitos;
//   4. o arquivo APAC-Mag pelo domínio sobre a mesma leitura, com a SIGTAP "atualizada" (vigência aberta) e o
//      procedimento do laudo tratado como de registro APAC (a SIGTAP da cópia é de 2013): 0 erro de estrutura;
//   5. as contagens das tabelas SGH_FAT_SUS_* e da trilha da integração iguais antes e depois do ROLLBACK.
// Só contagens, tempos e códigos SIGTAP saem no log (nenhum dado de pessoa).
import { cnsValido } from '@sgh/contratos';
import {
  type ApacParaMontar,
  catalogoSigtapDaCompetencia,
  compatibilidadesDaCompetencia,
  conferirEstrutura,
  digitoApac,
  gerarArquivoApac,
  LEIAUTE_APAC_MAG,
  montarApac,
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
import { cnsSintetico } from './porta-memoria.js';
import { dadosBpaDoLegado, portaSusNasTransacoes } from './porta-legado.js';
import { ServicoSus, type SessaoSus } from './servico.js';

const COMPETENCIA = '202509';
const INTERVALO = { inicio: '2025-09-01', fim: '2025-09-30' };
const ORIGEM = 'SGH-INTEGRACAO:m51e3';

function medir(msg: string): void {
  console.log(msg);
  const pasta = resolve(import.meta.dirname, '../../../../../.tmp');
  mkdirSync(pasta, { recursive: true });
  appendFileSync(resolve(pasta, 'm51-e3-int.log'), `${new Date().toISOString()} ${msg}\n`);
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
      estacao: ORIGEM,
      correlacao: 'int-m51e3',
      origem: ORIGEM,
      ...(alvo.diferenca ? { diferenca: alvo.diferenca } : {}),
    }),
  };
}

const contagens = (l: Leitor) => contagensFaturamentoSus(l, ORIGEM);
const numero = (k: number) => {
  const b = `99250900000${k}`;
  return `${b}${digitoApac(b)}`;
};

describe.skipIf(!PODE_ESCREVER)('APAC na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  const retrato = () => a.nucleo.lerSomente({ ...a.c, traceId: 'int-m51e3-contagens' }, contagens);
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('competência real, leituras, laudo e autorização simulados, crítica e o arquivo no leiaute do APAC-Mag', async () => {
    const antes = await retrato();
    let dentro: Record<string, number> = {};
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m51e3' }, async (e0) => {
      const e = somenteSgh(e0);
      const porta = portaSusNasTransacoes(new Map([[a.cod, e]]));
      const sv = new ServicoSus(porta, armazemSusMemoria());
      // 1. A competência APAC real (convênio 1).
      const real = sessao(a.cod, a.c.rede, [1]);
      if (!(await sv.listarCompetencias(real, 'apac')).some((c) => c.competencia === COMPETENCIA))
        await sv.abrir(real, { instrumento: 'apac', competencia: COMPETENCIA });
      const r0 = await sv.criticar(real, { instrumento: 'apac', competencia: COMPETENCIA });
      medir(
        `[m51e3] APAC real ${COMPETENCIA}: apacs=${r0.registros}; porRegra=${JSON.stringify(r0.porRegra)}; ${r0.tempoMs} ms`,
      );
      expect(r0.registros).toBe(0);

      // 2. As leituras reais (só contagens).
      const dom = await sv.dominiosApac(real);
      medir(
        `[m51e3] domínios do laudo de nefrologia: tratamento=${dom.caracteristicaTratamento.length} contraindicação=` +
          `${dom.contraindicacaoTransplante.length} situação=${dom.situacaoTransplante.length} acesso=` +
          `${dom.acessoVascular.length}`,
      );
      expect(dom.caracteristicaTratamento.length + dom.acessoVascular.length).toBeGreaterThan(0);
      const sols = await sv.buscarSolicitantesApac(real, 'a');
      medir(`[m51e3] solicitantes SUS (FAMEDSOL) achados por "a": ${sols.length < 5 ? '<5' : sols.length}`);

      // 3. A simulação pelo serviço.
      const convs = await conveniosAmbulatoriaisDaCompetencia(e, INTERVALO, 3);
      const sus = convs.map((x) => x.convenio);
      const sim = sessao(a.cod, a.c.rede, sus);
      const t1 = performance.now();
      const dados = await dadosBpaDoLegado(e, INTERVALO, sus, []);
      medir(
        `[m51e3] leitura da produção simulada: ${dados.atendimentos.length} fichas, ` +
          `${dados.atendimentos.reduce((n, x) => n + x.itens.length, 0)} itens, ${dados.procedimentos.length} SIGTAP; ` +
          `${Math.round(performance.now() - t1)} ms`,
      );
      const comVinculo = dados.atendimentos.find(
        (x) => x.conta.pacienteId !== null && x.itens.some((i) => i.sigtap !== null),
      );
      expect(comVinculo).toBeDefined();
      const ficha = comVinculo!;
      const item = ficha.itens.find((i) => i.sigtap !== null)!;
      const proc = dados.procedimentos.find((p) => p.id === item.sigtap)!;
      const at = await sv.atendimentoLaudoApac(sim, ficha.conta.registro);
      expect(at.registro).toBe(ficha.conta.registro);
      expect(at.contaSus).toBe(true);
      medir(
        `[m51e3] atendimento do laudo conferido: conta SUS (simulada)=${at.contaSus}; prontuário presente=` +
          `${at.prontuario !== null}; CNS válido=${at.cnsValido}; procedimento ${proc.codigo}`,
      );
      // O solicitante: o do cadastro, se houver um; o laudo sem ele é recusado (prova da conferência).
      const sol = sols[0];
      const laudo = {
        acao: 'laudo' as const,
        laudo: {
          registro: ficha.conta.registro,
          procedimento: proc.codigo,
          cidPrincipal: ficha.conta.cidPrincipal ?? 'I10',
          cidSecundario: null,
          cidAssociado: null,
          solicitante: sol?.chave ?? '12345678909',
          dataSolicitacao: '2025-09-01',
          justificativa: 'Justificativa sintética da integração da APAC.',
          laudoEspecifico: 'nenhum' as const,
          nefrologia: null,
        },
      };
      if (!sol) {
        await expect(sv.registrarApac(sim, laudo)).rejects.toMatchObject({
          extras: expect.objectContaining({ codigo: 'apac-solicitante-desconhecido' }),
        });
        medir('[m51e3] sem solicitante no cadastro: o laudo é recusado (apac-solicitante-desconhecido)');
      } else if (proc.codigo.startsWith('0305')) {
        medir(
          '[m51e3] o procedimento do item exige o laudo de nefrologia: a simulação do laudo fica no passo 4',
        );
      } else {
        const l0 = await sv.registrarApac(sim, laudo);
        // A correção do laudo na solicitada (D-CORRIGIR-513): o UPDATE só do transcrito, na versão lida.
        const l1 = await sv.registrarApac(sim, {
          acao: 'corrigir',
          apac: l0.id,
          versao: l0.versao,
          laudo: {
            cidPrincipal: laudo.laudo.cidPrincipal,
            cidSecundario: 'I10',
            cidAssociado: null,
            solicitante: sol.chave,
            dataSolicitacao: '2025-09-01',
            justificativa: 'Justificativa sintética corrigida da integração da APAC.',
            laudoEspecifico: 'nenhum',
            nefrologia: null,
          },
        });
        expect(l1).toMatchObject({
          situacao: 'solicitada',
          cidSecundario: 'I10',
          procedimento: l0.procedimento,
        });
        expect(l1.versao).not.toBe(l0.versao);
        medir(
          '[m51e3] laudo corrigido na cópia: CID secundário e justificativa, versão nova, procedimento mantido',
        );
        const a2 = await sv.registrarApac(sim, {
          acao: 'autorizar',
          apac: l1.id,
          versao: l1.versao,
          numero: numero(1),
          tipo: 'inicial',
          autorizador: cnsSintetico(995),
          dataAutorizacao: '2025-09-02',
          competenciaInicial: COMPETENCIA,
          competenciaFinal: '202511',
        });
        expect(a2.situacao).toBe('autorizada');
        const v = (await sv.listarCompetencias(sim, 'apac')).find((c) => c.competencia === COMPETENCIA)!;
        const t2 = performance.now();
        const r1 = await sv.criticar(sim, { instrumento: 'apac', competencia: COMPETENCIA });
        medir(
          `[m51e3] crítica APAC simulada ${COMPETENCIA}: ${Math.round(performance.now() - t2)} ms (leitura e montagem ` +
            `${r1.tempoMs} ms); apacs=${r1.registros}; bloqueantes=${r1.bloqueantes}; avisos=${r1.avisos}; ` +
            `porRegra=${JSON.stringify(r1.porRegra)}`,
        );
        // A SIGTAP da cópia (2013) não registra o procedimento como de APAC: a APAC fica sem produção (aviso).
        expect(r1.bloqueantes + r1.avisos).toBeGreaterThan(0);
        expect(v.instrumento).toBe('apac');
        const c1 = await sv.registrarApac(sim, { acao: 'continuar', apac: a2.id, versao: a2.versao });
        expect(c1.ultimaCompetencia).toBe('202510');
        const lista = await sv.listarApacs(sim, { competencia: '202510', pagina: 0, porPagina: 50 });
        expect(lista.total).toBeGreaterThan(0);
      }

      // 4. O arquivo pelo domínio, com a SIGTAP "atualizada" e o procedimento do laudo tratado como de APAC.
      const aberta = <T extends { competenciaFinal: number }>(xs: readonly T[]) =>
        xs.map((x) => ({ ...x, competenciaFinal: 0 }));
      const registros = [
        ...aberta(dados.registros).filter((r) => r.id !== proc.id),
        { id: proc.id, registro: '06', competenciaInicial: 200801, competenciaFinal: 0 },
      ];
      const catalogo = catalogoSigtapDaCompetencia(COMPETENCIA, aberta(dados.procedimentos), [], registros);
      const atendimentos = dados.atendimentos.map((x) => ({
        conta: x.conta.conta,
        atendimento: x.conta.atendimento,
        pacienteId: x.conta.pacienteId,
        convenio: x.conta.convenio,
        data: x.conta.data,
        cidPrincipal: x.conta.cidPrincipal,
        // A ficha do laudo leva CNS, mãe e cadastro sintéticos quando o real não basta (só em memória; nada é logado).
        paciente:
          x === ficha
            ? {
                ...x.conta.paciente,
                cns: cnsValido(x.conta.paciente.cns ?? '') ? x.conta.paciente.cns : cnsSintetico(996),
                mae: x.conta.paciente.mae || 'MAE SINTETICA',
                nome: x.conta.paciente.nome || 'PACIENTE SINTETICO',
                sexo:
                  x.conta.paciente.sexo === 'M' || x.conta.paciente.sexo === 'F'
                    ? x.conta.paciente.sexo
                    : 'F',
                nascimento: x.conta.paciente.nascimento ?? '1970-01-01',
                municipio: x.conta.paciente.municipio || 330455,
              }
            : x.conta.paciente,
        itens: x.itens.map((i) =>
          i === item ? { ...i, executante: { cbo: '225125', cns: cnsSintetico(997), cpf: null } } : i,
        ),
      }));
      const apac: ApacParaMontar = {
        id: 1,
        situacao: 'autorizada',
        tipo: 'inicial',
        numero: numero(2),
        paciente: ficha.conta.pacienteId,
        procedimento: proc.codigo,
        cidPrincipal: ficha.conta.cidPrincipal ?? 'I10',
        cidSecundario: null,
        cidAssociado: null,
        dataSolicitacao: '2025-09-01',
        dataAutorizacao: '2025-09-02',
        competenciaInicial: COMPETENCIA,
        competenciaFinal: '202511',
        ultimaCompetencia: COMPETENCIA,
        autorizador: cnsSintetico(995),
        solicitante: { cns: cnsSintetico(998), nome: 'MEDICO SOLICITANTE SINTETICO' },
        laudoEspecifico: proc.codigo.startsWith('0305') ? 'nefrologia' : 'nenhum',
        nefrologia: proc.codigo.startsWith('0305')
          ? {
              caracteristicaTratamento: dom.caracteristicaTratamento[0]?.id ?? 1,
              contraindicacaoTransplante: dom.contraindicacaoTransplante[0]?.id ?? 1,
              situacaoTransplante: dom.situacaoTransplante[0]?.id ?? 1,
              acessoVascular: dom.acessoVascular[0]?.id ?? 1,
              inicioTratamento: '2025-01-10',
            }
          : null,
        motivoSaida: null,
        dataEncerramento: null,
      };
      const t3 = performance.now();
      const m = montarApac([apac], atendimentos, {
        competencia: COMPETENCIA,
        cnes: '3132471',
        convenios: { sus, particular: [] },
        procedimento: catalogo,
        compatibilidades: compatibilidadesDaCompetencia(COMPETENCIA, {
          cids: [],
          cbos: [],
          habilitacoes: [],
          leitos: [],
        }),
        habilitacoes: new Set<string>(),
        cnsValido,
      });
      const arq = gerarArquivoApac(
        COMPETENCIA,
        '3132471',
        { ...sim.parametros.bpa, uf: '33' },
        m.apacs,
        '2026-10-26',
      );
      medir(
        `[m51e3] simulação do arquivo: apacs=${m.apacs.length}, procedimentos=${arq.procedimentos}, atendimentos com ` +
          `APAC=${m.atendimentos}; arquivo ${arq.linhas} linhas, controle ${arq.controle}; ` +
          `${Math.round(performance.now() - t3)} ms; críticas porRegra=${JSON.stringify(resumoCriticas(m.criticas).porRegra)}`,
      );
      expect(m.apacs).toHaveLength(1);
      expect(conferirEstrutura(LEIAUTE_APAC_MAG, arq.conteudo)).toEqual([]);
      dentro = await contagens(e);
    });
    const depois = await retrato();
    medir(
      `[m51e3] contagens antes=${JSON.stringify(antes)} dentro=${JSON.stringify(dentro)} depois=${JSON.stringify(depois)}`,
    );
    expect(depois).toEqual(antes);
    expect(dentro['SGH_FAT_SUS_COMPETENCIA'] ?? 0).toBeGreaterThanOrEqual(
      antes['SGH_FAT_SUS_COMPETENCIA'] ?? 0,
    );
  }, 1_800_000);
});
