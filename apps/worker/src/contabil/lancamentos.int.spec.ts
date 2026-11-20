// M54.2 sobre a cópia (ficha, regras 1, 3 e 5; seção 10), tudo numa transação desfeita (ROLLBACK):
// (a) ciclo da competência sintética 2001-01 (anterior sem movimento): dois lançamentos manuais (o período nasce e fica
//     travado na transação do lançamento), a conciliação da conta (débito de um com crédito do outro), o desfazer e a
//     conciliação de novo (a UNIQUE com a partida ativa NULL deixa reconciliar), o estorno de um deles e o segundo
//     estorno recusado pela UNIQUE, o encerramento (impedimentos do domínio conferidos na transação), o lançamento no
//     período encerrado recusado, e a reabertura do último encerrado;
// (b) contabilização de um fato real da cópia: o título a pagar mais recente vira fato pela leitura incremental e o
//     lote do worker (`acessoContabilizacao` + `contabilizarPendentes`) grava o lançamento automático com a chave do fato,
//     débitos = créditos = valor do fato (regra e contas SINTÉTICAS, publicadas na transação); a segunda passada não
//     lança de novo.
// Depois do ROLLBACK, as contagens SGH_CTB_* são as de antes. Só contagens (abaixo de 5 vira <5); nenhum dado de pessoa.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { ContaPlano, RegraContabil } from '@sgh/contratos';
import {
  cicloDaFonte,
  conteudoCanonicoRegra,
  impedimentosDoEncerramento,
  planoDoEstorno,
  problemasDaConciliacao,
  recusaDaReabertura,
} from '@sgh/dominio-contabil';
import {
  acessoCicloFatos,
  acessoContabilizacao,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  conciliarSgh,
  contagensCtbSgh,
  desfazerConciliacaoSgh,
  encerrarPeriodoSgh,
  type Escritor,
  estadosDasFontesSgh,
  fatoDaOrigemSgh,
  gravarEstadoFonteSgh,
  gravarLancamentoSgh,
  incluirContaSgh,
  lancamentoPorChaveSgh,
  lancamentoSgh,
  type LancamentoSgh,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  pendentesConciliacaoSgh,
  periodosSgh,
  planoDeContasSgh,
  publicarRegraSgh,
  reabrirPeriodoSgh,
  somenteSgh,
  tituloPagarRecenteComValor,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contabilizarPendentes } from './contabilizacao.js';

const raiz = resolve(import.meta.dirname, '../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE_ESCREVER = codigos.length > 0 && travaDaCopiaSegura(process.pid);
const pouco = (n: number) => (n < 5 ? '<5' : String(n));
const USUARIO = 'SINT.CONTADOR';
const HOJE = '2026-10-29';
const COMP = '2001-01';
const A = '1.1.1.01.9901';
const B = '2.1.1.01.9901';
const DESPESA = '4.1.1.01.9901';

const conta = (codigo: string, grupo: ContaPlano['grupo'], natureza: ContaPlano['natureza']): ContaPlano => ({
  empresa: 1,
  codigo,
  nome: `Conta sintética ${codigo}`,
  grupo,
  tipo: 'analitica',
  natureza,
  referencialTipo: null,
  referencialConta: null,
  contaExportacao: null,
  exigeCentroCusto: false,
  ativa: true,
});
const PLANO = [
  conta(A, 'ativo', 'devedora'),
  conta(B, 'passivo', 'credora'),
  conta(DESPESA, 'despesa', 'devedora'),
];
const REGRA: RegraContabil = {
  empresa: 1,
  origem: 1,
  tipoFato: 'tituloPagar',
  versao: 1,
  nome: 'Título a pagar (integração M54.2)',
  vigenciaInicio: '1900-01-01',
  vigenciaFim: null,
  prioridade: 1,
  condicoes: [],
  partidas: [
    {
      lado: 'D',
      conta: { modo: 'fixa', conta: DESPESA },
      valor: { base: 'valorFato' },
      historico: 'Título {documento}',
      centroCusto: 'nenhum',
    },
    {
      lado: 'C',
      conta: { modo: 'fixa', conta: B },
      valor: { base: 'valorFato' },
      historico: 'Título {documento}',
      centroCusto: 'nenhum',
    },
  ],
};

const manual = (chave: string, data: string, d: string, c: string, valor: number): LancamentoSgh => ({
  chave,
  tipo: 'manual',
  empresa: 1,
  data,
  competencia: data.slice(0, 7),
  historico: `Integração M54.2 ${chave}`,
  partidas: [
    { lado: 'D', conta: d, valorCentavos: valor, historico: 'Sintético', centroCusto: null },
    { lado: 'C', conta: c, valorCentavos: valor, historico: 'Sintético', centroCusto: null },
  ],
  fatoId: null,
  regraId: null,
  regra: null,
  estornaId: null,
  justificativa: null,
});

const codigoDa = async (p: Promise<unknown>) =>
  p.then(
    () => 'gravou',
    (x: unknown) => (x as { problema?: { codigo?: string } }).problema?.codigo ?? String(x),
  );

describe.skipIf(!PODE_ESCREVER)('lançamentos contábeis na cópia (transação desfeita)', () => {
  let nucleo: NucleoLegado;
  const cod = codigos[0] as string;
  beforeAll(async () => {
    nucleo = new NucleoLegado({
      env: { ...env, FB_POOL_TETO: '4', FB_LOCK_TIMEOUT_S: '2' },
      driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
      pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
    });
    await nucleo.verificarSchema(cod);
  }, 600_000);
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  const contagens = () =>
    nucleo.lerSomente({ rede: nucleo.rede, hospital: cod, traceId: 'int-m542-contagens' }, (l) =>
      contagensCtbSgh(l, cod),
    );

  /** As contas sintéticas que ainda não existem no plano da cópia. */
  async function incluirPlano(e: Escritor) {
    const existentes = new Set((await planoDeContasSgh(e, cod, 1)).map((c) => c.codigo));
    for (const c of PLANO)
      if (!existentes.has(c.codigo))
        await incluirContaSgh(somenteSgh(e), { hospital: cod, conta: c, usuario: USUARIO });
  }

  it('manual → período travado → conciliação → estorno (o segundo recusado) → encerrar bloqueia → reabrir', async () => {
    const antes = await contagens();
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m542-ciclo' };
    const r = await nucleo.desfazendoNaCopia(ctx, async (e0) => {
      const e = somenteSgh(e0);
      await incluirPlano(e0);
      const m1 = await gravarLancamentoSgh(
        e,
        cod,
        manual('manual:int-542-1', '2001-01-10', A, B, 10_000),
        USUARIO,
      );
      const repetido = await gravarLancamentoSgh(
        e,
        cod,
        manual('manual:int-542-1', '2001-01-10', A, B, 10_000),
        USUARIO,
      );
      const m2 = await gravarLancamentoSgh(
        e,
        cod,
        manual('manual:int-542-2', '2001-01-20', B, A, 10_000),
        USUARIO,
      );
      const periodoNasceu = (await periodosSgh(e0, cod, 1)).find((p) => p.competencia === COMP);

      // Conciliação da conta A: o débito do 1º com o crédito do 2º.
      const pend = await pendentesConciliacaoSgh(e0, cod, 1, A, '2001-01-31', 50);
      const ids = pend.filter((p) => p.lancamento === m1.id || p.lancamento === m2.id).map((p) => p.id);
      const conc = (partidas: number[]) =>
        conciliarSgh(e, {
          hospital: cod,
          empresa: 1,
          conta: A,
          partidas,
          observacao: null,
          usuario: USUARIO,
          conferir: (achadas) => problemasDaConciliacao(partidas, achadas, 1, A),
        });
      const c1 = await conc(ids);
      const duplaConciliacao = await codigoDa(conc(ids));
      await desfazerConciliacaoSgh(e, {
        hospital: cod,
        empresa: 1,
        id: c1.id,
        justificativa: 'Desfeita na integração M54.2.',
        usuario: USUARIO,
      });
      const c2 = await conc(ids);

      // Estorno do 1º (partidas invertidas pelo domínio); o segundo estorno colide na UNIQUE.
      const original = await lancamentoSgh(e0, cod, m1.id);
      if (!original) throw new Error('lançamento 1 não lido');
      const periodos = (await periodosSgh(e0, cod, 1)).map((p) => ({
        empresa: p.empresa,
        competencia: p.competencia,
        situacao: p.situacao,
      }));
      const plano = planoDoEstorno(original, periodos, HOJE, 'Estorno da integração M54.2.', '2001-01-25');
      if (!plano.ok) throw new Error(plano.motivo);
      const est = await gravarLancamentoSgh(e, cod, plano.lancamento, USUARIO);
      const segundoEstorno = await codigoDa(
        gravarLancamentoSgh(e, cod, { ...plano.lancamento, chave: 'estorno:int-542-outra' }, USUARIO),
      );
      const estornado = await lancamentoSgh(e0, cod, m1.id);

      // Encerramento com as regras do domínio na transação; depois, o lançamento no período é recusado.
      const enc = await encerrarPeriodoSgh(e, {
        hospital: cod,
        empresa: 1,
        competencia: COMP,
        observacao: null,
        usuario: USUARIO,
        conferir: (d) =>
          impedimentosDoEncerramento({
            competencia: COMP,
            hoje: HOJE,
            encerrado: d.periodo.situacao === 'encerrado',
            fatos: d.fatos,
            debitos: d.debitos,
            creditos: d.creditos,
            anteriorAbertaComMovimento: d.anteriorAbertaComMovimento,
          }),
      });
      const noEncerrado = await codigoDa(
        gravarLancamentoSgh(e, cod, manual('manual:int-542-3', '2001-01-28', A, B, 500), USUARIO),
      );
      const situacaoEncerrada = (await periodosSgh(e0, cod, 1)).find((p) => p.competencia === COMP)?.situacao;
      await reabrirPeriodoSgh(e, {
        hospital: cod,
        empresa: 1,
        competencia: COMP,
        justificativa: 'Reaberto na integração M54.2.',
        usuario: USUARIO,
        conferir: (ps) =>
          recusaDaReabertura(
            ps.map((p) => ({ empresa: p.empresa, competencia: p.competencia, situacao: p.situacao })),
            1,
            COMP,
          ),
      });
      const depoisDeReabrir = await gravarLancamentoSgh(
        e,
        cod,
        manual('manual:int-542-4', '2001-01-28', A, B, 500),
        USUARIO,
      );
      const situacaoFinal = (await periodosSgh(e0, cod, 1)).find((p) => p.competencia === COMP)?.situacao;
      return {
        m1,
        repetido,
        m2,
        periodoNasceu,
        ids,
        c1,
        duplaConciliacao,
        c2,
        est,
        segundoEstorno,
        estornadoPor: estornado?.estornadoPor ?? null,
        enc,
        noEncerrado,
        situacaoEncerrada,
        depoisDeReabrir,
        situacaoFinal,
      };
    });
    console.log(
      `[${cod}] ciclo ${COMP}: lançamentos ${pouco(r.enc.lancamentos)}, D ${r.enc.debitos} = C ${r.enc.creditos}; ` +
        `conciliação ${r.ids.length} partidas; 2ª conciliação ${r.duplaConciliacao}; 2º estorno ${r.segundoEstorno}; ` +
        `no encerrado ${r.noEncerrado}; final ${r.situacaoFinal}`,
    );
    expect(r.repetido).toEqual({ id: r.m1.id, repetido: true });
    expect(r.periodoNasceu?.situacao).toBe('aberto');
    expect(r.ids).toHaveLength(2);
    expect(r.duplaConciliacao).not.toBe('gravou');
    expect(r.c2.id).not.toBe(r.c1.id);
    expect(r.c2.valor).toBe(10_000);
    expect(r.est.repetido).toBe(false);
    expect(r.estornadoPor).toBe(r.est.id);
    expect(r.segundoEstorno).toBe('ja-estornado');
    expect(r.enc).toMatchObject({
      lancamentos: 3,
      debitos: 30_000,
      creditos: 30_000,
      anteriorAbertaComMovimento: null,
    });
    expect(r.situacaoEncerrada).toBe('encerrado');
    expect(r.noEncerrado).toBe('periodo-encerrado');
    expect(r.depoisDeReabrir.repetido).toBe(false);
    expect(r.situacaoFinal).toBe('aberto');
    expect(await contagens()).toEqual(antes);
  }, 600_000);

  it('o título a pagar mais recente vira fato e o lote do worker grava o lançamento automático uma vez só', async () => {
    const antes = await contagens();
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m542-contabilizar' };
    const r = await nucleo.desfazendoNaCopia(ctx, async (e0) => {
      const mesma = <X>(fn: (x: typeof e0) => Promise<X>) => fn(e0);
      // O fato: a marca da fonte logo abaixo do título mais recente com valor (a leitura incremental do M54.1).
      const alvo = await tituloPagarRecenteComValor(e0);
      if (alvo === null) throw new Error('A cópia não tem título a pagar recente com valor.');
      const id = alvo;
      const existente = (await estadosDasFontesSgh(e0, cod)).find((x) => x.tabela === 'MFCONPAG');
      await gravarEstadoFonteSgh(somenteSgh(e0), {
        hospital: cod,
        tabela: 'MFCONPAG',
        marca: id - 1,
        varredura: 1,
        lidosNovos: 0,
        lidosAlterados: 0,
        fatosGravados: 0,
        versaoVista: existente?.versao ?? null,
      });
      const ciclo = acessoCicloFatos(mesma, mesma, { rede: nucleo.rede, hospital: cod });
      await cicloDaFonte(ciclo, 'MFCONPAG', {
        empresa: 1,
        hoje: HOJE,
        opcoes: { lote: 50, folga: 0, faixaVarredura: 1 },
      });
      const f = await fatoDaOrigemSgh(e0, cod, 'MFCONPAG', id);
      const idFato = f?.id ?? 0;
      const competencia = f?.competencia ?? '';
      const valor = f?.valorCentavos ?? 0;
      // A regra e as contas sintéticas, publicadas na transação (a cópia não tem regra publicada).
      await incluirPlano(e0);
      const conteudo = conteudoCanonicoRegra(REGRA);
      await publicarRegraSgh(somenteSgh(e0), {
        hospital: cod,
        regra: REGRA,
        conteudo,
        impressao: createHash('sha256').update(conteudo, 'utf8').digest('hex'),
        justificativa: 'Regra sintética da integração M54.2.',
        usuario: USUARIO,
      });
      const acesso = acessoContabilizacao(mesma, mesma, { rede: nucleo.rede, hospital: cod });
      const primeira = await contabilizarPendentes(acesso, {
        empresa: 1,
        competencia,
        maxLotes: 1,
        lote: 50,
      });
      const l = await lancamentoPorChaveSgh(e0, cod, `fato:${idFato}`);
      const s = await fatoDaOrigemSgh(e0, cod, 'MFCONPAG', id);
      const segunda = await contabilizarPendentes(acesso, { empresa: 1, competencia, maxLotes: 1, lote: 50 });
      const n = await lancamentoPorChaveSgh(e0, cod, `fato:${idFato}`);
      return {
        idFato,
        competencia,
        valor,
        primeira,
        segunda,
        lanc: l,
        situacao: s?.situacao ?? '',
        vezes: n?.vezes ?? 0,
      };
    });
    console.log(
      `[${cod}] contabilização ${r.competencia}: 1ª passada fatos ${pouco(r.primeira.fatos)}, lançamentos ` +
        `${pouco(r.primeira.lancamentos)}, sem regra ${pouco(r.primeira.semRegra)}; 2ª passada lançamentos ` +
        `${pouco(r.segunda.lancamentos)}; lançamentos do fato ${r.vezes}`,
    );
    expect(Number.isSafeInteger(r.idFato) && r.idFato > 0).toBe(true);
    expect(r.primeira.lancamentos).toBeGreaterThanOrEqual(1);
    expect(r.lanc?.tipo).toBe('automatico');
    expect(r.lanc?.debitos).toBe(r.valor);
    expect(r.lanc?.creditos).toBe(r.valor);
    expect(r.situacao).toBe('contabilizado');
    expect(r.vezes).toBe(1);
    expect(r.segunda.lancamentos).toBe(0);
    expect(await contagens()).toEqual(antes);
  }, 600_000);
});
