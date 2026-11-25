// F7 (08-SGO linha 98, C2-116): a franquia do plano ou do contrato. Diferente da coparticipação (uma parte de cada
// evento), a franquia é o valor que o beneficiário paga sozinho até o limite da janela de acúmulo (por evento, dia, mês,
// ano ou vigência do contrato); passado o limite, a operadora cobre o resto. A parte do evento que entra na franquia é o
// evento inteiro, um percentual dele ou o evento vezes um fator, limitada pelo teto por guia. Na internação, a franquia
// alcança só os primeiros dias cobertos pela regra, e a guia ambulatorial feita durante a internação só entra se a regra
// mandar. RN ANS 433: o fator moderador não pode impedir o acesso; por isso o limite e o teto.

export type PeriodoAcumulo = 'evento' | 'dia' | 'mes' | 'ano' | 'vigencia_contrato';
export const PERIODOS_ACUMULO: readonly PeriodoAcumulo[] = [
  'evento',
  'dia',
  'mes',
  'ano',
  'vigencia_contrato',
];

export interface RegraFranquia {
  /** Limite da franquia na janela (R$); nulo: sem limite, só o teto por guia limita. */
  readonly valor: number | null;
  /** Percentual do evento que entra na franquia (0 a 100); nulo: o evento inteiro (ou o fator). */
  readonly percentual: number | null;
  /** Fator sobre o valor do evento (0 a 1); nulo: não usado. */
  readonly fator: number | null;
  readonly tetoPorGuia: number | null;
  readonly periodoAcumulo: PeriodoAcumulo;
  /** Internação: quantos dias a franquia alcança; nulo: a internação inteira. */
  readonly diasInternacao: number | null;
  readonly cobraGuiaAmbulatorialNaInternacao: boolean;
  /** AAAA-MM-DD. */
  readonly inicio: string;
  readonly fim: string | null;
}

export interface EventoFranquia {
  readonly valor: number;
  /** AAAA-MM-DD do atendimento. */
  readonly data: string;
  /** Dias da internação (só na guia de internação). */
  readonly diasInternacao?: number | null;
  /** Guia ambulatorial feita enquanto o beneficiário estava internado. */
  readonly ambulatorialDuranteInternacao?: boolean;
}

export interface ResultadoFranquia {
  /** O que o beneficiário paga por este evento. */
  readonly cobrado: number;
  /** O que ainda falta para atingir o limite da janela depois deste evento (nulo: sem limite). */
  readonly restante: number | null;
  readonly motivo:
    | 'cobrada'
    | 'limite-atingido'
    | 'teto-por-guia'
    | 'internacao-alem-dos-dias'
    | 'ambulatorial-na-internacao'
    | 'fora-da-vigencia';
}

const centavos = (v: number) => Math.round(v * 100) / 100;
const data = /^\d{4}-\d{2}-\d{2}$/;

/** A janela de acúmulo que contém a data do evento (AAAA-MM-DD, inclusiva). */
export function janelaDeAcumulo(
  periodo: PeriodoAcumulo,
  dataEvento: string,
  contrato: { inicio: string; fim: string | null },
): { inicio: string; fim: string } {
  const [a, m] = dataEvento.split('-');
  if (periodo === 'evento' || periodo === 'dia') return { inicio: dataEvento, fim: dataEvento };
  if (periodo === 'mes') {
    const ultimo = new Date(Date.UTC(Number(a), Number(m), 0)).getUTCDate();
    return { inicio: `${a}-${m}-01`, fim: `${a}-${m}-${String(ultimo).padStart(2, '0')}` };
  }
  if (periodo === 'ano') return { inicio: `${a}-01-01`, fim: `${a}-12-31` };
  return { inicio: contrato.inicio, fim: contrato.fim ?? '9999-12-31' };
}

/** Os problemas da regra, para a recusa no servidor e a validação na hora na tela. */
export function problemasDaFranquia(r: RegraFranquia): string[] {
  const p: string[] = [];
  if (r.valor === null && r.percentual === null && r.fator === null) p.push('franquia-sem-valor');
  if (r.valor !== null && r.valor <= 0) p.push('franquia-limite-invalido');
  if (r.percentual !== null && (r.percentual <= 0 || r.percentual > 100))
    p.push('franquia-percentual-invalido');
  if (r.fator !== null && (r.fator <= 0 || r.fator > 1)) p.push('franquia-fator-invalido');
  if (r.percentual !== null && r.fator !== null) p.push('franquia-percentual-ou-fator');
  if (r.tetoPorGuia !== null && r.tetoPorGuia <= 0) p.push('franquia-teto-invalido');
  if (r.tetoPorGuia !== null && r.valor !== null && r.tetoPorGuia > r.valor)
    p.push('franquia-teto-acima-do-limite');
  if (!PERIODOS_ACUMULO.includes(r.periodoAcumulo)) p.push('franquia-periodo-invalido');
  if (r.diasInternacao !== null && (!Number.isInteger(r.diasInternacao) || r.diasInternacao < 1))
    p.push('franquia-dias-internacao-invalido');
  if (!data.test(r.inicio)) p.push('franquia-inicio-invalido');
  if (r.fim !== null && (!data.test(r.fim) || r.fim < r.inicio)) p.push('franquia-fim-antes-do-inicio');
  return p;
}

/**
 * Quanto o beneficiário paga de franquia por este evento, dado o que já acumulou na janela (`acumulado`, só de
 * lançamentos válidos: o que foi cancelado não conta). Nunca negativo, nunca acima do evento.
 */
export function calcularFranquia(r: RegraFranquia, e: EventoFranquia, acumulado: number): ResultadoFranquia {
  const restanteDe = (cobrado: number) =>
    r.valor === null ? null : centavos(Math.max(0, r.valor - acumulado - cobrado));
  if (e.data < r.inicio || (r.fim !== null && e.data > r.fim))
    return { cobrado: 0, restante: restanteDe(0), motivo: 'fora-da-vigencia' };
  if (e.ambulatorialDuranteInternacao && !r.cobraGuiaAmbulatorialNaInternacao)
    return { cobrado: 0, restante: restanteDe(0), motivo: 'ambulatorial-na-internacao' };
  let base = Math.max(0, e.valor);
  let motivo: ResultadoFranquia['motivo'] = 'cobrada';
  const dias = e.diasInternacao ?? null;
  if (dias !== null && dias > 0 && r.diasInternacao !== null && dias > r.diasInternacao) {
    base = (base * r.diasInternacao) / dias;
    motivo = 'internacao-alem-dos-dias';
  }
  if (r.percentual !== null) base = (base * r.percentual) / 100;
  else if (r.fator !== null) base = base * r.fator;
  if (r.tetoPorGuia !== null && base > r.tetoPorGuia) {
    base = r.tetoPorGuia;
    motivo = 'teto-por-guia';
  }
  if (r.valor !== null) {
    const falta = Math.max(0, r.valor - acumulado);
    if (base >= falta) {
      base = falta;
      motivo = 'limite-atingido';
    }
  }
  const cobrado = centavos(Math.min(base, Math.max(0, e.valor)));
  return { cobrado, restante: restanteDe(cobrado), motivo };
}
