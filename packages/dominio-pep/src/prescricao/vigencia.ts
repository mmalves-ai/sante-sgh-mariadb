// Vigência da prescrição (regra 1 da ficha do M24; cap-05b §5.7; ref 04 §6.1): 24 horas pela regra do horário de
// medicação da unidade, que vale para os dois sistemas. Medido na cópia (2025-10 a 2026-07): internados nos blocos da
// regra 4 ("1601") começam às 16:01 e terminam às 16:00 do dia seguinte (1.439 minutos; 1.898 de 1.897 recentes);
// atendimento externo (regra "considerar a partir da prescrição", 3) começa no minuto da prescrição. Antes da virada,
// o médico prescreve o período atual (o que já começou ontem) ou o seguinte (o que começa hoje): 411 e 1.195 casos.
// Uma prescrição ativa por atendimento e período; vencida não gera horários novos.
import { DIA, inicioDoDia, localDe, minutoDoDia, minLocal } from './tempo.js';

export interface RegraVigencia {
  /** Horário inicial do período (HH:MM do cadastro). */
  readonly horarioInicial: string;
  /** 0: virada diária no horário inicial; 3: o período começa no minuto da prescrição (externo). */
  readonly considerar: number;
}

export interface Periodo {
  readonly inicio: string;
  readonly fim: string;
}

/** Duração do período: 24 horas menos 1 minuto (16:01 às 16:00). */
export const DURACAO_MINUTOS = DIA - 1;

export function periodoDe(inicioMin: number): Periodo {
  return { inicio: localDe(inicioMin), fim: localDe(inicioMin + DURACAO_MINUTOS) };
}

/** O período vigente agora e o seguinte. */
export function periodos(regra: RegraVigencia, agora: string): { atual: Periodo; seguinte: Periodo } {
  const a = minLocal(agora);
  if (regra.considerar === 3) {
    return { atual: periodoDe(a), seguinte: periodoDe(a + DIA) };
  }
  const virada = minutoDoDia(regra.horarioInicial);
  const hoje = inicioDoDia(a) + virada;
  const inicio = a >= hoje ? hoje : hoje - DIA;
  return { atual: periodoDe(inicio), seguinte: periodoDe(inicio + DIA) };
}

export type SituacaoVigencia = 'futura' | 'vigente' | 'vencida';

export function situacaoVigencia(p: Periodo, agora: string): SituacaoVigencia {
  const a = minLocal(agora);
  if (a < minLocal(p.inicio)) return 'futura';
  if (a > minLocal(p.fim)) return 'vencida';
  return 'vigente';
}

export const sobrepoe = (x: Periodo, y: Periodo): boolean =>
  minLocal(x.inicio) <= minLocal(y.fim) && minLocal(y.inicio) <= minLocal(x.fim);

/**
 * Período sugerido: o atual quando não há prescrição ativa nele; senão o seguinte. Recusa (null) quando os dois
 * já têm prescrição ativa (uma por atendimento e período).
 */
export function periodoSugerido(
  regra: RegraVigencia,
  agora: string,
  ativas: readonly Periodo[],
): { periodo: 'atual' | 'seguinte'; vigencia: Periodo } | null {
  const { atual, seguinte } = periodos(regra, agora);
  if (!ativas.some((p) => sobrepoe(p, atual))) return { periodo: 'atual', vigencia: atual };
  if (regra.considerar !== 3 && !ativas.some((p) => sobrepoe(p, seguinte)))
    return { periodo: 'seguinte', vigencia: seguinte };
  return null;
}

/** O período pedido está livre (nenhuma prescrição ativa do atendimento se sobrepõe)? */
export function periodoLivre(vigencia: Periodo, ativas: readonly Periodo[]): boolean {
  return !ativas.some((p) => sobrepoe(p, vigencia));
}

/** Regra da unidade: a do bloco do leito; senão a do tipo de atendimento marcada como padrão (a de menor código). */
export function regraDaUnidade(
  regras: readonly {
    readonly id: number;
    readonly tipoAtendimento: string;
    readonly horarioInicial: string | null;
    readonly considerar: number | null;
    readonly padrao: boolean;
  }[],
  porBloco: ReadonlyMap<string, number>,
  bloco: string | null,
  tipoAtendimento: string,
): (RegraVigencia & { readonly id: number }) | null {
  const doBloco = bloco ? porBloco.get(bloco.trim()) : undefined;
  const r =
    (doBloco !== undefined ? regras.find((x) => x.id === doBloco) : undefined) ??
    [...regras]
      .filter((x) => x.tipoAtendimento === tipoAtendimento && x.padrao)
      .sort((x, y) => x.id - y.id)[0];
  if (!r) return null;
  return { id: r.id, horarioInicial: r.horarioInicial ?? '0000', considerar: r.considerar ?? 0 };
}
