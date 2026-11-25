import type { BaseMensal } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  apurarIndicadoresInternacao,
  conferirCompetenciaApuracao,
  destinoDaApuracao,
  INDICADORES_OBRIGATORIOS_INTERNACAO,
  ultimoDiaDoMes,
} from './apuracao-internacao.js';

const base = (periodo: string, parcial: boolean, g: Partial<BaseMensal['grandezas']>): BaseMensal =>
  ({
    periodo,
    parcial,
    grandezas: {
      dias: 30,
      pacientesDia: 0,
      leitosDia: 0,
      pacientesDiaIntensiva: 0,
      leitosDiaIntensiva: 0,
      admissoes: 0,
      admissoesUrgencia: 0,
      saidas: 0,
      obitos: 0,
      obitosInstitucionais: 0,
      saidasVivas: 0,
      reinternacoes7: 0,
      reinternacoes30: 0,
      diariasFaturadas: 0,
      leitosOperacionaisMedios: 0,
      leitosDiaOciosos: 0,
      ...g,
    },
    altasPorGrupo: {},
  }) as unknown as BaseMensal;

describe('apuração dos indicadores obrigatórios de internação', () => {
  it('confere a competência: formato, início em 2019 e nada no futuro', () => {
    expect(conferirCompetenciaApuracao('2026-10', '2026-11')).toEqual([]);
    expect(conferirCompetenciaApuracao('2026-11', '2026-11')).toEqual([]);
    expect(conferirCompetenciaApuracao('2026-13', '2026-11')[0]!.codigo).toBe('competencia-invalida');
    expect(conferirCompetenciaApuracao('2018-12', '2026-11')[0]!.codigo).toBe('competencia-antiga');
    expect(conferirCompetenciaApuracao('2026-12', '2026-11')[0]!.codigo).toBe('competencia-futura');
  });

  it('último dia do mês, com fevereiro bissexto', () => {
    expect(ultimoDiaDoMes('2024-02')).toBe('2024-02-29');
    expect(ultimoDiaDoMes('2026-11')).toBe('2026-11-30');
  });

  it('cada indicador sai com numerador, denominador, valor, meta e situação pela polaridade', () => {
    const r = apurarIndicadoresInternacao(
      [
        base('2026-10', false, {
          pacientesDia: 255,
          leitosDia: 300,
          saidas: 50,
          obitos: 3,
          obitosInstitucionais: 2,
          leitosOperacionaisMedios: 10,
          leitosDiaOciosos: 45,
        }),
      ],
      { taxaOcupacao: 80, mediaPermanencia: 4, taxaMortalidadeGeral: null },
    );
    expect(new Set(r.map((x) => x.codigo))).toEqual(new Set(INDICADORES_OBRIGATORIOS_INTERNACAO));
    expect(r).toHaveLength(INDICADORES_OBRIGATORIOS_INTERNACAO.length);
    const de = (c: string) => r.find((x) => x.codigo === c)!;
    expect(de('taxaOcupacao')).toMatchObject({
      competencia: '2026-10-01',
      periodoFim: '2026-10-31',
      numerador: 255,
      denominador: 300,
      valor: 85,
      valorMeta: 80,
      situacaoMeta: 'na_meta',
      parcial: false,
    });
    expect(de('mediaPermanencia')).toMatchObject({
      numerador: 255,
      denominador: 50,
      valor: 5.1,
      situacaoMeta: 'fora_da_meta',
    });
    expect(de('giroLeito')).toMatchObject({ numerador: 50, denominador: 10, valor: 5 });
    expect(de('taxaMortalidadeGeral')).toMatchObject({
      numerador: 3,
      denominador: 50,
      valor: 6,
      situacaoMeta: 'sem_meta',
    });
  });

  it('sem saídas, o valor é nulo e a situação é sem valor (nunca divisão por zero)', () => {
    const r = apurarIndicadoresInternacao([base('2026-11', true, {})], { mediaPermanencia: 4 });
    const mp = r.find((x) => x.codigo === 'mediaPermanencia')!;
    expect(mp).toMatchObject({ valor: null, denominador: 0, situacaoMeta: 'sem_valor', parcial: true });
  });

  it('destino: inclui a nova, mantém a fechada, não regrava a igual e atualiza a prévia mudada', () => {
    const [nova] = apurarIndicadoresInternacao(
      [base('2026-10', false, { pacientesDia: 10, leitosDia: 20 })],
      {},
    );
    expect(destinoDaApuracao(null, nova!)).toBe('incluir');
    const g = { situacao: 'previa', numerador: 10, denominador: 20, valorMeta: null };
    expect(destinoDaApuracao(g, nova!)).toBe('sem-mudanca');
    expect(destinoDaApuracao({ ...g, numerador: 9 }, nova!)).toBe('atualizar');
    expect(destinoDaApuracao({ ...g, situacao: 'fechada', numerador: 9 }, nova!)).toBe('manter-fechada');
    expect(destinoDaApuracao({ ...g, situacao: 'cancelada' }, nova!)).toBe('atualizar');
  });
});
