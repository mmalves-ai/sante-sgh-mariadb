// Regra 15 (ficha do M54): indicador econômico com ficha técnica; consolidado = Σ numeradores ÷ Σ denominadores (nunca a
// média dos indicadores de cada centro), com as parcelas.
import { describe, expect, it } from 'vitest';
import type { LinhaApuracaoCentro } from '@sgh/contratos';
import { consolidarIndicador, FICHAS_INDICADOR, indicadoresDaApuracao } from './indicador.js';

const ficha = FICHAS_INDICADOR[0]!;

describe('indicadores econômicos', () => {
  it('soma de numeradores sobre soma de denominadores, não a média das razões', () => {
    // UTI: R$ 1.000,00 em 10 paciente-dia (R$ 100); enfermaria: R$ 1.000,00 em 90 (R$ 11,11). Média = R$ 55,56; certo = R$ 20.
    const i = consolidarIndicador(ficha, [
      { centro: 1, numerador: 100_000, denominador: 1_000 },
      { centro: 2, numerador: 100_000, denominador: 9_000 },
    ]);
    expect(i.valor).toBe(2_000);
    expect(i.numerador).toBe(200_000);
    expect(i.denominador).toBe(10_000);
    expect(i.parcelas).toHaveLength(2);
    expect(i.formula).toContain('Σ');
  });
  it('sem denominador: valor nulo', () => {
    expect(consolidarIndicador(ficha, []).valor).toBeNull();
  });
  it('da apuração: cada produtivo entra no indicador da sua produção', () => {
    const l = (
      centro: number,
      codigo: 'pacienteDia' | 'exames' | null,
      custoFinal: number,
      q: number,
      classe: LinhaApuracaoCentro['classe'] = 'produtivo',
    ) =>
      ({
        centro,
        classe,
        custoFinal,
        producao: codigo ? { codigo, quantidadeCent: q } : null,
      }) as unknown as LinhaApuracaoCentro;
    const r = indicadoresDaApuracao([
      l(1, 'pacienteDia', 1_000, 100),
      l(2, 'exames', 500, 500),
      l(3, null, 9, 0),
      l(4, 'pacienteDia', 7, 100, 'auxiliar'),
    ]);
    expect(r.map((x) => [x.codigo, x.valor])).toEqual([
      ['custoPacienteDia', 1_000],
      ['custoHoraSala', null],
      ['custoExame', 100],
    ]);
  });
});
