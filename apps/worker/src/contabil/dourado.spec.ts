// Dourado da fatia F1 do M54 (ficha, seção 10: "contabilizar uma competência e comparar os totais com o lote de
// exportação do M32 da mesma competência, diferença zero ou explicada pela regra"; regra 6 da ficha: a exportação e a
// contabilidade própria usam o MESMO de-para). Na cópia pc o de-para da exportação está sem conta em todas as linhas
// (preparo §6.2): o dourado real fica para quando o escritório preencher o de-para. Aqui, D-DOURADO-541: o mesmo
// de-para SINTÉTICO alimenta o lote do M32 (montarLoteContabil) e o motor da contabilização (contabilizar), sobre a
// mesma competência sintética; os totais, a contagem e o que fica sem conta batem, com as parcelas no teste.
import type { ContaPlano, FatoContabil, RegraContabil } from '@sgh/contratos';
import { chaveDePara, type ContextoAplicacao, contabilizar, type ItemDePara } from '@sgh/dominio-contabil';
import { type DePara, type EventoFinanceiro, montarLoteContabil } from '@sgh/dominio-financeiro';
import { describe, expect, it } from 'vitest';

const conta = (codigo: string, extra: Partial<ContaPlano>): ContaPlano => ({
  empresa: 1,
  codigo,
  nome: `Conta ${codigo}`,
  grupo: 'ativo',
  tipo: 'analitica',
  natureza: 'devedora',
  referencialTipo: 1,
  referencialConta: '1.01',
  contaExportacao: null,
  exigeCentroCusto: false,
  ativa: true,
  ...extra,
});
const PLANO: ContaPlano[] = [
  conta('1.1.2.01.0001', { nome: 'Convênio A a receber', contaExportacao: 1101 }),
  conta('1.1.2.01.0002', { nome: 'Convênio B a receber', contaExportacao: 1102 }),
  conta('3.1.1.01.0001', {
    nome: 'Receita de convênios',
    grupo: 'receita',
    natureza: 'credora',
    contaExportacao: 3101,
  }),
];
// O de-para comum (sintético): convênio → conta do escritório; o convênio 7 está sem conta nos dois lados.
const DEPARA: readonly ItemDePara[] = [
  { chave: '5', contaExportacao: 1101 },
  { chave: '6', contaExportacao: 1102 },
  { chave: '7', contaExportacao: null },
];
const RECEITA_EXPORTACAO = 3101;

const REGRA: RegraContabil = {
  empresa: 1,
  origem: 3,
  tipoFato: 'receitaConta',
  versao: 1,
  nome: 'Receita da conta fechada',
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

// A competência sintética: 5 contas fechadas de três convênios (centavos).
const CONTAS = [
  { id: 1, convenio: 5, valor: 125_000 },
  { id: 2, convenio: 5, valor: 87_550 },
  { id: 3, convenio: 6, valor: 40_000 },
  { id: 4, convenio: 6, valor: 12_345 },
  { id: 5, convenio: 7, valor: 9_900 },
] as const;

const fato = (c: (typeof CONTAS)[number]): FatoContabil => ({
  tabela: 'FCCTAEXT',
  id: c.id,
  tipo: 'receitaConta',
  origem: 3,
  empresa: 1,
  data: '2027-01-20',
  competencia: '2027-01',
  valorCentavos: c.valor,
  centroCusto: null,
  documento: `conta ${c.id}`,
  campos: { convenio: c.convenio },
  impressao: `sint${c.id}`,
  carimbo: null,
  estorno: false,
  referencia: null,
});

describe('dourado: contabilidade própria × lote de exportação do M32, com o mesmo de-para (D-DOURADO-541)', () => {
  const ctx: ContextoAplicacao = {
    plano: PLANO,
    dePara: new Map(DEPARA.map((d) => [d.chave, d])),
    chaveDoCampo: (c, f) => chaveDePara([f.campos[c]]),
  };
  const resultados = CONTAS.map((c) => contabilizar(fato(c), [REGRA], ctx));
  // O lote do M32 sobre os mesmos eventos: a conta de débito do de-para e a receita na contrapartida.
  const eventos: EventoFinanceiro[] = CONTAS.map((c) => ({
    data: '2027-01-20',
    evento: String(c.convenio),
    valor: c.valor / 100,
    historico: `Conta ${c.id}`,
    documento: `conta ${c.id}`,
  }));
  const dePara: DePara[] = DEPARA.map((d) => ({
    evento: d.chave,
    contaDebito: d.contaExportacao === null ? '' : String(d.contaExportacao),
    contaCredito: d.contaExportacao === null ? '' : String(RECEITA_EXPORTACAO),
  }));
  const lote = montarLoteContabil(eventos, dePara);

  it('a mesma contagem: 4 lançamentos nos dois lados, e a mesma conta sem de-para fica de fora nos dois', () => {
    expect(resultados.map((r) => r.situacao)).toEqual([
      'contabilizado',
      'contabilizado',
      'contabilizado',
      'contabilizado',
      'semConta',
    ]);
    expect(lote.lancamentos).toBe(4);
    expect(lote.semDePara.map((e) => e.documento)).toEqual(['conta 5']);
  });

  it('os mesmos totais, com as parcelas: R$ 2.648,95 a débito e a crédito (1.250,00 + 875,50 + 400,00 + 123,45)', () => {
    const lancados = resultados.flatMap((r) => r.lancamento?.partidas ?? []);
    const debitos = lancados.filter((p) => p.lado === 'D').reduce((s, p) => s + p.valorCentavos, 0);
    const creditos = lancados.filter((p) => p.lado === 'C').reduce((s, p) => s + p.valorCentavos, 0);
    expect([125_000, 87_550, 40_000, 12_345].reduce((s, v) => s + v, 0)).toBe(264_895);
    expect(debitos).toBe(264_895);
    expect(creditos).toBe(264_895);
    expect(Math.round(lote.somaDebitos * 100)).toBe(debitos);
    expect(Math.round(lote.somaCreditos * 100)).toBe(creditos);
  });

  it('cada lançamento cai na conta do escritório que o lote exporta (diferença zero por conta)', () => {
    const porContaProprio = new Map<string, number>();
    for (const r of resultados)
      for (const p of r.lancamento?.partidas ?? []) {
        const exp = PLANO.find((c) => c.codigo === p.conta)?.contaExportacao;
        const k = `${p.lado}:${exp}`;
        porContaProprio.set(k, (porContaProprio.get(k) ?? 0) + p.valorCentavos);
      }
    const porContaLote = new Map<string, number>();
    for (const l of lote.linhas) {
      const [, d, c, v] = l.split(';');
      const centavos = Math.round(Number(v) * 100);
      porContaLote.set(`D:${d}`, (porContaLote.get(`D:${d}`) ?? 0) + centavos);
      porContaLote.set(`C:${c}`, (porContaLote.get(`C:${c}`) ?? 0) + centavos);
    }
    expect(Object.fromEntries(porContaProprio)).toEqual(Object.fromEntries(porContaLote));
    expect(Object.fromEntries(porContaLote)).toEqual({
      'D:1101': 212_550,
      'D:1102': 52_345,
      'C:3101': 264_895,
    });
  });
});
