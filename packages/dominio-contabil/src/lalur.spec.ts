// F7, 07-FIN linha 115 (C3-023): as regras do LALUR/LACS e da apuração do IRPJ e da CSLL. Massa sintética, centavos.
import { describe, expect, it } from 'vitest';
import {
  apurarLucroReal,
  conferirAcaoApuracao,
  conferirAjusteLalur,
  conferirLancamentoParteB,
  conferirPeriodoApuracao,
  type EntradaLucroReal,
  ladoParteB,
  mesesDoPeriodo,
  partidasEstornoProvisao,
  partidasProvisaoIrpjCsll,
  registrosBlocoMEcf,
  saldoParteB,
} from './lalur.js';

const base: EntradaLucroReal = {
  forma: 'trimestral',
  inicio: '2198-01-01',
  fim: '2198-03-31',
  lucroAntesCentavos: 100_000_00,
  ajustes: [
    { tipo: 'adicao', valorCentavos: 20_000_00, irpj: true, csll: true },
    { tipo: 'adicao', valorCentavos: 5_000_00, irpj: true, csll: false },
    { tipo: 'exclusao', valorCentavos: 10_000_00, irpj: true, csll: true },
  ],
  saldoPrejuizoCentavos: null,
  saldoBaseNegativaCentavos: null,
  aliquotaIrpj: 15,
  aliquotaAdicional: 10,
  limiteAdicionalMensalCentavos: 20_000_00,
  aliquotaCsll: 9,
  deducoesIrpjCentavos: 0,
  deducoesCsllCentavos: 0,
};

describe('LALUR e apuração do lucro real', () => {
  it('período da forma: trimestre civil, ano civil e mês inteiro', () => {
    expect(conferirPeriodoApuracao('trimestral', '2198-01-01', '2198-03-31')).toBeNull();
    expect(conferirPeriodoApuracao('trimestral', '2198-02-01', '2198-04-30')?.codigo).toBe(
      'periodo-invalido',
    );
    expect(conferirPeriodoApuracao('anual', '2198-01-01', '2198-12-31')).toBeNull();
    expect(conferirPeriodoApuracao('estimativa_mensal', '2198-02-01', '2198-02-28')).toBeNull();
    expect(conferirPeriodoApuracao('estimativa_mensal', '2198-02-01', '2198-03-31')?.codigo).toBe(
      'periodo-invalido',
    );
    expect(conferirPeriodoApuracao('presumido', '2198-01-01', '2198-03-31')?.codigo).toBe('forma-invalida');
    expect(mesesDoPeriodo('2198-01-01', '2198-12-31')).toBe(12);
  });

  it('IRPJ com adicional sobre o que passa de 20 mil x meses e CSLL a 9%, com a memória impressa', () => {
    const r = apurarLucroReal(base);
    expect(r.ajustadoIrpj).toBe(115_000_00);
    expect(r.ajustadoCsll).toBe(110_000_00);
    expect(r.irpj).toBe(17_250_00);
    expect(r.limiteAdicional).toBe(60_000_00);
    expect(r.adicional).toBe(5_500_00);
    expect(r.csll).toBe(9_900_00);
    expect(r.irpjRecolher).toBe(22_750_00);
    expect(r.memoria.join('\n')).toContain('115.000,00 × 15% = 17.250,00');
  });

  it('estimativa mensal pela receita bruta: presunção de 8% e 12% mais as demais receitas, sem exclusões', () => {
    const r = apurarLucroReal({
      ...base,
      forma: 'estimativa_mensal',
      inicio: '2198-03-01',
      fim: '2198-03-31',
      receitaBrutaCentavos: 1_000_000_00,
    });
    expect(r.baseEstimativa).toBe('receita_bruta');
    expect(r.baseIrpj).toBe(105_000_00);
    expect(r.limiteAdicional).toBe(20_000_00);
    expect(r.irpjRecolher).toBe(15_750_00 + 8_500_00);
    expect(r.baseCsll).toBe(140_000_00);
    expect(r.csllRecolher).toBe(12_600_00);
    expect(r.memoria.join('\n')).toContain(
      '1.000.000,00 × 8% (80.000,00) + demais receitas 25.000,00 = 105.000,00',
    );
  });

  it('balancete de suspensão ou redução: acumulado desde janeiro menos o devido nos meses anteriores', () => {
    const bal = {
      ...base,
      forma: 'estimativa_mensal' as const,
      inicio: '2198-03-01',
      fim: '2198-03-31',
      baseEstimativa: 'balancete' as const,
      estimativasAnterioresIrpjCentavos: 20_000_00,
      estimativasAnterioresCsllCentavos: 9_900_00,
    };
    const r = apurarLucroReal(bal);
    expect(r.meses).toBe(3);
    expect(r.limiteAdicional).toBe(60_000_00);
    expect(r.irpjRecolher).toBe(2_750_00);
    expect(r.csllRecolher).toBe(0);
    expect(r.balancete).toBe('reducao');
    expect(r.prejuizoDoPeriodo).toBe(0);
    const s = apurarLucroReal({ ...bal, estimativasAnterioresIrpjCentavos: 30_000_00 });
    expect([s.irpjRecolher, s.balancete]).toEqual([0, 'suspensao']);
    expect(s.memoria.join('\n')).toContain('devido nos meses anteriores 30.000,00');
  });

  it('compensação do prejuízo e da base negativa limitada a 30% e ao saldo; deduções sem negativo', () => {
    const r = apurarLucroReal({
      ...base,
      saldoPrejuizoCentavos: 50_000_00,
      saldoBaseNegativaCentavos: 10_000_00,
      deducoesCsllCentavos: 99_000_00,
    });
    expect(r.compensacaoPrejuizo).toBe(34_500_00);
    expect(r.baseIrpj).toBe(80_500_00);
    expect(r.compensacaoBaseNegativa).toBe(10_000_00);
    expect(r.baseCsll).toBe(100_000_00);
    expect(r.csllRecolher).toBe(0);
  });

  it('prejuízo do período: base zero, sem compensação, prejuízo e base negativa a constituir', () => {
    const r = apurarLucroReal({ ...base, lucroAntesCentavos: -30_000_00, saldoPrejuizoCentavos: 9_000_00 });
    expect(r.baseIrpj).toBe(0);
    expect(r.compensacaoPrejuizo).toBe(0);
    expect(r.prejuizoDoPeriodo).toBe(15_000_00);
    expect(r.baseNegativaDoPeriodo).toBe(20_000_00);
    expect(r.irpjRecolher + r.csllRecolher).toBe(0);
  });

  it('ajuste manual: tipo, descrição, valor, tributo, data no período e número do processo', () => {
    const p = { inicio: '2198-01-01', fim: '2198-03-31' };
    const a = {
      tipo: 'adicao',
      descricao: 'Multa indedutível',
      data: '2198-03-31',
      valorCentavos: 100,
      irpj: true,
      csll: true,
      indicadorProcesso: null,
      numeroProcesso: null,
      parteB: null,
    } as const;
    expect(conferirAjusteLalur(a, p)).toBeNull();
    expect(conferirAjusteLalur({ ...a, tipo: 'compensacao_prejuizo' }, p)?.codigo).toBe('tipo-invalido');
    expect(conferirAjusteLalur({ ...a, valorCentavos: 0 }, p)?.codigo).toBe('valor-invalido');
    expect(conferirAjusteLalur({ ...a, irpj: false, csll: false }, p)?.codigo).toBe('sem-tributo');
    expect(conferirAjusteLalur({ ...a, data: '2198-04-01' }, p)?.codigo).toBe('data-fora-do-periodo');
    expect(conferirAjusteLalur({ ...a, indicadorProcesso: 'judicial' }, p)?.codigo).toBe(
      'processo-sem-numero',
    );
  });

  it('parte B: lado pela natureza, baixa limitada ao saldo, tributo da conta e saldo final', () => {
    expect(ladoParteB('devedor', 'constitui')).toBe('debito');
    expect(ladoParteB('credor', 'baixa')).toBe('debito');
    const conta = { id: 1, codigo: 'PF', tributo: 'irpj', natureza: 'devedor', saldoCentavos: 500 } as const;
    expect(conferirLancamentoParteB(conta, 'baixa', 600, { irpj: true, csll: false })?.codigo).toBe(
      'baixa-acima-do-saldo',
    );
    expect(conferirLancamentoParteB(conta, 'constitui', 600, { irpj: false, csll: true })?.codigo).toBe(
      'tributo-da-conta',
    );
    expect(
      saldoParteB('devedor', 500, [
        { natureza: 'debito', valorCentavos: 300 },
        { natureza: 'credito', valorCentavos: 100 },
      ]),
    ).toBe(700);
  });

  it('ciclo: ajustes até a provisão; provisão só da apurada; fechamento depois da provisão ou sem tributo', () => {
    expect(conferirAcaoApuracao('apurada', 'ajustar')).toBeNull();
    expect(conferirAcaoApuracao('provisionada', 'apurar')?.codigo).toBe('apuracao-travada');
    expect(conferirAcaoApuracao('aberta', 'provisionar')?.codigo).toBe('apuracao-nao-apurada');
    expect(conferirAcaoApuracao('apurada', 'fechar', 100)?.codigo).toBe('apuracao-sem-provisao');
    expect(conferirAcaoApuracao('apurada', 'fechar', 0)).toBeNull();
    expect(conferirAcaoApuracao('provisionada', 'fechar', 100)).toBeNull();
    expect(conferirAcaoApuracao('provisionada', 'estornar')).toBeNull();
    expect(conferirAcaoApuracao('apurada', 'estornar')?.codigo).toBe('apuracao-nao-provisionada');
    expect(conferirAcaoApuracao('fechada', 'estornar')?.codigo).toBe('apuracao-nao-provisionada');
  });

  it('provisão: despesa contra o tributo a recolher; bloco M com M010, M300, M350, M410 e M500', () => {
    const p = partidasProvisaoIrpjCsll(
      { irpjDebito: '5.9.1', irpjCredito: '2.1.9', csllDebito: '5.9.2', csllCredito: '2.1.8' },
      { irpjCentavos: 1000, csllCentavos: 0 },
      '1º tri',
    );
    expect(p.map((x) => `${x.lado}${x.conta}${x.valorCentavos}`)).toEqual(['D5.9.11000', 'C2.1.91000']);
    const e = partidasEstornoProvisao(p);
    expect(e.map((x) => `${x.lado}${x.conta}${x.valorCentavos}`)).toEqual(['C5.9.11000', 'D2.1.91000']);
    expect(e[0]?.historico).toBe('Estorno da provisão do IRPJ 1º tri');
    const { linhas, avisos } = registrosBlocoMEcf(
      [
        {
          codigo: '93',
          descricao: 'Provisão indedutível',
          tipo: 'adicao',
          valorCentavos: 2000,
          irpj: true,
          csll: true,
          contaParteB: 'PROV',
          processo: null,
        },
        {
          codigo: null,
          descricao: 'Multa',
          tipo: 'adicao',
          valorCentavos: 100,
          irpj: true,
          csll: false,
          contaParteB: null,
          processo: null,
        },
      ],
      [
        {
          codigo: 'PROV',
          descricao: 'Provisões temporárias',
          dataInicial: '2198-01-01',
          tributo: 'ambos',
          natureza: 'devedor',
          saldoInicioCentavos: 0,
          movimentos: [
            { natureza: 'debito', valorCentavos: 2000, historico: 'Adição', daParteA: true },
            { natureza: 'credito', valorCentavos: 500, historico: 'Reversão', daParteA: false },
          ],
        },
      ],
    );
    expect(linhas.filter((l) => l.startsWith('|M010|'))).toHaveLength(2);
    expect(linhas.filter((l) => l.startsWith('|M300|'))).toHaveLength(2);
    expect(linhas.filter((l) => l.startsWith('|M350|'))).toHaveLength(1);
    expect(linhas).toContain('|M410|PROV|I|5,00|CR||Reversão|N|');
    expect(linhas).toContain('|M500|PROV|I|0,00|D|20,00|D|5,00|C|15,00|D|');
    expect(avisos).toHaveLength(1);
  });
});
