// O HTML do relatório de custos (vai ao PDF/A): a marca de completude, a conservação com as parcelas, os centros com os
// rateios recebidos pelo nome de quem repartiu, as pendências, o escape do texto e nenhum dado de paciente. SINTÉTICO.
import type { ApuracaoCustos, LinhaApuracaoCentro } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { htmlRelatorioCustos, reaisDeCentavos } from './relatorio-custos.js';

const linha = (x: Partial<LinhaApuracaoCentro> & Pick<LinhaApuracaoCentro, 'centro' | 'codigo' | 'nome'>) =>
  ({
    classe: 'produtivo',
    ordemRateio: null,
    criterio: null,
    direto: { pessoal: 0, materiais: 0, despesas: 0 },
    despesasGerais: 0,
    diretoTotal: 0,
    recebidos: [],
    recebidoTotal: 0,
    repassado: 0,
    naoRateado: 0,
    custoFinal: 0,
    baseCriterioCent: null,
    producao: null,
    custoUnitario: null,
    receita: 0,
    ...x,
  }) as LinhaApuracaoCentro;

const apuracao: ApuracaoCustos = {
  id: 7,
  competencia: '2026-03',
  situacao: 'aprovada',
  versao: 2,
  completude: {
    fontes: [
      { fonte: 'estoque', presente: true, detalhe: '12 saídas' },
      { fonte: 'pessoal', presente: false, detalhe: 'sem folha' },
    ],
    parcial: true,
    rotulo: 'parcial (sem pessoal)',
  },
  limiteLinhaSaida: 10_000_000,
  totais: {
    direto: { pessoal: 0, materiais: 90_000, despesas: 10_000 },
    despesasSemCentro: 5_000,
    diretoTotal: 105_000,
    custoFinalProdutivos: 100_000,
    naoRateado: 4_000,
    despesasNaoDistribuidas: 1_000,
    foraDoCusteio: 0,
    atipicas: { linhas: 1, centavos: 50_000_000 },
    custoNasContas: 100_000,
    custoSemConta: 0,
    receitaBruta: 200_000,
    receitaLiquida: 190_000,
    contas: 3,
  },
  linhas: [
    linha({
      centro: 1,
      codigo: 10,
      nome: 'Lavanderia <A&B>',
      classe: 'auxiliar',
      direto: { pessoal: 0, materiais: 30_000, despesas: 0 },
      repassado: 26_000,
      naoRateado: 4_000,
      custoFinal: 4_000,
    }),
    linha({
      centro: 2,
      codigo: 20,
      nome: 'Internação',
      direto: { pessoal: 0, materiais: 60_000, despesas: 10_000 },
      despesasGerais: 4_000,
      recebidos: [{ de: 1, centavos: 26_000 }],
      recebidoTotal: 26_000,
      custoFinal: 100_000,
      producao: { codigo: 'pacienteDia', quantidadeCent: 1_250 },
      custoUnitario: 8_000,
    }),
  ] as never,
  pendencias: [
    {
      tipo: 'linhas-atipicas',
      bloqueia: false,
      centros: [2],
      centavos: 50_000_000,
      mensagem: '1 linha de saída atípica fora do custo direto.',
    },
  ],
  impressao: 'a'.repeat(64),
  justificativa: null,
  apuradaPor: 'SINT.CUSTOS',
  apuradaEm: '2026-04-02T10:00:00Z',
  aprovadaPor: 'SINT.CUSTOS.CONTROLLER',
  aprovadaEm: '2026-04-03T10:00:00Z',
  duracaoMs: 120,
};

describe('relatório de custos (HTML do PDF/A)', () => {
  it('reais de centavos, com o sinal e o milhar', () => {
    expect(reaisDeCentavos(123_456_789)).toBe('R$ 1.234.567,89');
    expect(reaisDeCentavos(5)).toBe('R$ 0,05');
    expect(reaisDeCentavos(-1_000)).toBe('−R$ 10,00');
  });

  it('a completude, a conservação com as parcelas, os centros, as pendências; texto escapado e sem paciente', () => {
    const h = htmlRelatorioCustos(apuracao);
    expect(h).toMatch(/^<!doctype html><html lang="pt-BR">/);
    expect(h).toContain('<title>Relatório de custos 2026-03</title>');
    expect(h).toContain('Aprovada · versão 2 · Custeio parcial (sem pessoal)');
    expect(h).toContain('pessoal: ausente (sem folha)');
    // 0 + 900 + 100 + 50 = 1.050 lidos; 1.000 + 40 + 10 = 1.050 de destino.
    expect(h).toContain(
      'Custo direto lido: R$ 0,00 + R$ 900,00 + R$ 100,00 + R$ 50,00 (despesas sem centro) = R$ 1.050,00.',
    );
    expect(h).toContain(
      'R$ 1.000,00 (custo final dos produtivos) + R$ 40,00 (não rateado) + R$ 10,00 (despesas não distribuídas) = R$ 1.050,00.',
    );
    expect(h).toContain('Lavanderia &lt;A&amp;B&gt;');
    expect(h).toContain('10 Lavanderia &lt;A&amp;B&gt;: R$ 260,00');
    expect(h).toContain('12,5 paciente-dia');
    expect(h).toContain('R$ 80,00');
    expect(h).toContain('Soma do custo final dos centros</td><td class="v">R$ 1.040,00');
    expect(h).toContain('1 linha(s), R$ 500.000,00');
    expect(h).toContain(
      '1 linha de saída atípica fora do custo direto. (R$ 500.000,00) · centros: 20 Internação',
    );
    expect(h).toContain('aprovada por SINT.CUSTOS.CONTROLLER');
    expect(h).not.toMatch(/paciente(?!-dia)/i);
    expect(h).not.toMatch(/prontu[aá]rio/i);
    // A apuração gravada antes das devoluções lê-se como zero.
    expect(h).toContain('devoluções ao estoque descontadas dos materiais: 0 linha(s), R$ 0,00</p>');
  });

  it('as devoluções do mês impressas, e as das saídas atípicas à parte', () => {
    const h = htmlRelatorioCustos({
      ...apuracao,
      totais: {
        ...apuracao.totais,
        devolucoes: { linhas: 3, centavos: 12_345, linhasAtipicas: 1, centavosAtipicas: 20_000_000 },
      },
    });
    expect(h).toContain(
      'devoluções ao estoque descontadas dos materiais: 3 linha(s), R$ 123,45 (mais 1 de saídas atípicas, R$ 200.000,00, fora como a saída)',
    );
  });

  it('sem pendências e completa', () => {
    const h = htmlRelatorioCustos({
      ...apuracao,
      situacao: 'apurada',
      aprovadaPor: null,
      aprovadaEm: null,
      justificativa: 'Refeita após conferir a roupa.',
      pendencias: [],
      completude: { fontes: [], parcial: false, rotulo: null },
    });
    expect(h).toContain('Custeio completo');
    expect(h).toContain('Nenhuma pendência.');
    expect(h).toContain('justificativa: Refeita após conferir a roupa.');
    expect(h).not.toContain('aprovada por');
  });
});
