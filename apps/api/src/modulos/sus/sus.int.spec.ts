// Integração do faturamento SUS (M51, etapa 1; ficha, seção 10) na cópia, numa transação SEMPRE desfeita, com o
// escritor só SGH_ e a guarda do arquivo em memória:
//   1. uma competência inteira (2025-09): abrir, rodar a crítica (tempo de carga medido), achar o item sem equivalente
//      SIGTAP, registrar a equivalência do procedimento mais frequente e rodar de novo (a crítica dele vira corrigida);
//      o arquivo dos atendimentos sem bloqueante e o da simulação com a SIGTAP "atualizada" saem com 0 erro de
//      estrutura no leiaute oficial do CIHA01;
//   2. mudança de competência SIGTAP no meio do mês: um procedimento real com dois retratos seguidos diferentes; a
//      internação que entra num mês e sai no seguinte é da competência da alta e usa o retrato dela.
// Só contagens, tempos e códigos SIGTAP saem no log (nenhum dado de pessoa); a massa da parte 2 é sintética.
import {
  conferirEstrutura,
  gerarArquivoCiha,
  LEIAUTE_CIHA01,
  catalogoSigtapDaCompetencia,
  atributosDoBanco,
  montarCiha,
} from '@sgh/dominio-faturamento';
import { cnsValido } from '@sgh/contratos';
import {
  contagensFaturamentoSus,
  type Leitor,
  procedimentosSigtap,
  retratosSeguidosDiferentes,
  sigtapVigenteNaCompetencia,
  somenteSgh,
} from '@sgh/legado';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';
import { armazemSusMemoria } from './armazem.js';
import { montarCihaDaCompetencia } from './montagem.js';
import { dadosCihaDoLegado, portaSusNasTransacoes } from './porta-legado.js';
import { ServicoSus, type SessaoSus } from './servico.js';

const COMPETENCIA = '202509';

/** As medições (só contagens, tempos e códigos) no log e em .tmp/m51-int.log, para as evidências. */
function medir(msg: string): void {
  console.log(msg);
  const pasta = resolve(import.meta.dirname, '../../../../../.tmp');
  mkdirSync(pasta, { recursive: true });
  appendFileSync(resolve(pasta, 'm51-int.log'), `${new Date().toISOString()} ${msg}\n`);
}

function sessao(hospital: string, rede: string): SessaoSus {
  return {
    rede,
    hospital,
    login: 'SGH.INTEGRACAO',
    hoje: '2026-10-25',
    convenios: null,
    parametros: {
      // CNES público do ProntoCardio (o cadastro do estabelecimento está zerado na cópia).
      cnes: '3132471',
      conveniosSus: [1],
      conveniosParticular: [10],
      fontePadrao: 'plano-privado',
      fontePorConvenio: new Map([[10, 'particular-pf']]),
      habilitacoes: new Set<string>(),
      bpa: {
        orgaoOrigem: 'HOSPITAL SINTETICO',
        siglaOrigem: 'HSINT',
        cnpj: '11222333000181',
        orgaoDestino: 'SECRETARIA MUNICIPAL DE SAUDE',
        indicadorDestino: 'M',
      },
      apac: { uf: '33' },
    },
    liberado: async (i) => i === 'ciha',
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
      estacao: 'SGH-INTEGRACAO:m51',
      correlacao: 'int-m51',
      origem: 'SGH-INTEGRACAO:m51',
      ...(alvo.diferenca ? { diferenca: alvo.diferenca } : {}),
    }),
  };
}

/** As tabelas do marco e a trilha da própria integração, contadas numa leitura separada (o adaptador conta). */
const contagens = (l: Leitor) => contagensFaturamentoSus(l, 'SGH-INTEGRACAO:m51');

describe.skipIf(!PODE_ESCREVER)('faturamento SUS na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  const retrato = () => a.nucleo.lerSomente({ ...a.c, traceId: 'int-m51-contagens' }, contagens);
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('competência inteira: crítica com item sem equivalente, equivalência corrige, arquivo no leiaute oficial', async () => {
    const antes = await retrato();
    let dentro: Record<string, number> = {};
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m51-competencia' }, async (e0) => {
      const e = somenteSgh(e0);
      const sv = new ServicoSus(portaSusNasTransacoes(new Map([[a.cod, e]])), armazemSusMemoria());
      const s = sessao(a.cod, a.c.rede);
      // A competência pode já existir na cópia (outra execução confirmada): então se usa a que está lá.
      const existente = (await sv.listarCompetencias(s, 'ciha')).find((c) => c.competencia === COMPETENCIA);
      if (!existente) await sv.abrir(s, { instrumento: 'ciha', competencia: COMPETENCIA });
      const t0 = performance.now();
      const r1 = await sv.criticar(s, { instrumento: 'ciha', competencia: COMPETENCIA });
      const tCritica = Math.round(performance.now() - t0);
      medir(
        `[m51] crítica ${COMPETENCIA}: ${tCritica} ms (leitura e montagem ${r1.tempoMs} ms); registros=${r1.registros}; ` +
          `bloqueantes=${r1.bloqueantes}; avisos=${r1.avisos}; porRegra=${JSON.stringify(r1.porRegra)}`,
      );
      const semEquivalente = (r1.porRegra['sem-sigtap'] ?? 0) + (r1.porRegra['item-sem-sigtap'] ?? 0);
      expect(semEquivalente).toBeGreaterThan(0);
      // O procedimento do hospital mais frequente entre os itens sem equivalente.
      const pag = await sv.listarCriticas(s, {
        instrumento: 'ciha',
        competencia: COMPETENCIA,
        regra: 'sem-sigtap',
        pagina: 0,
        porPagina: 200,
      });
      const freq = new Map<number, number>();
      for (const c of pag.itens)
        for (const p of String(c.detalhe['procedimentos'] ?? '')
          .split(',')
          .filter(Boolean))
          freq.set(Number(p), (freq.get(Number(p)) ?? 0) + 1);
      const [procto] = [...freq.entries()].sort((x, y) => y[1] - x[1])[0] ?? [];
      expect(procto).toBeGreaterThan(0);
      // Um procedimento SIGTAP vigente na competência (o código vem da tabela da cópia).
      const codigo = (await sigtapVigenteNaCompetencia(e, Number(COMPETENCIA))) ?? '';
      expect(codigo).toMatch(/^\d{10}$/);
      // O procedimento do hospital é o unificado (TBPROCTO.ID): o nome e a tabela vêm do cadastro.
      const [proc] = await sv.buscarProcedimentosHospital(s, { ids: [procto as number] });
      expect(proc?.id).toBe(procto);
      const tb = performance.now();
      const porNome = await sv.buscarProcedimentosHospital(s, { termo: 'CONSULTA' });
      const tBuscaProc = Math.round(performance.now() - tb);
      const ts = performance.now();
      const sigtaps = await sv.buscarSigtap(s, codigo, COMPETENCIA);
      const tBuscaSigtap = Math.round(performance.now() - ts);
      expect(sigtaps.some((x) => x.codigo === codigo && x.vigente)).toBe(true);
      medir(
        `[m51] buscas: procedimento do hospital por nome ${porNome.length} em ${tBuscaProc} ms; SIGTAP por código ` +
          `${sigtaps.length} em ${tBuscaSigtap} ms`,
      );
      const existente2 = (
        await sv.listarEquivalencias(s, {
          procedimento: procto as number,
          inativas: 'sim',
          pagina: 0,
          porPagina: 10,
        })
      ).itens[0];
      const eq = await sv.registrarEquivalencia(s, {
        procedimento: procto as number,
        sigtap: codigo,
        ...(existente2 ? { versao: existente2.versao } : {}),
      });
      expect(eq.mudou || existente2?.ativa).toBeTruthy();
      const r2 = await sv.criticar(s, { instrumento: 'ciha', competencia: COMPETENCIA });
      medir(
        `[m51] equivalência do procedimento mais frequente (${freq.get(procto as number)} críticas na página) → ${codigo}; ` +
          `nova crítica: corrigidas=${r2.corrigidas}; registros=${r2.registros}; porRegra=${JSON.stringify(r2.porRegra)}`,
      );
      expect(r2.corrigidas).toBeGreaterThan(0);
      expect(r2.registros).toBeGreaterThanOrEqual(r1.registros);

      // O arquivo: os atendimentos sem bloqueante (o que a geração mandaria) e a simulação com a SIGTAP atualizada.
      const dados = await dadosCihaDoLegado(e, { inicio: '2025-09-01', fim: '2025-09-30' }, [1], []);
      const t1 = performance.now();
      const m = montarCihaDaCompetencia(COMPETENCIA, dados, s.parametros, []);
      const arq = gerarArquivoCiha(COMPETENCIA, '3132471', m.resultado.registros);
      const tArquivo = Math.round(performance.now() - t1);
      expect(conferirEstrutura(LEIAUTE_CIHA01, arq.conteudo)).toEqual([]);
      const atualizada = catalogoSigtapDaCompetencia(
        COMPETENCIA,
        dados.procedimentos.map((p) => ({ ...p, competenciaFinal: 0 })),
        [],
        dados.registros,
      );
      const sim = montarCiha(
        dados.atendimentos.map((x) => ({
          conta: x.conta.conta,
          atendimento: x.conta.atendimento,
          modalidade: x.conta.modalidade,
          convenio: x.conta.convenio,
          paciente: x.conta.paciente,
          entrada: x.conta.entrada,
          saida: x.conta.saida,
          cidPrincipal: x.conta.cidPrincipal,
          cidSecundario: x.conta.cidSecundario,
          itens: x.itens,
          motivoAlta: x.conta.motivoAlta,
          beneficiario: x.conta.beneficiario,
          guiaTiss: x.conta.guiaTiss,
          operadora: x.conta.operadora,
        })),
        {
          competencia: COMPETENCIA,
          cnes: '3132471',
          convenios: { sus: [1], particular: [10] },
          fontePorConvenio: (c) => (c === 10 ? 'particular-pf' : 'plano-privado'),
          procedimento: (id) => {
            const p = atualizada(id);
            return p ? { ...p, naCompetencia: { fonte: 'atual', atributos: p.procedimento.atuais } } : null;
          },
          cnsValido,
          cidExiste: (c) => dados.cids.has(c),
        },
      );
      const arqSim = gerarArquivoCiha(COMPETENCIA, '3132471', sim.registros);
      expect(conferirEstrutura(LEIAUTE_CIHA01, arqSim.conteudo)).toEqual([]);
      medir(
        `[m51] arquivo dos sem bloqueante: ${arq.registros} atendimentos, ${arq.linhas} linhas, 0 erro de estrutura, ` +
          `${tArquivo} ms; simulação com a SIGTAP vigente: ${arqSim.registros} atendimentos, ${arqSim.linhas} linhas, ` +
          `0 erro de estrutura`,
      );
      dentro = await contagens(e);
    });
    // Dentro da transação houve escrita; depois do ROLLBACK, nenhuma linha do marco ficou (leitura separada).
    expect(dentro['SGH_FAT_SUS_CRITICA']).toBeGreaterThan(antes['SGH_FAT_SUS_CRITICA'] ?? 0);
    expect(dentro['SGH_TRILHA']).toBeGreaterThan(antes['SGH_TRILHA'] ?? 0);
    const depois = await retrato();
    expect(depois).toEqual(antes);
    medir(`[m51] contagens antes e depois do ROLLBACK iguais: ${JSON.stringify(depois)}`);
  }, 1_200_000);

  it('mudança de competência SIGTAP no meio do mês: a internação usa o retrato da competência da alta', async () => {
    await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m51-retratos' }, async (l) => {
      const k = await retratosSeguidosDiferentes(l);
      expect(k).not.toBeNull();
      const id = k?.id ?? 0;
      const c1 = String(k?.anterior);
      const c2 = String(k?.seguinte);
      const { procedimentos, historico } = await procedimentosSigtap(l, [id]);
      const proc = procedimentos.map((p) => ({ ...p, competenciaInicial: 0, competenciaFinal: 0 }));
      const em = (c: string) => catalogoSigtapDaCompetencia(c, proc, historico)(id)?.naCompetencia;
      const r1 = historico.find((h) => String(h.competencia) === c1)!;
      const r2 = historico.find((h) => String(h.competencia) === c2)!;
      expect(em(c1)).toEqual({ fonte: 'historico', atributos: atributosDoBanco(r1) });
      expect(em(c2)).toEqual({ fonte: 'historico', atributos: atributosDoBanco(r2) });
      expect(em(c1)).not.toEqual(em(c2));
      // Internação sintética que entra no fim de c1 e sai no começo de c2.
      const dia = (c: string, d: number) => `${c.slice(0, 4)}-${c.slice(4, 6)}-${String(d).padStart(2, '0')}`;
      const at = {
        conta: 1,
        atendimento: 1,
        modalidade: 'internacao' as const,
        convenio: 20,
        paciente: {
          cns: null,
          cpf: '52998224725',
          sexo: atributosDoBanco(r2).sexo === 'M' ? 'M' : 'F',
          nascimento: '1980-01-01',
          municipio: 330390,
          nome: 'PACIENTE SINTETICO',
          logradouro: 'RUA SINTETICA',
          uf: 'RJ',
          cep: '25600000',
          prontuario: 1,
        },
        entrada: dia(c1, 25),
        saida: dia(c2, 3),
        cidPrincipal: 'I10',
        cidSecundario: null,
        itens: [{ item: 1, sigtap: id, quantidade: 1 }],
        motivoAlta: 12,
        beneficiario: 'CARTEIRA-SINT',
        operadora: { regAns: 123456, cnpj: null },
      };
      const ctx = (c: string) => ({
        competencia: c,
        cnes: '3132471',
        fontePorConvenio: () => 'plano-privado' as const,
        procedimento: catalogoSigtapDaCompetencia(c, proc, historico),
        cnsValido,
      });
      const naAlta = montarCiha([at], ctx(c2));
      const naEntrada = montarCiha([at], ctx(c1));
      expect(naAlta.criticas.map((x) => x.regra)).not.toContain('data-fora-da-competencia');
      expect(naEntrada.criticas.map((x) => x.regra)).toContain('data-fora-da-competencia');
      medir(
        `[m51] retratos ${c1} e ${c2} do procedimento ${procedimentos[0]?.codigo}: a internação ${at.entrada} → ${at.saida} usa ${c2}`,
      );
    });
  });
});
