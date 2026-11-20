// Regra 15 (ficha do M54; cap-07 §7.5.3): indicadores econômicos com ficha técnica; o consolidado é a soma dos
// numeradores sobre a soma dos denominadores (nunca a média dos indicadores de cada centro). As parcelas por centro vão
// junto, para a conferência.
import type { CodigoEstatistica, IndicadorEconomico, LinhaApuracaoCentro } from '@sgh/contratos';
import { dividirArredondado } from './repartir.js';

export interface FichaIndicador {
  readonly codigo: string;
  readonly rotulo: string;
  readonly formula: string;
  /** A estatística do denominador (produção do centro). */
  readonly estatistica: CodigoEstatistica;
}

export const FICHAS_INDICADOR: readonly FichaIndicador[] = [
  {
    codigo: 'custoPacienteDia',
    rotulo: 'Custo por paciente-dia',
    formula:
      'Σ custo final dos centros produtivos medidos em paciente-dia ÷ Σ paciente-dia desses centros na competência',
    estatistica: 'pacienteDia',
  },
  {
    codigo: 'custoHoraSala',
    rotulo: 'Custo por hora de sala cirúrgica',
    formula: 'Σ custo final dos centros medidos em horas de sala ÷ Σ horas de sala desses centros',
    estatistica: 'horasSala',
  },
  {
    codigo: 'custoExame',
    rotulo: 'Custo por exame realizado',
    formula: 'Σ custo final dos centros medidos em exames ÷ Σ exames desses centros',
    estatistica: 'exames',
  },
];

/**
 * Consolida as parcelas: valor = Σ numerador ÷ Σ denominador. O denominador vem em centésimos (a estatística guardada);
 * o valor sai em centavos por unidade.
 */
export function consolidarIndicador(
  ficha: FichaIndicador,
  parcelas: readonly { centro: number; numerador: number; denominador: number }[],
): IndicadorEconomico {
  const numerador = parcelas.reduce((s, p) => s + p.numerador, 0);
  const denominador = parcelas.reduce((s, p) => s + p.denominador, 0);
  return {
    codigo: ficha.codigo,
    rotulo: ficha.rotulo,
    formula: ficha.formula,
    numerador,
    denominador,
    valor: denominador === 0 ? null : dividirArredondado(numerador * 100, denominador),
    parcelas: [...parcelas],
  };
}

/** Os indicadores da apuração: cada centro produtivo entra no indicador da sua estatística de produção. */
export function indicadoresDaApuracao(linhas: readonly LinhaApuracaoCentro[]): IndicadorEconomico[] {
  return FICHAS_INDICADOR.map((f) =>
    consolidarIndicador(
      f,
      linhas
        .filter((l) => l.classe === 'produtivo' && l.producao?.codigo === f.estatistica)
        .map((l) => ({ centro: l.centro, numerador: l.custoFinal, denominador: l.producao!.quantidadeCent })),
    ),
  );
}
