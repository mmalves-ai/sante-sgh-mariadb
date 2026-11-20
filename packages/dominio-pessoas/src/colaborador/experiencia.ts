// W0-06, parte 5 (M2 de mercado): o alerta do fim do período de experiência. O contrato de experiência não passa de 90
// dias (CLT art. 445, parágrafo único) e admite uma única prorrogação (art. 451): o arranjo usual é 45 + 45. Os marcos
// são o 45º e o 90º dia contados da admissão (o dia da admissão é o 1º), quando o gestor decide prorrogar, efetivar ou
// encerrar, e a avaliação de experiência daquele marco é o registro da decisão.
// Puro: o "hoje" vem de quem chama; datas civis AAAA-MM-DD.
import { diaUtc, diasEntre } from '../datas.js';

export const MARCOS_EXPERIENCIA = [45, 90] as const;
export type MarcoExperiencia = (typeof MARCOS_EXPERIENCIA)[number];

/** Antecedência padrão do alerta (dias antes do marco). */
export const ANTECEDENCIA_EXPERIENCIA = 10;

function somarDias(data: string, dias: number): string {
  return new Date((diaUtc(data) + dias) * 86_400_000).toISOString().slice(0, 10);
}

/** A data do marco: o 45º (ou 90º) dia de contrato, contando a admissão como o 1º. */
export function dataMarcoExperiencia(admissao: string, marco: MarcoExperiencia): string {
  return somarDias(admissao, marco - 1);
}

export interface AlertaExperiencia {
  readonly marco: MarcoExperiencia;
  readonly data: string;
  /** Dias até o marco (0: hoje; negativo: passou sem a avaliação daquele marco). */
  readonly dias: number;
  readonly situacao: 'proximo' | 'hoje' | 'vencido';
}

/**
 * Os alertas do colaborador em experiência: cada marco a até `antecedencia` dias, ou já passado sem a avaliação do
 * marco (`avaliados`). O marco de 45 deixa de alertar depois do de 90; depois do 90º dia, o 90 avaliado encerra os
 * alertas. Vínculo desligado ou não CLT não entra aqui (quem chama filtra).
 */
export function alertasExperiencia(
  admissao: string,
  hoje: string,
  avaliados: readonly MarcoExperiencia[] = [],
  antecedencia = ANTECEDENCIA_EXPERIENCIA,
): AlertaExperiencia[] {
  const r: AlertaExperiencia[] = [];
  const d90 = dataMarcoExperiencia(admissao, 90);
  for (const marco of MARCOS_EXPERIENCIA) {
    if (avaliados.includes(marco)) continue;
    const data = dataMarcoExperiencia(admissao, marco);
    const dias = diasEntre(hoje, data);
    if (dias > antecedencia) continue;
    if (marco === 45 && diasEntre(hoje, d90) < 0) continue;
    r.push({ marco, data, dias, situacao: dias === 0 ? 'hoje' : dias > 0 ? 'proximo' : 'vencido' });
  }
  return r;
}
