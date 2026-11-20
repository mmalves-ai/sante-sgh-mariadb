import { describe, expect, it } from 'vitest';
import { base } from './calculo.spec.js';
import { percentual, seriesAssistenciais, seriesOperacionais } from './paineis.js';

describe('painéis assistencial e operacional', () => {
  it('assistencial: os indicadores com ficha, com numerador e denominador', () => {
    const s = seriesAssistenciais([
      base('2026-01', { pacientesDia: 50, leitosDia: 100, saidas: 10, admissoes: 12 }),
    ]);
    expect(s.map((x) => x.codigo)).toEqual([
      'taxaOcupacao',
      'taxaOcupacaoIntensiva',
      'mediaPermanencia',
      'taxaMortalidadeInstitucional',
      'taxaReinternacao30',
      'admissoes',
    ]);
    expect(s[0]?.valores[0]).toMatchObject({ valor: 50, numerador: 50, denominador: 100 });
    expect(s[2]?.valores[0]?.valor).toBe(5);
  });

  it('operacional: zero no mês sem linha e o parcial', () => {
    const s = seriesOperacionais(
      [
        {
          periodo: '2026-01',
          atendimentosExternos: 3,
          internacoes: 1,
          consultas: 2,
          cirurgias: 1,
          exames: 9,
        },
      ],
      ['2026-01', '2026-02'],
      '2026-02',
    );
    expect(s.find((x) => x.codigo === 'exames')?.valores.map((v) => [v.valor, v.parcial])).toEqual([
      [9, false],
      [0, true],
    ]);
    expect(percentual(1, 0)).toBeNull();
  });
});
