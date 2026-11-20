// Cálculo de dose (regra 12 da ficha do M24; cap-05b §5.7; ref 04 §6.1): por kg, por m² (superfície corporal de
// Mosteller) ou pelo clearance estimado (Cockcroft-Gault, com o fator 0,85 no sexo feminino), sempre com o dado mais
// recente e a data dele; velocidade de infusão derivada do volume e do tempo (o legado tem o cálculo de velocidade
// ligado). O resultado é sugestão: o prescritor confirma a dose, e os dados usados vão para o registro do novo.

export interface DadosPaciente {
  readonly pesoKg?: number | null;
  readonly alturaCm?: number | null;
  readonly idadeAnos?: number | null;
  readonly sexo?: 'F' | 'M' | null;
  /** Creatinina sérica mais recente (mg/dL). */
  readonly creatinina?: number | null;
  /** Data do dado mais recente usado (peso ou creatinina). */
  readonly dataDado?: string | null;
}

export type RegraDose = 'por-kg' | 'por-m2' | 'por-clearance' | 'fixa';

export interface ResultadoDose {
  readonly dose: number | null;
  readonly regra: RegraDose;
  readonly base: number | null;
  readonly falta: 'peso' | 'altura' | 'creatinina' | 'idade' | null;
}

const arredondar = (x: number, casas = 2) => Math.round(x * 10 ** casas) / 10 ** casas;

/** Superfície corporal (m²), Mosteller: √(altura cm × peso kg / 3600). */
export function superficieCorporal(pesoKg: number, alturaCm: number): number {
  return arredondar(Math.sqrt((alturaCm * pesoKg) / 3600), 3);
}

/** Clearance de creatinina estimado (mL/min), Cockcroft-Gault. */
export function clearanceEstimado(d: DadosPaciente): number | null {
  if (!d.pesoKg || !d.creatinina || d.idadeAnos === null || d.idadeAnos === undefined) return null;
  const base = ((140 - d.idadeAnos) * d.pesoKg) / (72 * d.creatinina);
  return arredondar(d.sexo === 'F' ? base * 0.85 : base, 1);
}

export function calcularDose(regra: RegraDose, dosePorUnidade: number, d: DadosPaciente): ResultadoDose {
  if (regra === 'fixa') return { dose: dosePorUnidade, regra, base: null, falta: null };
  if (regra === 'por-kg') {
    if (!d.pesoKg) return { dose: null, regra, base: null, falta: 'peso' };
    return { dose: arredondar(dosePorUnidade * d.pesoKg), regra, base: d.pesoKg, falta: null };
  }
  if (regra === 'por-m2') {
    if (!d.pesoKg) return { dose: null, regra, base: null, falta: 'peso' };
    if (!d.alturaCm) return { dose: null, regra, base: null, falta: 'altura' };
    const sc = superficieCorporal(d.pesoKg, d.alturaCm);
    return { dose: arredondar(dosePorUnidade * sc), regra, base: sc, falta: null };
  }
  const cl = clearanceEstimado(d);
  if (cl === null)
    return {
      dose: null,
      regra,
      base: null,
      falta: !d.pesoKg ? 'peso' : !d.creatinina ? 'creatinina' : 'idade',
    };
  // Dose por clearance: a dose de referência (clearance 100 mL/min) ajustada proporcionalmente, com teto na dose.
  return { dose: arredondar(dosePorUnidade * Math.min(1, cl / 100)), regra, base: cl, falta: null };
}

/** Faixa de ajuste renal pelo clearance (KDIGO): normal ≥ 90, leve 60–89, moderada 30–59, grave 15–29, falência < 15. */
export function faixaRenal(clearance: number): 'normal' | 'leve' | 'moderada' | 'grave' | 'falencia' {
  if (clearance >= 90) return 'normal';
  if (clearance >= 60) return 'leve';
  if (clearance >= 30) return 'moderada';
  if (clearance >= 15) return 'grave';
  return 'falencia';
}

/** Velocidade de infusão (mL/h) do volume em mL no tempo em minutos. */
export function velocidadeInfusao(volumeMl: number, tempoMinutos: number): number {
  if (volumeMl <= 0 || tempoMinutos <= 0) throw new Error('Volume e tempo devem ser positivos.');
  return arredondar((volumeMl * 60) / tempoMinutos, 1);
}

/** Gotas por minuto (equipo macrogotas: 20 gotas por mL; microgotas: 60). */
export function gotasPorMinuto(volumeMl: number, tempoMinutos: number, microgotas = false): number {
  if (volumeMl <= 0 || tempoMinutos <= 0) throw new Error('Volume e tempo devem ser positivos.');
  return Math.round((volumeMl * (microgotas ? 60 : 20)) / tempoMinutos);
}
