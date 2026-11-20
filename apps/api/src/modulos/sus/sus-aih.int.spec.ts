// Integração da AIH (M51, etapa 4; ficha, seção 10) na cópia, numa transação SEMPRE desfeita, com o escritor só SGH_ e a
// guarda do arquivo em memória:
//   1. a internação SUS real da competência 2025-09 (convênio 1: a cópia não tem conta do SUS, DP-35) e a crítica dela;
//   2. a simulação: os convênios mais frequentes das internações da competência tratados como SUS — a crítica da
//      competência AIH (cada internação sem AIH vira aviso), a leitura inteira da montagem (internações, itens da conta,
//      trajetória, SIGTAP, compatibilidades, leitos de UTI habilitados) e a montagem pela SIGTAP da competência (o que
//      a cópia de 2013 acusa);
//   3. o caminho gravado: a faixa sintética (UF 99), o laudo de uma internação simulada com passagem pela UTI, a
//      autorização com o número da faixa e o fechamento recusado pela regra 6 (as críticas reais), o espelho;
//   4. a montagem com a SIGTAP "atualizada" (vigência aberta, como nas integrações da CIHA e do BPA) e o SISAIH01 das
//      AIHs montadas: 0 erro de estrutura no leiaute;
//   5. as contagens das tabelas SGH_FAT_SUS_* e da trilha da integração iguais antes e depois do ROLLBACK.
// Só contagens, tempos e códigos SIGTAP saem no log (nenhum dado de pessoa).
import { cnsValido } from '@sgh/contratos';
import {
  conferirEstrutura,
  gerarArquivoSisaih,
  LEIAUTE_SISAIH01,
  numeroAih,
  resumoCriticas,
} from '@sgh/dominio-faturamento';
import {
  contagensFaturamentoSus,
  contagensFaturamentoSusAih,
  conveniosInternacaoDaCompetencia,
  internacoesSusDaCompetencia,
  type Leitor,
  lotesSaidaDoAtendimento,
  registrosSigtap,
  somenteSgh,
  trajetoriaDasInternacoes,
} from '@sgh/legado';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';
import { armazemSusMemoria } from './armazem.js';
import { aihParaArquivo, montarAihs } from './montagem-aih.js';
import { dadosAihDoLegado } from './porta-aih-legado.js';
import { portaSusNasTransacoes } from './porta-legado.js';
import { ServicoSusAih } from './servico-aih.js';
import { ServicoSus, type SessaoSus } from './servico.js';

const COMPETENCIA = '202509';
const INTERVALO = { inicio: '2025-09-01', fim: '2025-09-30' };
const ORIGEM = 'SGH-INTEGRACAO:m51e4';

function medir(msg: string): void {
  console.log(msg);
  const pasta = resolve(import.meta.dirname, '../../../../../.tmp');
  mkdirSync(pasta, { recursive: true });
  appendFileSync(resolve(pasta, 'm51-e4-int.log'), `${new Date().toISOString()} ${msg}\n`);
}

/** CNS sintético válido (o autorizador e o diretor clínico da integração: gerados, nunca de pessoa). */
function cnsSintetico(semente: number): string {
  for (let k = 0; k < 1000; k++) {
    const corpo = `7${String(semente * 1000 + k).padStart(14, '0')}`;
    if (cnsValido(corpo)) return corpo;
  }
  throw new Error('sem CNS');
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
        orgaoOrigem: 'H',
        siglaOrigem: 'H',
        cnpj: '00000000000191',
        orgaoDestino: 'SMS',
        indicadorDestino: 'M',
      },
      apac: { uf: '33' },
      aih: {
        utiPorAcomodacao: '3:2:0802010083;7:2:0802010083;8:17:0802010083',
        diretorClinicoCns: cnsSintetico(951),
      },
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
      estacao: `${ORIGEM}`,
      correlacao: 'int-m51e4',
      origem: ORIGEM,
      ...(alvo.diferenca ? { diferenca: alvo.diferenca } : {}),
    }),
  };
}

const contagens = async (l: Leitor) => ({
  ...(await contagensFaturamentoSus(l, ORIGEM)),
  ...(await contagensFaturamentoSusAih(l)),
});

describe.skipIf(!PODE_ESCREVER)('AIH na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  const retrato = () => a.nucleo.lerSomente({ ...a.c, traceId: 'int-m51e4-contagens' }, contagens);
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('internação SUS real, simulação com a montagem pela SIGTAP da competência, o caminho gravado e o SISAIH01', async () => {
    const antes = await retrato();
    let dentro: Record<string, number> = {};
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m51e4' }, async (e0) => {
      const e = somenteSgh(e0);
      const porta = portaSusNasTransacoes(new Map([[a.cod, e]]));
      const armazem = armazemSusMemoria();
      const sus = new ServicoSus(porta, armazem);
      const aih = new ServicoSusAih(
        porta,
        sus,
        armazem,
        async (s) => s.parametros.aih ?? { utiPorAcomodacao: '', diretorClinicoCns: '' },
      );
      sus.registrarMontagem('aih', aih.montadorCritica());
      // 1. A internação SUS real (convênio 1).
      const real = sessao(a.cod, a.c.rede, [1]);
      if (!(await sus.listarCompetencias(real, 'aih')).some((c) => c.competencia === COMPETENCIA))
        await sus.abrir(real, { instrumento: 'aih', competencia: COMPETENCIA });
      const r0 = await sus.criticar(real, { instrumento: 'aih', competencia: COMPETENCIA });
      medir(
        `[m51e4] internação SUS real ${COMPETENCIA}: registros=${r0.registros}; porRegra=${JSON.stringify(r0.porRegra)}; ${r0.tempoMs} ms`,
      );
      expect(r0.porRegra['aih-sem-laudo'] ?? 0).toBe(0);

      // 2. A simulação: os convênios mais frequentes das internações tratados como SUS.
      const convs = await conveniosInternacaoDaCompetencia(e, INTERVALO, 2);
      const conveniosSus = convs.map((x) => x.convenio);
      medir(
        `[m51e4] simulação: ${convs.length} convênios, ${convs.reduce((n, x) => n + x.internacoes, 0)} internações`,
      );
      expect(conveniosSus.length).toBeGreaterThan(0);
      const sim = sessao(a.cod, a.c.rede, conveniosSus);
      const t0 = performance.now();
      const r1 = await sus.criticar(sim, { instrumento: 'aih', competencia: COMPETENCIA });
      medir(
        `[m51e4] crítica AIH simulada ${COMPETENCIA}: ${Math.round(performance.now() - t0)} ms; registros=${r1.registros}; ` +
          `bloqueantes=${r1.bloqueantes}; avisos=${r1.avisos}; porRegra=${JSON.stringify(r1.porRegra)}`,
      );
      expect(r1.porRegra['aih-sem-laudo']).toBeGreaterThan(0);
      const internacoes = await internacoesSusDaCompetencia(e, INTERVALO, conveniosSus);
      const t1 = performance.now();
      const dados = await dadosAihDoLegado(
        e,
        internacoes.map((x) => x.registro),
        ['0303060212', '0802010083'],
        [],
        conveniosSus,
      );
      // A conta de cada internação é a primeira SUS (a mesma da crítica da competência), com todas as parciais SUS.
      const contaDaCritica = new Map(internacoes.map((x) => [x.registro, x.conta]));
      expect(dados.internacoes.every((x) => conveniosSus.includes(x.convenio))).toBe(true);
      expect(dados.internacoes.every((x) => x.conta === contaDaCritica.get(x.registro))).toBe(true);
      expect(dados.internacoes.every((x) => x.conta !== null && x.contasSus[0] === x.conta)).toBe(true);
      const parciais = dados.internacoes.filter((x) => x.contasSus.length > 1).length;
      const itensDasParciais = dados.itens.filter((x) =>
        dados.internacoes.some((i) => i.contasSus.slice(1).includes(x.conta)),
      ).length;
      medir(
        `[m51e4] contas SUS: ${parciais < 5 ? '<5' : parciais} internações com parciais SUS; ` +
          `${itensDasParciais < 5 ? '<5' : itensDasParciais} itens nas parciais além da primeira`,
      );
      medir(
        `[m51e4] leitura da montagem: ${dados.internacoes.length} internações, ${dados.itens.length} itens, ` +
          `${dados.passagens.length} passagens (UTI ${dados.passagens.filter((x) => [3, 7, 8, 9, 17].includes(x.acomodacao)).length}), ` +
          `${dados.procedimentos.length} SIGTAP, compatibilidades cid=${dados.compatibilidades.cids.length} ` +
          `leito=${dados.compatibilidades.leitos.length}; leitos UTI habilitados=${dados.leitosUti.reduce((n, x) => n + x.leitos, 0)}; ` +
          `${Math.round(performance.now() - t1)} ms`,
      );
      // Uma internação simulada com passagem pela UTI (a trajetória) e um procedimento de registro AIH principal.
      const comUti = new Set(
        (
          await trajetoriaDasInternacoes(
            e,
            internacoes.map((x) => x.registro),
          )
        )
          .filter((x) => [3, 7, 8, 9, 17].includes(x.acomodacao))
          .map((x) => x.registro),
      );
      const alvo = internacoes.find((x) => comUti.has(x.registro)) ?? internacoes[0];
      expect(alvo).toBeDefined();
      const regs = await registrosSigtap(
        e,
        dados.procedimentos.map((p) => p.id),
      );
      const principal = dados.procedimentos.find((p) =>
        regs.some((r) => r.id === p.id && r.registro.trim() === '03'),
      );
      medir(
        `[m51e4] internação alvo com UTI: ${comUti.has(alvo?.registro ?? 0)}; principal AIH entre os itens: ${principal?.codigo ?? 'nenhum'}`,
      );
      const lotes = await lotesSaidaDoAtendimento(e, alvo?.registro ?? 0);
      medir(`[m51e4] lotes de saída do atendimento alvo: ${lotes.length}`);

      // 3. O caminho gravado.
      const faixa = await aih.registrarFaixa(sim, {
        acao: 'registrar',
        inicial: numeroAih('999925100001'),
        final: numeroAih('999925100100'),
        orgaoEmissor: 'GESTOR SINTETICO DA INTEGRACAO',
        dataLiberacao: '2025-08-01',
      });
      const i = await aih.internacao(sim, alvo?.registro ?? 0);
      expect(i.sus).toBe(true);
      const laudo = await aih.registrar(sim, {
        acao: 'laudo',
        laudo: {
          registro: i.registro,
          procedimentoSolicitado: principal?.codigo ?? '0303060212',
          cidPrincipal: i.cidPrincipal ?? 'R69',
          cidSecundario: null,
          carater: i.carater ?? '02',
          solicitante: '0',
          dataLaudo: i.entrada ?? '2025-09-01',
          justificativa: 'LAUDO SINTETICO DA INTEGRACAO (TRANSACAO DESFEITA)',
        },
      });
      const autorizada = await aih.registrar(sim, {
        acao: 'autorizar',
        aih: laudo.id,
        versao: laudo.versao,
        faixa: faixa.id,
        numero: null,
        autorizador: cnsSintetico(952),
        dataAutorizacao: i.entrada ?? '2025-09-01',
      });
      expect(autorizada.numero).toBe(numeroAih('999925100001'));
      const t2 = performance.now();
      const espelho = await aih.espelho(sim, autorizada.id);
      const porRegra = resumoCriticas(
        espelho.criticas.map((c) => ({ regra: c.regra as never, gravidade: c.gravidade })),
      ).porRegra;
      medir(
        `[m51e4] espelho da AIH simulada: ${Math.round(performance.now() - t2)} ms; linhas=${espelho.linhas.length} ` +
          `(${espelho.linhas.map((x) => x.tipo).join(',')}); permanência=${espelho.permanencia.dias}; diárias UTI=${espelho.diariasUti.total}; ` +
          `fora=${espelho.itensForaDaAih}; semSigtap=${espelho.itensSemSigtap}; críticas=${JSON.stringify(porRegra)}`,
      );
      const bloqueia = espelho.criticas.some((c) => c.gravidade === 'bloqueante');
      if (bloqueia)
        await expect(
          aih.registrar(sim, {
            acao: 'fechar',
            aih: autorizada.id,
            versao: autorizada.versao,
            procedimentoRealizado: null,
            opm: [],
          }),
        ).rejects.toMatchObject({ extras: expect.objectContaining({ codigo: 'aih-com-bloqueante' }) });
      medir(
        `[m51e4] fechamento pela regra 6: ${bloqueia ? 'recusado (críticas bloqueantes reais)' : 'sem bloqueante'}`,
      );
      // O retorno de uma AIH não apresentada fica fora (não casa).
      const ret = await aih
        .importarRetorno(sim, {
          instrumento: 'aih',
          competencia: COMPETENCIA,
          nomeArquivo: 'RETORNO-INTEGRACAO.CSV',
          conteudo: `instrumento;competencia;identificacao;procedimento;situacao;motivo;valor_apresentado;valor_aprovado\naih;${COMPETENCIA};${autorizada.numero};;A;;1;1`,
        })
        .catch((x: unknown) => x);
      medir(
        `[m51e4] retorno da AIH não apresentada: ${JSON.stringify((ret as { naoCasadas?: unknown }).naoCasadas ?? (ret as { extras?: unknown }).extras ?? null)}`,
      );

      // 4. A montagem com a SIGTAP "atualizada" (vigência aberta) e o SISAIH01 das AIHs montadas.
      const aberta = {
        ...dados,
        procedimentos: dados.procedimentos.map((p) => ({ ...p, competenciaFinal: 0 })),
        historico: [],
        registros: dados.registros.map((r) => ({ ...r, competenciaFinal: 0 })),
      };
      const sinteticas = internacoes.slice(0, 50).map((x, k) => ({
        ...((): Parameters<typeof montarAihs>[1][number] => ({
          id: 1_000_000 + k,
          situacao: 'fechada',
          registro: x.registro,
          prontuario: null,
          conta: x.conta,
          atendimento: null,
          procedimentoSolicitado: principal?.codigo ?? '0303060212',
          procedimentoRealizado: principal?.codigo ?? '0303060212',
          cidPrincipal: dados.internacoes.find((y) => y.registro === x.registro)?.cidPrincipal ?? 'R69',
          cidSecundario: null,
          carater: '02',
          solicitante: '0',
          dataLaudo: dados.internacoes.find((y) => y.registro === x.registro)?.entrada ?? '2025-09-01',
          justificativa: 'X',
          faixa: faixa.id,
          numero: numeroAih(999925100200n + BigInt(k)),
          cnsAutorizador: cnsSintetico(953),
          dataAutorizacao: dados.internacoes.find((y) => y.registro === x.registro)?.entrada ?? '2025-09-01',
          fechamento: 1,
          permanencia: null,
          diariasUti: null,
          diariasUtiAnterior: null,
          competenciaApresentacao: null,
          arquivo: null,
          reapresentacoes: 0,
          justificativaSituacao: null,
          registradaPor: 'SGH.INTEGRACAO',
          registradaEm: '',
          alteradaPor: null,
          alteradaEm: null,
          versao: 1,
        }))(),
      }));
      const montadas = montarAihs(
        aberta,
        sinteticas,
        sim.parametros,
        sim.parametros.aih ?? { utiPorAcomodacao: '', diretorClinicoCns: '' },
        [],
      );
      const porRegraAberta = resumoCriticas(montadas.flatMap((m) => m.resultado.criticas)).porRegra;
      medir(
        `[m51e4] montagem com a SIGTAP aberta: ${montadas.length} AIHs; críticas=${JSON.stringify(porRegraAberta)}`,
      );
      const paraArquivo = montadas
        .map((m) =>
          aihParaArquivo(
            m,
            m.resultado.linhas.map((x, k) => ({
              ...x,
              sequencia: k + 1,
              opm:
                x.tipo === 'opm'
                  ? {
                      cnpjFornecedor: '00000000000191',
                      notaFiscal: 'NF',
                      registroAnvisa: '',
                      serie: '',
                      lote: '',
                    }
                  : null,
            })),
            '00000000191',
          ),
        )
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const arquivo = gerarArquivoSisaih(COMPETENCIA, '3132471', cnsSintetico(951), paraArquivo);
      const problemas = conferirEstrutura(LEIAUTE_SISAIH01, arquivo.conteudo);
      medir(
        `[m51e4] SISAIH01 das AIHs montadas: ${arquivo.registros} AIHs, ${arquivo.procedimentos} linhas de procedimento e OPM, ` +
          `${arquivo.linhas} linhas, controle ${arquivo.controle}; erros de estrutura=${problemas.length}`,
      );
      expect(problemas).toEqual([]);
      dentro = await contagens(e);
    });
    const depois = await retrato();
    medir(
      `[m51e4] contagens: antes=${JSON.stringify(antes)} dentro=${JSON.stringify(dentro)} depois=${JSON.stringify(depois)}`,
    );
    expect(depois).toEqual(antes);
    expect(dentro['SGH_FAT_SUS_AIH']).toBeGreaterThan(antes['SGH_FAT_SUS_AIH'] ?? 0);
  }, 900_000);
});
