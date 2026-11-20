// Demonstrações (M54-F3; regra 5): balancete com as parcelas, DRE, balanço e a apuração, sobre um plano sintético.
import { describe, expect, it } from 'vitest';
import {
  aglutinacaoDe,
  chaveApuracao,
  conferenciaDoDiario,
  dataDaApuracao,
  montarBalancete,
  montarBalanco,
  montarDre,
  planoDaApuracao,
  reaisBr,
  type SomaConta,
} from './demonstracoes.js';
import { c, MOVIMENTO, PLANO } from './demonstracoes.spec-util.js';

describe('balancete', () => {
  it('soma as analíticas nas sintéticas; os totais só das analíticas, com débitos = créditos (as parcelas)', () => {
    const b = montarBalancete(PLANO, [], MOVIMENTO, { nivel: null, incluirZeradas: false, filtrado: false });
    const l = (k: string) => b.linhas.find((x) => x.codigo === k)!;
    expect(l('1').debitosCentavos).toBe(60_000);
    expect(l('1').creditosCentavos).toBe(10_000);
    expect(l('1').saldoFinalCentavos).toBe(50_000);
    expect(l('4.1').saldoFinalCentavos).toBe(-48_000);
    expect(b.totais.debitosCentavos).toBe(85_000);
    expect(b.totais.creditosCentavos).toBe(85_000);
    expect(b.totais.saldoFinalDevedorCentavos).toBe(2_000 + 48_000 + 2_000 + 15_000 + 8_000);
    expect(b.totais.saldoFinalCredorCentavos).toBe(10_000 + 50_000 + 15_000);
    expect(b.equilibrado).toBe(true);
    expect(b.conferencia[0]).toBe('Débitos 850,00 = créditos 850,00 (soma das contas analíticas)');
    // Sem as zeradas: o superávit acumulado não aparece.
    expect(b.linhas.some((x) => x.codigo === '3.1.02')).toBe(false);
    expect(b.linhas.map((x) => x.codigo).slice(0, 4)).toEqual(['1', '1.1', '1.1.01', '1.1.02']);
  });

  it('nível, zeradas, saldo anterior, conta fora do plano e o filtro de centro de custo', () => {
    const ant: SomaConta[] = [
      { conta: '1.1.01', debitos: 1_000, creditos: 0 },
      { conta: '3.1.01', debitos: 0, creditos: 1_000 },
    ];
    const b = montarBalancete(PLANO, ant, [{ conta: '9.9.99', debitos: 5, creditos: 5 }], {
      nivel: 2,
      incluirZeradas: true,
      filtrado: false,
    });
    expect(b.linhas.every((x) => x.nivel <= 2)).toBe(true);
    expect(b.linhas.find((x) => x.codigo === '1')!.saldoAnteriorCentavos).toBe(1_000);
    expect(b.linhas.find((x) => x.codigo === '5')!.saldoFinalCentavos).toBe(0);
    expect(b.totais.saldoAnteriorDevedorCentavos).toBe(1_000);
    expect(b.totais.saldoAnteriorCredorCentavos).toBe(1_000);
    const todas = montarBalancete(PLANO, [], [{ conta: '9.9.99', debitos: 5, creditos: 0 }], {
      nivel: null,
      incluirZeradas: false,
      filtrado: true,
    });
    expect(todas.linhas[0]).toMatchObject({
      codigo: '9.9.99',
      foraDoPlano: true,
      nome: 'Conta fora do plano',
    });
    expect(todas.equilibrado).toBeNull();
    expect(todas.conferencia.at(-1)).toContain('centro de custo');
  });
});

describe('DRE', () => {
  it('receita bruta, deduções (redutora), custos e despesas, com as parcelas na aglutinação de nível 2', () => {
    const d = montarDre(PLANO, MOVIMENTO);
    const v = Object.fromEntries(d.linhas.map((l) => [l.chave, l.valorCentavos]));
    expect(v).toEqual({
      receitaBruta: 50_000,
      deducoes: -2_000,
      receitaLiquida: 48_000,
      custos: -15_000,
      resultadoBruto: 33_000,
      despesas: -8_000,
      resultado: 25_000,
    });
    expect(d.rotuloResultado).toBe('Superávit do período');
    expect(d.linhas[0]!.parcelas).toEqual([
      { codigo: '4.1', nome: 'Receita de serviços', valorCentavos: 50_000 },
    ]);
    expect(d.conferencia).toBe(
      '500,00 (receita bruta) − 20,00 (deduções) − 150,00 (custos) − 80,00 (despesas) = 250,00',
    );
    const deficit = montarDre(PLANO, [{ conta: '6.1.01', debitos: 100, creditos: 0 }]);
    expect(deficit.resultadoCentavos).toBe(-100);
    expect(deficit.rotuloResultado).toBe('Déficit do período');
  });
});

describe('balanço', () => {
  it('ativo = passivo + PL + resultado do exercício; o anterior não apurado separado', () => {
    const b = montarBalanco(PLANO, MOVIMENTO, MOVIMENTO);
    expect(b.totalAtivoCentavos).toBe(50_000);
    expect(b.passivo.totalCentavos).toBe(15_000);
    expect(b.patrimonioLiquido.totalCentavos).toBe(10_000);
    expect(b.resultadoExercicioCentavos).toBe(25_000);
    expect(b.resultadoAnterioresCentavos).toBe(0);
    expect(b.totalPassivoPlCentavos).toBe(50_000);
    expect(b.equilibrado).toBe(true);
    expect(b.compensacao).toBeNull();
    expect(b.ativo.parcelas).toEqual([{ codigo: '1.1', nome: 'Ativo circulante', valorCentavos: 50_000 }]);
    expect(b.conferencia).toContain('Ativo 500,00 = passivo 150,00 + patrimônio líquido 100,00');
    // Exercício seguinte sem apuração: o resultado de antes vira "anteriores".
    const seguinte = montarBalanco(PLANO, MOVIMENTO, []);
    expect(seguinte.resultadoAnterioresCentavos).toBe(25_000);
    expect(seguinte.equilibrado).toBe(true);
  });

  it('compensação com saldo aparece e entra na conferência', () => {
    const plano = [
      ...PLANO,
      c('9', 'Compensação', 'compensacao'),
      c('9.1.01', 'Bens de terceiros', 'compensacao'),
    ];
    const b = montarBalanco(plano, [...MOVIMENTO, { conta: '9.1.01', debitos: 10, creditos: 0 }], []);
    expect(b.compensacao!.totalCentavos).toBe(10);
    expect(b.equilibrado).toBe(false);
    expect(b.conferencia).toContain('compensação');
  });
});

describe('apuração do resultado', () => {
  const base = {
    exercicio: 2027,
    plano: PLANO,
    saldos: [
      ...MOVIMENTO.map((m) => ({ ...m, centroCusto: null })),
      { conta: '5.1.01', debitos: 300, creditos: 0, centroCusto: 7 },
    ],
    contaDestino: '3.1.02',
    hoje: '2028-01-10',
    dezembroEncerrado: false,
    apuracaoAtiva: null,
  };

  it('zera as contas de resultado por centro de custo e leva o resultado ao PL; débitos = créditos', () => {
    const p = planoDaApuracao(base);
    expect(p.impedimentos).toEqual([]);
    expect(p.resultado).toBe(25_000 - 300);
    expect(p.conferencia).toBe('480,00 (receitas) − 153,00 (custos) − 80,00 (despesas) = 247,00 (superávit)');
    const d = p.partidas.filter((x) => x.lado === 'D').reduce((s, x) => s + x.valorCentavos, 0);
    const cr = p.partidas.filter((x) => x.lado === 'C').reduce((s, x) => s + x.valorCentavos, 0);
    expect(d).toBe(cr);
    expect(p.partidas.find((x) => x.conta === '5.1.01' && x.centroCusto === 7)).toMatchObject({
      lado: 'C',
      valorCentavos: 300,
    });
    expect(p.partidas.at(-1)).toMatchObject({ conta: '3.1.02', lado: 'C', valorCentavos: 24_700 });
    // Só as de resultado entram (o caixa não).
    expect(p.partidas.some((x) => x.conta === '1.1.01')).toBe(false);
  });

  it('déficit debita o PL; os impedimentos', () => {
    const def = planoDaApuracao({
      ...base,
      saldos: [{ conta: '6.1.01', debitos: 100, creditos: 0, centroCusto: null }],
    });
    expect(def.partidas.at(-1)).toMatchObject({ conta: '3.1.02', lado: 'D', valorCentavos: 100 });
    const ruim = planoDaApuracao({
      ...base,
      saldos: [],
      contaDestino: '1.1.01',
      hoje: '2027-12-30',
      dezembroEncerrado: true,
      apuracaoAtiva: 41,
    });
    expect(ruim.impedimentos.map((i) => i.codigo)).toEqual([
      'destino-invalido',
      'ja-apurado',
      'dezembro-encerrado',
      'exercicio-em-curso',
      'sem-saldo',
    ]);
    expect(planoDaApuracao({ ...base, contaDestino: '3.9.99' }).impedimentos[0]!.codigo).toBe(
      'destino-inexistente',
    );
    expect(planoDaApuracao({ ...base, contaDestino: null }).partidas.some((x) => x.conta === '3.1.02')).toBe(
      false,
    );
  });

  it('chave, data, aglutinação, valores e a conferência do diário', () => {
    expect(chaveApuracao(1, 2027, 2)).toBe('apuracao:1:2027:2');
    expect(dataDaApuracao(2027)).toBe('2027-12-31');
    expect(aglutinacaoDe('1.1.2.01.0001')).toBe('1.1');
    expect(aglutinacaoDe('1')).toBe('1');
    expect(reaisBr(-123_456_78)).toBe('-123.456,78');
    expect(
      conferenciaDoDiario(
        [
          { tipo: 'manual', lancamentos: 2, debitosCentavos: 500 },
          { tipo: 'automatico', lancamentos: 1, debitosCentavos: 100 },
        ],
        { lancamentos: 3, debitosCentavos: 600, creditosCentavos: 600 },
      ),
    ).toBe('5,00 (manual, 2) + 1,00 (automatico, 1) = débitos 6,00 = créditos 6,00 em 3 lançamento(s)');
    expect(conferenciaDoDiario([], { lancamentos: 0, debitosCentavos: 0, creditosCentavos: 1 })).toContain(
      '≠',
    );
  });
});
