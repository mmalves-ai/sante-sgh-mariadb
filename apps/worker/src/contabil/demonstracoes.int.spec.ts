// M54.3 sobre a cópia (ficha, regra 5 e seção 10), tudo numa transação desfeita (ROLLBACK):
// (a) o exercício sintético 2001 (sem movimento na cópia): três lançamentos manuais (receita, despesa com centro de
//     custo, e um entre contas patrimoniais); as somas por conta do banco (com e sem centro), o balancete montado sobre
//     elas (débitos = créditos e saldos devedores = saldos credores), o diário (página e totais do intervalo inteiro), a
//     apuração do resultado gravada como lançamento real (tipo `apuracao`, por centro de custo, contra o patrimônio
//     líquido): a apuração ativa reconhecida, a soma sem a apuração (a DRE) igual à de antes e a com ela zerando as
//     contas de resultado;
// (b) o arquivo do SPED: gravado (número 1), o segundo do mesmo exercício substitui o primeiro (número 2), o conteúdo
//     cifrado relido igual, o recibo registra a transmissão e o cancelamento do transmitido é recusado;
// (c) só leitura: os dados da empresa 1 para o SPED (só o que é da empresa; nada impresso) e as somas do diário real
//     do último ano (agregado no banco, dentro do teto).
// Depois do ROLLBACK, as contagens SGH_CTB_* e os arquivos são os de antes. Só contagens (abaixo de 5 vira <5).
import { resolve } from 'node:path';
import type { ContaPlano } from '@sgh/contratos';
import { chaveApuracao, dataDaApuracao, montarBalancete, planoDaApuracao } from '@sgh/dominio-contabil';
import {
  ambienteEfetivo,
  apuracoesDoExercicioSgh,
  arquivosSpedSgh,
  caminhoArquivoAmbiente,
  contagensCtbSgh,
  conteudoArquivoSpedSgh,
  diarioSgh,
  empresaParaSpedLegado,
  type Escritor,
  gravarArquivoSpedSgh,
  gravarLancamentoSgh,
  incluirContaSgh,
  type LancamentoSgh,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  periodosSgh,
  planoDeContasSgh,
  situacaoArquivoSpedSgh,
  somasPorContaSgh,
  somenteSgh,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const raiz = resolve(import.meta.dirname, '../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE_ESCREVER = codigos.length > 0 && travaDaCopiaSegura(process.pid);
const pouco = (n: number) => (n < 5 ? '<5' : String(n));
const USUARIO = 'SINT.CONTADOR';
const EXERCICIO = 2001;
const CAIXA = '1.1.1.01.9902';
const CLIENTES = '1.1.2.01.9902';
const RECEITA = '3.1.1.01.9902';
const DESPESA = '4.1.1.01.9902';
const PL = '2.4.1.01.9902';
const CENTRO = 12;

const conta = (
  codigo: string,
  grupo: ContaPlano['grupo'],
  natureza: ContaPlano['natureza'],
  exigeCentroCusto = false,
): ContaPlano => ({
  empresa: 1,
  codigo,
  nome: `Conta sintética ${codigo}`,
  grupo,
  tipo: 'analitica',
  natureza,
  referencialTipo: null,
  referencialConta: null,
  contaExportacao: null,
  exigeCentroCusto,
  ativa: true,
});
const PLANO = [
  conta(CAIXA, 'ativo', 'devedora'),
  conta(CLIENTES, 'ativo', 'devedora'),
  conta(RECEITA, 'receita', 'credora'),
  conta(DESPESA, 'despesa', 'devedora', true),
  conta(PL, 'patrimonioLiquido', 'credora'),
];

const manual = (
  chave: string,
  data: string,
  d: string,
  c: string,
  valor: number,
  centro: number | null = null,
): LancamentoSgh => ({
  chave,
  tipo: 'manual',
  empresa: 1,
  data,
  competencia: data.slice(0, 7),
  historico: `Integração M54.3 ${chave}`,
  partidas: [
    {
      lado: 'D',
      conta: d,
      valorCentavos: valor,
      historico: 'Sintético',
      centroCusto: d === DESPESA ? centro : null,
    },
    {
      lado: 'C',
      conta: c,
      valorCentavos: valor,
      historico: 'Sintético',
      centroCusto: c === DESPESA ? centro : null,
    },
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

describe.skipIf(!PODE_ESCREVER)('demonstrações contábeis e SPED na cópia (transação desfeita)', () => {
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
    nucleo.lerSomente({ rede: nucleo.rede, hospital: cod, traceId: 'int-m543-contagens' }, async (l) => ({
      ...(await contagensCtbSgh(l, cod)),
      arquivos: (await arquivosSpedSgh(l, cod, 1, 1_000)).length,
    }));

  async function incluirPlano(e: Escritor) {
    const existentes = new Set((await planoDeContasSgh(e, cod, 1)).map((c) => c.codigo));
    for (const c of PLANO)
      if (!existentes.has(c.codigo))
        await incluirContaSgh(somenteSgh(e), { hospital: cod, conta: c, usuario: USUARIO });
  }

  it('somas, balancete, diário e a apuração do resultado do exercício sintético', async () => {
    const antes = await contagens();
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m543-exercicio' };
    const r = await nucleo.desfazendoNaCopia(ctx, async (e0) => {
      const e = somenteSgh(e0);
      await incluirPlano(e0);
      await gravarLancamentoSgh(
        e,
        cod,
        manual('manual:int-543-1', '2001-03-10', CLIENTES, RECEITA, 100_000),
        USUARIO,
      );
      await gravarLancamentoSgh(
        e,
        cod,
        manual('manual:int-543-2', '2001-07-15', DESPESA, CAIXA, 30_000, CENTRO),
        USUARIO,
      );
      await gravarLancamentoSgh(
        e,
        cod,
        manual('manual:int-543-3', '2001-08-01', CAIXA, CLIENTES, 40_000),
        USUARIO,
      );
      const plano = (await planoDeContasSgh(e0, cod, 1)).filter((c) =>
        PLANO.some((p) => p.codigo === c.codigo),
      );
      const nosso = new Set(PLANO.map((p) => p.codigo));
      const so = <T extends { conta: string }>(xs: readonly T[]) => xs.filter((x) => nosso.has(x.conta));
      const ate = `${EXERCICIO}-12-31`;
      const somas = so(
        (await somasPorContaSgh(e0, cod, { empresa: 1, de: `${EXERCICIO}-01-01`, ate }, 5_000)).itens,
      );
      const porCentro = so(
        (
          await somasPorContaSgh(
            e0,
            cod,
            { empresa: 1, de: `${EXERCICIO}-01-01`, ate, porCentro: true },
            5_000,
          )
        ).itens,
      );
      const bal = montarBalancete(plano, [], somas, { nivel: null, incluirZeradas: false, filtrado: false });
      const diario = await diarioSgh(e0, cod, 1, `${EXERCICIO}-01-01`, ate, 2, 1);
      const diario2 = await diarioSgh(e0, cod, 1, `${EXERCICIO}-01-01`, ate, 2, 2);

      // A apuração: o lançamento real do encerramento (o mesmo plano que a API grava).
      const ap0 = await apuracoesDoExercicioSgh(e0, cod, 1, EXERCICIO);
      const p = planoDaApuracao({
        exercicio: EXERCICIO,
        plano,
        saldos: porCentro,
        contaDestino: PL,
        hoje: '2026-10-29',
        dezembroEncerrado: false,
        apuracaoAtiva: ap0.ativa,
      });
      const g = await gravarLancamentoSgh(
        e,
        cod,
        {
          chave: chaveApuracao(1, EXERCICIO, ap0.quantidade + 1),
          tipo: 'apuracao',
          empresa: 1,
          data: dataDaApuracao(EXERCICIO),
          competencia: `${EXERCICIO}-12`,
          historico: `Apuração do resultado do exercício de ${EXERCICIO}`,
          partidas: p.partidas,
          fatoId: null,
          regraId: null,
          regra: null,
          estornaId: null,
          justificativa: 'Integração M54.3',
        },
        USUARIO,
      );
      const ap1 = await apuracoesDoExercicioSgh(e0, cod, 1, EXERCICIO);
      const semAp = so(
        (
          await somasPorContaSgh(
            e0,
            cod,
            { empresa: 1, de: `${EXERCICIO}-01-01`, ate, semApuracao: true },
            5_000,
          )
        ).itens,
      );
      const comAp = so(
        (await somasPorContaSgh(e0, cod, { empresa: 1, de: `${EXERCICIO}-01-01`, ate }, 5_000)).itens,
      );
      return { somas, porCentro, bal, diario, diario2, ap0, ap1, p, g, semAp, comAp };
    });
    const total = (d: { porTipo: readonly { lancamentos: number }[] }) =>
      d.porTipo.reduce((a, x) => a + x.lancamentos, 0);
    const saldo = (xs: readonly { conta: string; debitos: number; creditos: number }[], c: string) =>
      xs.filter((x) => x.conta === c).reduce((s, x) => s + x.debitos - x.creditos, 0);
    console.log(
      `[${cod}] exercício ${EXERCICIO}: contas com movimento ${pouco(r.somas.length)}; diário ${total(r.diario)} ` +
        `lançamentos (página 1: ${r.diario.lancamentos.length}); apuração com ${r.p.partidas.length} partidas, resultado ` +
        `${r.p.resultado}; balancete ${r.bal.equilibrado ? 'equilibrado' : 'DESEQUILIBRADO'}`,
    );
    // Somas e balancete (regra 5: parcelas e conferência).
    expect(saldo(r.somas, CLIENTES)).toBe(60_000);
    expect(saldo(r.somas, CAIXA)).toBe(10_000);
    expect(saldo(r.somas, RECEITA)).toBe(-100_000);
    expect(saldo(r.somas, DESPESA)).toBe(30_000);
    expect(r.porCentro.find((x) => x.conta === DESPESA)?.centroCusto).toBe(CENTRO);
    expect(r.bal.equilibrado).toBe(true);
    expect(r.bal.totais.debitosCentavos).toBe(170_000);
    expect(r.bal.totais.creditosCentavos).toBe(170_000);
    expect(r.bal.totais.saldoFinalDevedorCentavos).toBe(r.bal.totais.saldoFinalCredorCentavos);
    expect(r.bal.conferencia.length).toBeGreaterThan(0);
    // Diário: página de 2 e os totais do intervalo inteiro.
    expect(r.diario.lancamentos).toHaveLength(2);
    expect(r.diario.parcial).toBe(true);
    expect(r.diario2.lancamentos.length).toBeGreaterThanOrEqual(1);
    expect(total(r.diario)).toBeGreaterThanOrEqual(3);
    expect(r.diario.porTipo.find((x) => x.tipo === 'manual')?.debitos).toBeGreaterThanOrEqual(170_000);
    // A apuração: resultado 700,00, por centro de custo, sem impedimento; reconhecida como ativa.
    expect(r.p.impedimentos).toEqual([]);
    expect(r.p.resultado).toBe(70_000);
    expect(r.p.partidas.find((x) => x.conta === DESPESA)?.centroCusto).toBe(CENTRO);
    expect(r.ap0.ativa).toBeNull();
    expect(r.ap1.ativa).toBe(r.g.id);
    // A DRE (sem a apuração) igual à de antes; com a apuração, as contas de resultado zeram e o PL recebe o superávit.
    expect(saldo(r.semAp, RECEITA)).toBe(-100_000);
    expect(saldo(r.comAp, RECEITA)).toBe(0);
    expect(saldo(r.comAp, DESPESA)).toBe(0);
    expect(saldo(r.comAp, PL)).toBe(-70_000);
    expect(await contagens()).toEqual(antes);
  }, 600_000);

  it('o arquivo do SPED: gravar, substituir, reler cifrado, recibo; o transmitido não se cancela', async () => {
    const antes = await contagens();
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m543-sped' };
    const novo = (n: number) => ({
      hospital: cod,
      empresa: 1,
      tipo: 'ecd' as const,
      exercicio: EXERCICIO,
      leiaute: '9.00',
      substituta: false,
      nomeArquivo: `ECD_${EXERCICIO}_${n}.txt`,
      conteudoCifrado: `cifrado-sintetico-${n}-${'x'.repeat(4_000)}`,
      tamanho: 4_000,
      linhas: 42,
      hash: String(n).repeat(64).slice(0, 64),
      parametros: JSON.stringify({ numeroOrdem: 1, qualificacoes: ['900', '203'] }),
      usuario: USUARIO,
    });
    const r = await nucleo.desfazendoNaCopia(ctx, async (e0) => {
      const e = somenteSgh(e0);
      const a1 = await gravarArquivoSpedSgh(e, novo(1));
      const a2 = await gravarArquivoSpedSgh(e, novo(2));
      const lista = (await arquivosSpedSgh(e0, cod, 1, 50)).filter((x) => x.exercicio === EXERCICIO);
      const conteudo = await conteudoArquivoSpedSgh(e0, cod, 1, a2.id);
      const transmitido = await situacaoArquivoSpedSgh(e, {
        hospital: cod,
        empresa: 1,
        id: a2.id,
        acao: 'recibo',
        recibo: '12.34.56.78.90-12',
        transmitidoEm: '2002-06-30',
        motivo: null,
        usuario: USUARIO,
      });
      const cancelar = await codigoDa(
        situacaoArquivoSpedSgh(e, {
          hospital: cod,
          empresa: 1,
          id: a2.id,
          acao: 'cancelar',
          recibo: null,
          transmitidoEm: null,
          motivo: 'Cancelamento sintético recusado',
          usuario: USUARIO,
        }),
      );
      return { a1, a2, lista, conteudo, transmitido, cancelar };
    });
    expect(r.a1.numero).toBe(1);
    expect(r.a2).toMatchObject({ numero: 2, substituidos: 1 });
    expect(r.lista.find((x) => x.id === r.a1.id)?.situacao).toBe('substituido');
    expect(r.conteudo?.conteudoCifrado).toBe(novo(2).conteudoCifrado);
    expect(r.conteudo?.hash).toBe(novo(2).hash);
    expect(r.transmitido).toMatchObject({ situacao: 'transmitido', recibo: '12.34.56.78.90-12' });
    expect(r.cancelar).not.toBe('gravou');
    expect(await contagens()).toEqual(antes);
  }, 600_000);

  it('só leitura: a empresa para o SPED e o diário real do último ano dentro do teto', async () => {
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m543-leitura' };
    const inicio = performance.now();
    const r = await nucleo.lerSomente(ctx, async (l) => {
      const emp = await empresaParaSpedLegado(l, 1);
      const d = await diarioSgh(l, cod, 1, '2025-10-01', '2026-09-30', 50, 1);
      const s = await somasPorContaSgh(l, cod, { empresa: 1, de: '2025-10-01', ate: '2026-09-30' }, 5_000);
      return {
        temEmpresa: emp !== null,
        cnpj: emp?.cnpj?.length ?? 0,
        lancamentos: d.porTipo.reduce((a, x) => a + x.lancamentos, 0),
        equilibrado: d.porTipo.every((x) => x.debitos === x.creditos),
        contas: s.itens.length,
        parcial: s.parcial,
      };
    });
    const ms = Math.round(performance.now() - inicio);
    console.log(
      `[${cod}] leitura real: empresa ${r.temEmpresa ? 'achada' : 'ausente'}; diário do último ano ` +
        `${pouco(r.lancamentos)} lançamentos (${r.equilibrado ? 'débitos = créditos' : 'DESEQUILIBRADO'}); contas ` +
        `${pouco(r.contas)}; ${ms} ms`,
    );
    expect(r.temEmpresa).toBe(true);
    expect([0, 14]).toContain(r.cnpj);
    expect(r.equilibrado).toBe(true);
    expect(r.parcial).toBe(false);
    expect(ms).toBeLessThan(30_000);
  }, 600_000);

  // Meta da ficha (§4): p95 < 2 s para o balancete, a DRE e o diário. A cópia não tem fatos contabilizados (a marca
  // começa em 0, D-MARCA0-541, e não há regra publicada): a massa é sintética, com o volume de um mês cheio
  // (LANCAMENTOS_MES lançamentos, 2 partidas cada, CONTAS_MASSA contas, parte com centro de custo), gravada e desfeita
  // na mesma transação. Cada demonstração repete as leituras que o serviço faz (plano, somas, períodos ou diário).
  it('desempenho: balancete, DRE e diário (página 1) com a massa de um mês, p95 < 2 s', async () => {
    const LANCAMENTOS_MES = 3_000;
    const CONTAS_MASSA = 60;
    const REPETICOES = 20;
    const antes = await contagens();
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m543-desempenho' };
    const r = await nucleo.desfazendoNaCopia(ctx, async (e0) => {
      const e = somenteSgh(e0);
      await incluirPlano(e0);
      const existentes = new Set((await planoDeContasSgh(e0, cod, 1)).map((c) => c.codigo));
      const ativos: string[] = [];
      const receitas: string[] = [];
      for (let i = 0; i < CONTAS_MASSA / 2; i++) {
        const a = `1.1.1.01.98${String(i).padStart(2, '0')}`;
        const rc = `3.1.1.01.98${String(i).padStart(2, '0')}`;
        for (const c of [conta(a, 'ativo', 'devedora'), conta(rc, 'receita', 'credora')])
          if (!existentes.has(c.codigo))
            await incluirContaSgh(somenteSgh(e0), { hospital: cod, conta: c, usuario: USUARIO });
        ativos.push(a);
        receitas.push(rc);
      }
      const t0 = performance.now();
      for (let i = 0; i < LANCAMENTOS_MES; i++) {
        const dia = String((i % 28) + 1).padStart(2, '0');
        const comCentro = i % 3 === 0;
        await gravarLancamentoSgh(
          e,
          cod,
          comCentro
            ? manual(
                `manual:int-543-massa-${i}`,
                `${EXERCICIO}-03-${dia}`,
                DESPESA,
                ativos[i % ativos.length]!,
                1_000 + i,
                CENTRO,
              )
            : manual(
                `manual:int-543-massa-${i}`,
                `${EXERCICIO}-03-${dia}`,
                ativos[i % ativos.length]!,
                receitas[Math.floor(i / 3) % receitas.length]!,
                1_000 + i,
              ),
          USUARIO,
        );
      }
      const gravacaoMs = Math.round(performance.now() - t0);
      const de = `${EXERCICIO}-03-01`;
      const ate = `${EXERCICIO}-03-31`;
      const medir = async (fn: () => Promise<unknown>) => {
        const ms: number[] = [];
        for (let i = 0; i < REPETICOES; i++) {
          const t = performance.now();
          await fn();
          ms.push(performance.now() - t);
        }
        ms.sort((a, b) => a - b);
        return {
          p50: Math.round(ms[Math.floor(REPETICOES * 0.5)]!),
          p95: Math.round(ms[Math.ceil(REPETICOES * 0.95) - 1]!),
          max: Math.round(ms[REPETICOES - 1]!),
        };
      };
      let contas = 0;
      const balancete = await medir(async () => {
        // Em sequência (a transação tem uma conexão só): o serviço as faz em paralelo, então isto é o pior caso.
        await planoDeContasSgh(e0, cod, 1);
        const ant = await somasPorContaSgh(
          e0,
          cod,
          { empresa: 1, de: null, ate: `${EXERCICIO}-02-28` },
          5_000,
        );
        const mov = await somasPorContaSgh(e0, cod, { empresa: 1, de, ate }, 5_000);
        await periodosSgh(e0, cod, 1);
        contas = mov.itens.length;
        expect(ant.parcial || mov.parcial).toBe(false);
      });
      const dre = await medir(async () => {
        await planoDeContasSgh(e0, cod, 1);
        await somasPorContaSgh(e0, cod, { empresa: 1, de, ate, semApuracao: true }, 5_000);
      });
      let lancamentosDiario = 0;
      const diario = await medir(async () => {
        await planoDeContasSgh(e0, cod, 1);
        const d = await diarioSgh(e0, cod, 1, de, ate, 200, 1);
        lancamentosDiario = d.porTipo.reduce((a, x) => a + x.lancamentos, 0);
      });
      return { gravacaoMs, contas, lancamentosDiario, balancete, dre, diario };
    });
    const linha = (n: string, x: { p50: number; p95: number; max: number }) =>
      `${n} p50 ${x.p50} ms, p95 ${x.p95} ms, máx ${x.max} ms`;
    console.log(
      `[${cod}] desempenho (massa sintética de ${LANCAMENTOS_MES} lançamentos em ${EXERCICIO}-03, ${CONTAS_MASSA} contas, ` +
        `gravada em ${r.gravacaoMs} ms; ${REPETICOES} repetições): ${linha('balancete', r.balancete)}; ` +
        `${linha('DRE', r.dre)}; ${linha('diário pág. 1', r.diario)}; contas com movimento ${r.contas}; ` +
        `lançamentos no diário ${r.lancamentosDiario}`,
    );
    expect(r.lancamentosDiario).toBeGreaterThanOrEqual(LANCAMENTOS_MES);
    expect(r.contas).toBeGreaterThanOrEqual(CONTAS_MASSA);
    expect(r.balancete.p95).toBeLessThan(2_000);
    expect(r.dre.p95).toBeLessThan(2_000);
    expect(r.diario.p95).toBeLessThan(2_000);
    expect(await contagens()).toEqual(antes);
  }, 1_800_000);
});
