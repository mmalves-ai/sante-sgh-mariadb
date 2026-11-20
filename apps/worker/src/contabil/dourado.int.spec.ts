// Dourado da F1 do M54 na cópia (correção da revisão do M54.1; preparo §1.8, D-DOURADO-541 e D-DEPARA-541): numa
// transação desfeita, o de-para da exportação ganha contas SINTÉTICAS no nível do convênio de dois convênios (TBINTCRC,
// a linha sem ato nem subtipo; um terceiro fica sem conta), lido pela MESMA leitura da contabilização
// (deParaDaExportacao) e indexado pela chave convênio (contextoDeAplicacao). Os mesmos itens lidos alimentam o lote do
// M32 (montarLoteContabil) e o motor (contabilizar) sobre uma competência sintética desses convênios: a contagem, o que
// fica sem conta e os totais por conta batem. Depois do ROLLBACK, nada fica. Só contagens; os fatos são sintéticos.
import { resolve } from 'node:path';
import type { ContaPlano, FatoContabil, RegraContabil } from '@sgh/contratos';
import { contabilizar, contextoDeAplicacao } from '@sgh/dominio-contabil';
import { type DePara, montarLoteContabil } from '@sgh/dominio-financeiro';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  deParaDaExportacao,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const raiz = resolve(import.meta.dirname, '../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE_ESCREVER = codigos.length > 0 && travaDaCopiaSegura(process.pid);

// Contas do escritório SINTÉTICAS (fora da faixa que o pc usa: o de-para está todo sem conta em 24/10/2026).
const EXP_A = 990_101;
const EXP_B = 990_102;
const EXP_RECEITA = 990_301;

const conta = (codigo: string, extra: Partial<ContaPlano>): ContaPlano => ({
  empresa: 1,
  codigo,
  nome: `Conta sintética ${codigo}`,
  grupo: 'ativo',
  tipo: 'analitica',
  natureza: 'devedora',
  referencialTipo: null,
  referencialConta: null,
  contaExportacao: null,
  exigeCentroCusto: false,
  ativa: true,
  ...extra,
});
const PLANO: ContaPlano[] = [
  conta('1.1.2.01.0001', { contaExportacao: EXP_A }),
  conta('1.1.2.01.0002', { contaExportacao: EXP_B }),
  conta('3.1.1.01.0001', { grupo: 'receita', natureza: 'credora', contaExportacao: EXP_RECEITA }),
];
const REGRA: RegraContabil = {
  empresa: 1,
  origem: 3,
  tipoFato: 'receitaConta',
  versao: 1,
  nome: 'Receita da conta fechada (sintética)',
  vigenciaInicio: '2027-01-01',
  vigenciaFim: null,
  prioridade: 100,
  condicoes: [],
  partidas: [
    {
      lado: 'D',
      conta: { modo: 'dePara', campoChave: 'convenio', contaPadrao: null },
      valor: { base: 'valorFato' },
      historico: 'Conta {documento}',
      centroCusto: 'nenhum',
    },
    {
      lado: 'C',
      conta: { modo: 'fixa', conta: '3.1.1.01.0001' },
      valor: { base: 'valorFato' },
      historico: 'Receita {competencia}',
      centroCusto: 'nenhum',
    },
  ],
};

describe.skipIf(!PODE_ESCREVER)('dourado na cópia: o de-para lido da exportação (transação desfeita)', () => {
  let nucleo: NucleoLegado;
  const cod = codigos[0] as string;
  beforeAll(async () => {
    nucleo = new NucleoLegado({
      env: { ...env, FB_POOL_TETO: '4', FB_LOCK_TIMEOUT_S: '2' },
      driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
      pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
    });
    await nucleo.verificarSchema(cod);
    // A conferência do schema da cópia passa de 1 min com a máquina ocupada (o E2E e a outra cópia).
  }, 600_000);
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  const comConta = () =>
    nucleo.lerSomente(
      { rede: nucleo.rede, hospital: cod, traceId: 'int-m54-dourado-contagem' },
      async (l) => {
        const [x] = await l.consultar(
          'SELECT COUNT(*) N FROM TBINTCRC WHERE EMPRESA = 1 AND CTA_CONTABIL IS NOT NULL',
          [],
          { teto: 1 },
        );
        return Number(x?.['N']);
      },
    );

  it('a contagem, o que fica sem conta e os totais por conta batem com o lote do M32', async () => {
    const antes = await comConta();
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m54-dourado' };
    const r = await nucleo.desfazendoNaCopia(ctx, async (e0) => {
      // Três convênios com a linha do nível do convênio (sem ato nem subtipo).
      const linhas = await e0.consultar(
        `SELECT FIRST 3 CONV, MIN(TIPO_LANC) TL FROM TBINTCRC
          WHERE EMPRESA = 1 AND COALESCE(TIPO_ATO, 0) = 0 AND COALESCE(SUBTIPO_DIARIA, 0) = 0
          GROUP BY CONV ORDER BY CONV`,
        [],
        { teto: 3 },
      );
      const conv = linhas.slice(0, 3).map((x) => ({ conv: Number(x['CONV']), tl: Number(x['TL']) }));
      if (conv.length < 3) throw new Error('A cópia não tem três convênios no de-para da exportação.');
      const [a, b, c] = conv as [(typeof conv)[0], (typeof conv)[0], (typeof conv)[0]];
      const marcar = (x: { conv: number; tl: number }, cta: number | null) =>
        e0.executar(
          `UPDATE TBINTCRC SET CTA_CONTABIL = ? WHERE EMPRESA = 1 AND CONV = ? AND TIPO_LANC = ?
             AND COALESCE(TIPO_ATO, 0) = 0 AND COALESCE(SUBTIPO_DIARIA, 0) = 0`,
          [cta, x.conv, x.tl],
        );
      await marcar(a, EXP_A);
      await marcar(b, EXP_B);
      await marcar(c, null);
      const lidos = await deParaDaExportacao(e0, 1);
      return { a: a.conv, b: b.conv, c: c.conv, lidos };
    });
    const ctxApl = contextoDeAplicacao(PLANO, r.lidos);
    // A competência sintética: 5 contas fechadas dos três convênios (centavos).
    const contas = [
      { id: 1, convenio: r.a, valor: 125_000 },
      { id: 2, convenio: r.a, valor: 87_550 },
      { id: 3, convenio: r.b, valor: 40_000 },
      { id: 4, convenio: r.b, valor: 12_345 },
      { id: 5, convenio: r.c, valor: 9_900 },
    ];
    const fato = (x: (typeof contas)[number]): FatoContabil => ({
      tabela: 'FCCTAEXT',
      id: x.id,
      tipo: 'receitaConta',
      origem: 3,
      empresa: 1,
      data: '2027-01-20',
      competencia: '2027-01',
      valorCentavos: x.valor,
      centroCusto: null,
      documento: `conta ${x.id}`,
      campos: { convenio: x.convenio },
      impressao: `sint${x.id}`,
      carimbo: null,
      estorno: false,
      referencia: null,
    });
    const resultados = contas.map((x) => contabilizar(fato(x), [REGRA], ctxApl));
    // O lote do M32 com os MESMOS itens lidos: o convênio como evento, a conta lida a débito e a receita a crédito.
    const nivelDoConvenio = new Map<number, number | null>();
    for (const [k, v] of ctxApl.dePara)
      if (k.startsWith('convenio|')) nivelDoConvenio.set(Number(k.slice(9)), v.contaExportacao);
    const dePara: DePara[] = [...nivelDoConvenio].map(([conv, cta]) => ({
      evento: String(conv),
      contaDebito: cta === null ? '' : String(cta),
      contaCredito: cta === null ? '' : String(EXP_RECEITA),
    }));
    const lote = montarLoteContabil(
      contas.map((x) => ({
        data: '2027-01-20',
        evento: String(x.convenio),
        valor: x.valor / 100,
        historico: `Conta ${x.id}`,
        documento: `conta ${x.id}`,
      })),
      dePara,
    );
    const porContaProprio: Record<string, number> = {};
    for (const x of resultados)
      for (const p of x.lancamento?.partidas ?? []) {
        const k = `${p.lado}:${PLANO.find((y) => y.codigo === p.conta)?.contaExportacao}`;
        porContaProprio[k] = (porContaProprio[k] ?? 0) + p.valorCentavos;
      }
    const porContaLote: Record<string, number> = {};
    for (const l of lote.linhas) {
      const [, d, c, v] = l.split(';');
      const centavos = Math.round(Number(v) * 100);
      porContaLote[`D:${d}`] = (porContaLote[`D:${d}`] ?? 0) + centavos;
      porContaLote[`C:${c}`] = (porContaLote[`C:${c}`] ?? 0) + centavos;
    }
    console.log(
      `[${cod}] dourado na cópia: de-para lido ${r.lidos.length} linhas, nível do convênio ${nivelDoConvenio.size}; ` +
        `lançamentos ${resultados.filter((x) => x.situacao === 'contabilizado').length} × lote ${lote.lancamentos}`,
    );
    expect(resultados.map((x) => x.situacao)).toEqual([
      'contabilizado',
      'contabilizado',
      'contabilizado',
      'contabilizado',
      'semConta',
    ]);
    expect(lote.lancamentos).toBe(4);
    expect(lote.semDePara.map((e) => e.documento)).toEqual(['conta 5']);
    // 1.250,00 + 875,50 + 400,00 + 123,45 = 2.648,95 a débito e a crédito, nos dois lados.
    expect([125_000, 87_550, 40_000, 12_345].reduce((s, v) => s + v, 0)).toBe(264_895);
    expect(porContaProprio).toEqual(porContaLote);
    expect(porContaLote).toEqual({
      [`D:${EXP_A}`]: 212_550,
      [`D:${EXP_B}`]: 52_345,
      [`C:${EXP_RECEITA}`]: 264_895,
    });
    expect(await comConta()).toBe(antes);
  }, 600_000);
});
