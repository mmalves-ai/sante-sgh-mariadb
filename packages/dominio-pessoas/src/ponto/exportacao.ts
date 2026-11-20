// Exportação dos eventos de ponto para a folha (M53-F0; ficha do M53, regra 5; ref 02; cap-07 §7.1.3). A apuração do
// M52 (regra 13) já classifica o tempo pelos tipos de hora (POTPHORA) e o reparte pelos 13 tipos de integração com a
// folha (PETP_INTEGR_EVENTO), com as faixas de hora extra no parâmetro da apuração; o fechamento do período grava esses
// minutos (SGH_PES_PONTO_FECHAMENTO.TOTAIS, `eventos`, e a classificação em `classes`). A exportação leva exatamente o
// que foi fechado: um evento por vínculo e tipo de integração, sem novo de-para (D-PONTO-531: um só lugar decide a
// faixa, a apuração), e, informativo, os minutos por vínculo e tipo de hora (D-HORAS-531).
//
// O lote não sai (pendência) quando um vínculo da folha não tem o período fechado ou quando o fechamento traz um tipo
// de integração que não está cadastrado (a folha externa não saberia o que pagar).
import {
  CODIGOS_EVENTO_PONTO_FOLHA,
  CODIGOS_TIPO_HORA,
  type EventoPontoExportado,
  type HoraPontoExportada,
} from '@sgh/contratos';

/** O fechamento vigente do vínculo na competência: os minutos por tipo de integração, ou null (período não fechado). */
export interface FechamentoPontoVinculo {
  readonly vinculo: number;
  readonly eventos: Readonly<Record<string, number>> | null;
  /** Os minutos por tipo de hora da apuração (POTPHORA) gravados no mesmo fechamento (`classes`); ausente: nenhum. */
  readonly horas?: Readonly<Record<string, number>> | null;
}

export interface EventoIndisponivelPonto {
  readonly evento: number;
  readonly vinculos: readonly number[];
}

export interface ResultadoExportacaoPonto {
  readonly eventos: readonly EventoPontoExportado[];
  /** Regra 5: os minutos fechados por vínculo e tipo de hora (POTPHORA), em ordem, sem os zerados. */
  readonly horas: readonly HoraPontoExportada[];
  /** Vínculos sem o período fechado (ordem crescente). */
  readonly semFechamento: readonly number[];
  readonly indisponiveis: readonly EventoIndisponivelPonto[];
  /** Minutos fechados e minutos exportados (iguais quando não há pendência). */
  readonly minutosFechados: number;
  readonly minutosExportados: number;
}

const CONHECIDOS: ReadonlySet<number> = new Set(CODIGOS_EVENTO_PONTO_FOLHA);
const TIPOS_HORA: ReadonlySet<number> = new Set(CODIGOS_TIPO_HORA);

const minutosValidos = (minutos: number, vinculo: number) => {
  if (!Number.isInteger(minutos) || minutos < 0)
    throw new RangeError(`Minutos inválidos no fechamento do vínculo ${vinculo}.`);
};

/**
 * Regra 5: um evento por vínculo e tipo de integração, ordenado por vínculo e evento; minutos zerados não viram evento.
 * `eventosDisponiveis` são os códigos lidos do domínio de integração na hora. Minutos negativos ou fracionários são
 * erro de programação do fechamento e levantam exceção.
 */
export function exportarEventosPonto(
  fechamentos: readonly FechamentoPontoVinculo[],
  eventosDisponiveis: ReadonlySet<number>,
): ResultadoExportacaoPonto {
  const eventos: EventoPontoExportado[] = [];
  const horas: HoraPontoExportada[] = [];
  const semFechamento: number[] = [];
  const indisponiveis = new Map<number, Set<number>>();
  let minutosFechados = 0;
  let minutosExportados = 0;
  for (const f of [...fechamentos].sort((a, b) => a.vinculo - b.vinculo)) {
    if (f.eventos === null) {
      semFechamento.push(f.vinculo);
      continue;
    }
    // A classificação da apuração usa sempre os códigos de POTPHORA: outro código é erro de programação.
    for (const tipoHora of Object.keys(f.horas ?? {})
      .map(Number)
      .sort((a, b) => a - b)) {
      const minutos = f.horas?.[String(tipoHora)] ?? 0;
      minutosValidos(minutos, f.vinculo);
      if (!TIPOS_HORA.has(tipoHora))
        throw new RangeError(`Tipo de hora ${tipoHora} desconhecido no fechamento do vínculo ${f.vinculo}.`);
      if (minutos > 0) horas.push({ vinculo: f.vinculo, tipoHora, minutos });
    }
    const codigos = Object.keys(f.eventos)
      .map(Number)
      .sort((a, b) => a - b);
    for (const codigo of codigos) {
      const minutos = f.eventos[String(codigo)] ?? 0;
      minutosValidos(minutos, f.vinculo);
      if (minutos === 0) continue;
      minutosFechados += minutos;
      if (!CONHECIDOS.has(codigo) || !eventosDisponiveis.has(codigo)) {
        const s = indisponiveis.get(codigo) ?? new Set<number>();
        s.add(f.vinculo);
        indisponiveis.set(codigo, s);
        continue;
      }
      eventos.push({ vinculo: f.vinculo, evento: codigo, minutos });
      minutosExportados += minutos;
    }
  }
  return {
    eventos,
    horas,
    semFechamento,
    indisponiveis: [...indisponiveis]
      .sort((a, b) => a[0] - b[0])
      .map(([evento, vs]) => ({ evento, vinculos: [...vs].sort((a, b) => a - b) })),
    minutosFechados,
    minutosExportados,
  };
}

function blocoDoFechamento(
  totais: string | null,
  bloco: 'eventos' | 'classes',
): Record<string, number> | null {
  if (!totais) return null;
  try {
    const t = JSON.parse(totais) as Record<string, unknown>;
    const b = t[bloco];
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) if (typeof v === 'number') out[k] = v;
    return out;
  } catch {
    return null;
  }
}

/** Os minutos por tipo de integração gravados no fechamento (`{"eventos": {...}}`); ilegível ou ausente: null. */
export function eventosDoFechamento(totais: string | null): Record<string, number> | null {
  return blocoDoFechamento(totais, 'eventos');
}

/** Os minutos por tipo de hora (POTPHORA) gravados no fechamento (`{"classes": {...}}`); ilegível ou ausente: null. */
export function horasDoFechamento(totais: string | null): Record<string, number> | null {
  return blocoDoFechamento(totais, 'classes');
}
