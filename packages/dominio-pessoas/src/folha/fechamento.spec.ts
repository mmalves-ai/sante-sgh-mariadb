// M53-F6: o fechamento do período da folha (o que fixa, o que barra e a prova da soma). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  conferirFechamentoFolha,
  janelaPagamentoMensal,
  pendenciasFechamento,
  type ProcessoParaFechamento,
  periodoDoProcesso,
  periodoTerminado,
  processosDoPeriodo,
  processosNoFechamento,
  textoResumoFechamento,
  totaisFechamento,
} from './fechamento.js';

const proc = (
  over: Partial<ProcessoParaFechamento> & Pick<ProcessoParaFechamento, 'id'>,
): ProcessoParaFechamento => ({
  tipo: 'mensal',
  competencia: '2026-09',
  numero: 1,
  situacao: 'calculada',
  pagamento: null,
  resumo: 'a'.repeat(64),
  totais: {
    colaboradores: 2,
    proventos: 1_000_00,
    descontos: 200_00,
    liquido: 800_00,
    inss: 100_00,
    irrf: 50_00,
    fgts: 80_00,
    inssPatronal: 200_00,
    rat: 30_00,
    terceiros: 58_00,
  },
  ...over,
});

describe('período de apuração do processamento', () => {
  it('o 13º é do ano; folha, férias e rescisão, da competência', () => {
    expect(periodoDoProcesso('mensal', '2026-09')).toEqual({ apuracao: 'mensal', periodo: '2026-09' });
    expect(periodoDoProcesso('rescisao', '2026-09')).toEqual({ apuracao: 'mensal', periodo: '2026-09' });
    expect(periodoDoProcesso('decimo1', '2026-06')).toEqual({ apuracao: 'anual', periodo: '2026' });
    expect(periodoDoProcesso('decimo2', '2026-12')).toEqual({ apuracao: 'anual', periodo: '2026' });
  });

  it('só os calculados do período entram, na ordem da competência e do tipo', () => {
    const ps = [
      proc({ id: 5, tipo: 'rescisao', pagamento: '2026-09-20' }),
      proc({ id: 4, tipo: 'ferias', pagamento: '2026-09-01' }),
      proc({ id: 3 }),
      proc({ id: 2, situacao: 'substituida' }),
      proc({ id: 6, competencia: '2026-10' }),
      proc({ id: 7, tipo: 'decimo1', competencia: '2026-09', pagamento: '2026-09-30' }),
    ];
    expect(processosDoPeriodo('mensal', '2026-09', ps).map((p) => p.id)).toEqual([3, 4, 5]);
    expect(processosDoPeriodo('anual', '2026', ps).map((p) => p.id)).toEqual([7]);
  });
});

describe('o que barra o fechamento', () => {
  const base = {
    apuracao: 'mensal' as const,
    periodo: '2026-09',
    hoje: '2026-10-28',
    pagamento: '2026-10-05',
    jaFechado: false,
    processos: [proc({ id: 3 })],
  };

  it('mensal terminado, com a folha mensal e a data de pagamento: nada barra', () => {
    expect(pendenciasFechamento(base)).toEqual([]);
  });

  it('período em curso, sem folha mensal, sem data, já fechado', () => {
    expect(
      pendenciasFechamento({
        ...base,
        hoje: '2026-09-30',
        pagamento: null,
        jaFechado: true,
        processos: [],
      }).map((p) => p.codigo),
    ).toEqual(['ja-fechado', 'periodo-em-curso', 'sem-folha-mensal', 'pagamento-obrigatorio']);
  });

  it('pagamento da folha mensal do 1º dia da competência ao último do mês seguinte', () => {
    expect(janelaPagamentoMensal('2026-09')).toEqual({ de: '2026-09-01', ate: '2026-10-31' });
    expect(janelaPagamentoMensal('2026-12')).toEqual({ de: '2026-12-01', ate: '2027-01-31' });
    expect(pendenciasFechamento({ ...base, pagamento: '2026-11-01' }).map((p) => p.codigo)).toEqual([
      'pagamento-fora-do-periodo',
    ]);
    expect(pendenciasFechamento({ ...base, pagamento: '2026-08-31' }).map((p) => p.codigo)).toEqual([
      'pagamento-fora-do-periodo',
    ]);
  });

  it('recibo de férias sem data de pagamento barra; o anual pede a 2ª parcela do 13º', () => {
    expect(
      pendenciasFechamento({ ...base, processos: [proc({ id: 3 }), proc({ id: 4, tipo: 'ferias' })] }),
    ).toEqual([
      { codigo: 'sem-pagamento', mensagem: 'O processamento 4 não tem a data de pagamento.', processo: 4 },
    ]);
    const anual = {
      ...base,
      apuracao: 'anual' as const,
      periodo: '2026',
      hoje: '2026-12-21',
      pagamento: null,
    };
    expect(
      pendenciasFechamento({
        ...anual,
        processos: [proc({ id: 7, tipo: 'decimo1', pagamento: '2026-11-30' })],
      }).map((p) => p.codigo),
    ).toEqual(['sem-decimo-final']);
    expect(
      pendenciasFechamento({
        ...anual,
        processos: [proc({ id: 8, tipo: 'decimo2', pagamento: '2026-12-18' })],
      }),
    ).toEqual([]);
    expect(periodoTerminado('anual', '2026', '2026-12-19')).toBe(false);
  });
});

describe('totais e prova da soma', () => {
  it('soma os processamentos, encargos = patronal + RAT + terceiros, com as parcelas impressas', () => {
    const ps = [proc({ id: 3 }), proc({ id: 4, tipo: 'ferias', pagamento: '2026-09-01' })];
    const t = totaisFechamento(ps);
    expect(t).toEqual({
      processos: 2,
      proventos: 2_000_00,
      descontos: 400_00,
      liquido: 1_600_00,
      inss: 200_00,
      irrf: 100_00,
      fgts: 160_00,
      encargos: 576_00,
    });
    const c = conferirFechamentoFolha(ps, t);
    expect(c.ok).toBe(true);
    expect(c.parcelas.map((p) => p.valor)).toEqual([800_00, 800_00, 1_600_00, 2_000_00, 400_00, 1_600_00]);
    expect(c.parcelas[0]!.rotulo).toBe('Folha mensal 2026-09 (processamento 3)');
  });

  it('processamento que não fecha a própria conta é divergência', () => {
    const ps = [proc({ id: 3, totais: { ...proc({ id: 3 }).totais, liquido: 799_00 } })];
    const c = conferirFechamentoFolha(ps, totaisFechamento(ps));
    expect(c.ok).toBe(false);
    expect(c.divergencias[0]).toContain('processamento 3');
  });

  it('a folha mensal fixada leva a data de pagamento do fechamento; o texto do resumo muda com ela', () => {
    const ps = [proc({ id: 3 }), proc({ id: 4, tipo: 'ferias', pagamento: '2026-09-01' })];
    const f = processosNoFechamento(ps, '2026-10-05');
    expect(f.map((p) => p.pagamento)).toEqual(['2026-10-05', '2026-09-01']);
    expect(textoResumoFechamento(f)).not.toBe(textoResumoFechamento(processosNoFechamento(ps, '2026-10-06')));
  });
});
