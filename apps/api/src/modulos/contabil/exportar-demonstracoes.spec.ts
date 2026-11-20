// A tabela da exportação das demonstrações (M54.3): colunas, linhas com as parcelas, o total e a conferência; o HTML do
// PDF/A autocontido e escapado; a planilha com o total antes das notas. Dados SINTÉTICOS.
import type { Balancete, Balanco, Diario, Dre } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { htmlDaDemonstracao, tabelaDaDemonstracao, xlsxDaDemonstracao } from './exportar-demonstracoes.js';

const balancete: Balancete = {
  empresa: 1,
  de: '2025-01',
  ate: '2025-12',
  nivel: null,
  centroCusto: null,
  linhas: [
    {
      codigo: '1',
      nome: 'Ativo',
      nivel: 1,
      tipo: 'sintetica',
      grupo: 'ativo',
      natureza: 'devedora',
      saldoAnteriorCentavos: 0,
      debitosCentavos: 100_000,
      creditosCentavos: 30_000,
      saldoFinalCentavos: 70_000,
      foraDoPlano: false,
    },
    {
      codigo: '1.1.2.01.0001',
      nome: 'Clientes <convênio>',
      nivel: 5,
      tipo: 'analitica',
      grupo: 'ativo',
      natureza: 'devedora',
      saldoAnteriorCentavos: 0,
      debitosCentavos: 100_000,
      creditosCentavos: 30_000,
      saldoFinalCentavos: 70_000,
      foraDoPlano: false,
    },
    {
      codigo: '3.1.1.01.0001',
      nome: 'Receita',
      nivel: 5,
      tipo: 'analitica',
      grupo: 'receita',
      natureza: 'credora',
      saldoAnteriorCentavos: 0,
      debitosCentavos: 0,
      creditosCentavos: 70_000,
      saldoFinalCentavos: -70_000,
      foraDoPlano: true,
    },
  ],
  totais: {
    saldoAnteriorDevedorCentavos: 0,
    saldoAnteriorCredorCentavos: 0,
    debitosCentavos: 100_000,
    creditosCentavos: 100_000,
    saldoFinalDevedorCentavos: 70_000,
    saldoFinalCredorCentavos: 70_000,
  },
  equilibrado: true,
  conferencia: ['Débitos 1.000,00 = créditos 1.000,00'],
  competenciasAbertas: ['2025-12'],
};

const diario: Diario = {
  empresa: 1,
  de: '2025-03-01',
  ate: '2025-03-31',
  lancamentos: [
    {
      id: 7,
      data: '2025-03-10',
      tipo: 'manual',
      tipoRotulo: 'Manual',
      historico: 'Lançamento sintético',
      debitosCentavos: 100_000,
      creditosCentavos: 100_000,
      estornaId: null,
      partidas: [
        {
          lado: 'D',
          conta: '1.1.2.01.0001',
          contaNome: 'Clientes',
          valorCentavos: 100_000,
          centroCusto: null,
          historico: 'Lançamento sintético',
        },
        {
          lado: 'C',
          conta: '3.1.1.01.0001',
          contaNome: 'Receita',
          valorCentavos: 100_000,
          centroCusto: 12,
          historico: 'outro histórico',
        },
      ],
    },
  ],
  totais: { lancamentos: 1, debitosCentavos: 100_000, creditosCentavos: 100_000 },
  parcelas: [{ tipo: 'manual', lancamentos: 1, debitosCentavos: 100_000 }],
  conferencia: 'Débitos = créditos',
  pagina: 1,
  parcial: false,
};

const dre: Dre = {
  empresa: 1,
  de: '2025-01',
  ate: '2025-12',
  linhas: [
    {
      chave: 'receitaBruta',
      rotulo: 'Receita bruta',
      valorCentavos: 100_000,
      total: false,
      parcelas: [{ codigo: '3.1', nome: 'Receita de serviços', valorCentavos: 100_000 }],
    },
    { chave: 'resultado', rotulo: 'Resultado', valorCentavos: 70_000, total: true, parcelas: [] },
  ],
  resultadoCentavos: 70_000,
  rotuloResultado: 'Superávit',
  conferencia: '1.000,00 − 300,00 = 700,00',
};

const balanco: Balanco = {
  empresa: 1,
  competencia: '2025-12',
  data: '2025-12-31',
  ativo: {
    rotulo: 'Ativo',
    totalCentavos: 70_000,
    parcelas: [{ codigo: '1.1', nome: 'Circulante', valorCentavos: 70_000 }],
  },
  passivo: { rotulo: 'Passivo', totalCentavos: 0, parcelas: [] },
  patrimonioLiquido: { rotulo: 'Patrimônio líquido', totalCentavos: 0, parcelas: [] },
  resultadoExercicioCentavos: 70_000,
  resultadoAnterioresCentavos: -5,
  totalAtivoCentavos: 70_000,
  totalPassivoPlCentavos: 70_000,
  compensacao: { rotulo: 'Compensação', totalCentavos: 1, parcelas: [] },
  equilibrado: false,
  conferencia: 'Ativo 700,00 = passivo + PL 700,00',
};

/** O XML da aba (o ZIP é armazenado, sem compressão). */
function abaDa(x: Uint8Array): string {
  const t = Buffer.from(x).toString('utf8');
  const i = t.indexOf('<worksheet');
  expect(i).toBeGreaterThan(0);
  return t.slice(i, t.indexOf('</worksheet>', i) + 12);
}

describe('exportação das demonstrações', () => {
  it('balancete: o sinal devedor na legenda, as sintéticas em destaque, o total e a conferência', () => {
    const t = tabelaDaDemonstracao({ tipo: 'balancete', dado: balancete });
    expect(t.colunas.map((c) => c.campo)).toEqual([
      'codigo',
      'nome',
      'tipo',
      'saldoAnterior',
      'debitos',
      'creditos',
      'saldoFinal',
    ]);
    expect(t.linhas[1]).toMatchObject({ nome: '        Clientes <convênio>', tipo: 'A', saldoFinal: 700 });
    expect(t.linhas[2]!['nome']).toContain('(fora do plano)');
    expect([...t.destaques]).toEqual([0]);
    expect(t.totais).toEqual({ saldoAnterior: 0, debitos: 1000, creditos: 1000, saldoFinal: 0 });
    expect(t.conferencia).toContain('Equilibrado.');
    expect(t.conferencia.at(-1)).toContain('12/2025');
    expect(t.arquivo).toBe('balancete-1-2025-01-a-2025-12');
    const h = htmlDaDemonstracao(t, {
      emitidoPor: 'SINT.CONTADOR',
      emitidoEm: new Date('2026-01-02T03:04:00Z'),
    });
    expect(h).toContain('Clientes &lt;convênio&gt;');
    expect(h).toContain('1.000,00');
    expect(h).toContain('-700,00');
    expect(h).toContain('2026-01-02 03:04');
    expect(h).not.toMatch(/<script|<link|https?:\/\//);
    const x = abaDa(xlsxDaDemonstracao(t));
    expect(x.indexOf('>Total<')).toBeLessThan(x.indexOf('Equilibrado.'));
    expect(x).toContain('<v>1000</v>');
  });

  it('balancete com centro de custo e desequilibrado: os avisos', () => {
    const a = tabelaDaDemonstracao({
      tipo: 'balancete',
      dado: { ...balancete, equilibrado: null, centroCusto: 9, nivel: 2 },
    });
    expect(a.subtitulo).toContain('centro de custo 9');
    expect(a.subtitulo).toContain('nível 2');
    expect(a.conferencia.join(' ')).toContain('sem a conferência do equilíbrio');
    const b = tabelaDaDemonstracao({
      tipo: 'balancete',
      dado: { ...balancete, equilibrado: false, competenciasAbertas: [] },
    });
    expect(b.conferencia.join(' ')).toContain('DESEQUILIBRADO');
  });

  it('diário: o lançamento seguido das partidas, débito e crédito em colunas, as parcelas por tipo', () => {
    const t = tabelaDaDemonstracao({
      tipo: 'diario',
      dado: { ...diario, lancamentos: [{ ...diario.lancamentos[0]!, estornaId: 3 }] },
    });
    expect(t.linhas).toHaveLength(3);
    expect(t.linhas[0]).toMatchObject({ data: '10/03/2025', lancamento: 7, debito: 1000 });
    expect(t.linhas[0]!['nome']).toContain('estorna o 3');
    expect(t.linhas[1]).toMatchObject({
      conta: '1.1.2.01.0001',
      debito: 1000,
      credito: null,
      nome: 'Clientes',
    });
    expect(t.linhas[2]).toMatchObject({
      credito: 1000,
      debito: null,
      centro: 12,
      nome: 'Receita · outro histórico',
    });
    expect([...t.destaques]).toEqual([0]);
    expect(t.totais).toEqual({ debito: 1000, credito: 1000 });
    expect(t.conferencia[0]).toContain('manual: 1 lançamento(s), 1.000,00');
  });

  it('DRE e balanço: as parcelas recuadas, os totais em destaque, o resultado não apurado', () => {
    const d = tabelaDaDemonstracao({ tipo: 'dre', dado: dre });
    expect(d.linhas.map((l) => l['descricao'])).toEqual([
      'Receita bruta',
      '  Receita de serviços',
      'Resultado',
    ]);
    expect([...d.destaques]).toEqual([2]);
    expect(d.conferencia[0]).toBe('Superávit: 700,00.');
    const b = tabelaDaDemonstracao({ tipo: 'balanco', dado: balanco });
    const desc = b.linhas.map((l) => l['descricao']);
    expect(desc).toContain('  Resultado do exercício (não apurado)');
    expect(desc).toContain('  Resultado de exercícios anteriores (não apurado)');
    expect(desc).toContain('Compensação');
    expect(desc.at(-1)).toBe('Compensação');
    expect(b.conferencia).toContain('DESEQUILIBRADO: ativo diferente do passivo + PL.');
    expect(b.arquivo).toBe('balanco-1-2025-12');
    const semCompensacao = tabelaDaDemonstracao({
      tipo: 'balanco',
      dado: {
        ...balanco,
        compensacao: null,
        resultadoAnterioresCentavos: 0,
        resultadoExercicioCentavos: 0,
        equilibrado: true,
      },
    });
    expect(semCompensacao.linhas.map((l) => l['descricao']).at(-1)).toBe(
      'Total do passivo e do patrimônio líquido',
    );
    expect(semCompensacao.conferencia).toContain('Equilibrado.');
    const x = abaDa(xlsxDaDemonstracao(semCompensacao));
    expect(x).not.toContain('>Total<');
  });
});
