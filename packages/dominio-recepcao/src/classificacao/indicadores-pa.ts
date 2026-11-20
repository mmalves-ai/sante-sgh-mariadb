// Indicadores da classificação no PA (ficha do M44, regra 5; cap-05a §5.3, Indicadores Fase 5): porta →
// classificação, porta → médico, percentual dentro do tempo-alvo por cor e reclassificações, cada um com numerador e
// denominador impressos. As marcas de tempo vêm SÓ do novo (SGH_PA_ETAPA e SGH_PA_CLASSIFICACAO): a saída gravada no
// outro sistema é cópia da entrada (ref 01 §3.15) e nunca entra na conta. Atendimento sem a marca de chegada fica
// fora do denominador e é contado à parte (`semMarcas`).
import type { CorRisco } from '@sgh/contratos';
import { CORES_RISCO } from '@sgh/contratos';

export interface AtendimentoClassificado {
  readonly chegada: string | null;
  /** A primeira classificação (a cor inicial vale para o tempo-alvo). */
  readonly classificadoEm: string | null;
  readonly corInicial: CorRisco | null;
  readonly tempoAlvoMin: number | null;
  readonly atendimentoMedicoEm: string | null;
  readonly reclassificacoes: number;
}

export interface Razao {
  readonly numerador: number;
  readonly denominador: number;
  /** Percentual com uma casa (null sem denominador). */
  readonly percentual: number | null;
}

export interface Tempo {
  /** Mediana em minutos (null sem amostra). */
  readonly medianaMin: number | null;
  /** Atendimentos com as duas marcas (a amostra) e o total do período. */
  readonly amostra: number;
  readonly total: number;
}

export interface IndicadoresClassificacao {
  readonly atendimentos: number;
  readonly semMarcas: number;
  readonly portaClassificacao: Tempo;
  readonly portaMedico: Tempo;
  readonly dentroDoTempoAlvo: readonly ({ readonly cor: CorRisco } & Razao)[];
  readonly reclassificados: Razao;
}

const ms = (iso: string) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
const minutos = (a: string, b: string) => (ms(b) - ms(a)) / 60_000;

function mediana(v: readonly number[]): number | null {
  const x = v.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (x.length === 0) return null;
  const m = Math.floor(x.length / 2);
  return Math.round(x.length % 2 ? x[m]! : (x[m - 1]! + x[m]!) / 2);
}

export function razao(numerador: number, denominador: number): Razao {
  return {
    numerador,
    denominador,
    percentual: denominador > 0 ? Math.round((numerador / denominador) * 1000) / 10 : null,
  };
}

/**
 * `agora`: o fim do período. Quem foi classificado e ainda espera, com o prazo vencido, conta como fora do tempo; quem
 * ainda está dentro do prazo e sem médico fica fora do denominador (ainda não se sabe).
 */
export function indicadoresClassificacao(
  itens: readonly AtendimentoClassificado[],
  agora: string,
): IndicadoresClassificacao {
  const comChegada = itens.filter((i) => i.chegada !== null);
  const pc = comChegada.flatMap((i) => (i.classificadoEm ? [minutos(i.chegada!, i.classificadoEm)] : []));
  const pm = comChegada.flatMap((i) =>
    i.atendimentoMedicoEm ? [minutos(i.chegada!, i.atendimentoMedicoEm)] : [],
  );
  const classificados = itens.filter((i) => i.classificadoEm !== null && i.corInicial !== null);
  const dentro = CORES_RISCO.map(({ codigo }) => {
    let num = 0;
    let den = 0;
    for (const i of classificados.filter((x) => x.corInicial === codigo)) {
      const prazo = ms(i.classificadoEm!) + (i.tempoAlvoMin ?? 0) * 60_000;
      if (i.atendimentoMedicoEm) {
        den++;
        if (ms(i.atendimentoMedicoEm) <= prazo) num++;
      } else if (ms(agora) > prazo) den++;
    }
    return { cor: codigo, ...razao(num, den) };
  });
  return {
    atendimentos: itens.length,
    semMarcas: itens.length - comChegada.length,
    portaClassificacao: { medianaMin: mediana(pc), amostra: pc.length, total: comChegada.length },
    portaMedico: { medianaMin: mediana(pm), amostra: pm.length, total: comChegada.length },
    dentroDoTempoAlvo: dentro,
    reclassificados: razao(classificados.filter((i) => i.reclassificacoes > 0).length, classificados.length),
  };
}
