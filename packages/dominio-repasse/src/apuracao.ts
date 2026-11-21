// Regras 9 e 10 do M33. A apuração do período passa por aberta → conferida → aprovada → titulada (SGH_REP_APURACAO);
// quem apura não aprova; aprovada não muda (correção entra no período seguinte); devolver leva a conferida de volta a
// aberta. Uma apuração por período e empresa num só sistema: se o outro sistema já apurou (FCINTEGRPA ou RPLANEVE no
// período), o novo mostra a apuração dele e não grava.
import type { EstadoApuracao } from '@sgh/contratos';
import type { MemoriaCalculo } from './calculo.js';
import type { ResultadoTransicao } from './versao-regra.js';

export type AcaoApuracao = 'recalcular' | 'conferir' | 'aprovar' | 'devolver' | 'titular';

export interface Apuracao {
  readonly estado: EstadoApuracao;
  readonly apuradoPor: string;
}

const recusa = (motivo: string) => ({ ok: false, motivo }) as const;

export function transicaoApuracao(
  a: Apuracao,
  acao: AcaoApuracao,
  usuario: string,
): ResultadoTransicao<EstadoApuracao> {
  switch (acao) {
    case 'recalcular':
      return a.estado === 'aberta'
        ? { ok: true, estado: 'aberta' }
        : recusa('Só a apuração aberta é recalculada; a correção entra no período seguinte.');
    case 'conferir':
      return a.estado === 'aberta'
        ? { ok: true, estado: 'conferida' }
        : recusa('Só a apuração aberta é conferida.');
    case 'devolver':
      return a.estado === 'conferida'
        ? { ok: true, estado: 'aberta' }
        : recusa('Só a apuração conferida é devolvida.');
    case 'aprovar':
      if (a.estado !== 'conferida') return recusa('Confira a apuração antes de aprovar.');
      if (usuario === a.apuradoPor) return recusa('Quem apurou não aprova.');
      return { ok: true, estado: 'aprovada' };
    case 'titular':
      return a.estado === 'aprovada'
        ? { ok: true, estado: 'titulada' }
        : recusa('Só a apuração aprovada gera RPA e título.');
  }
}

export type RecusaPeriodo = 'periodo-ja-apurado';

/**
 * Regra 10: pode abrir (ou recalcular) a apuração deste período e empresa? Não quando o período já tem lançamentos
 * de uma apuração aprovada, nem quando a apuração do período já passou da fase aberta: a correção entra no período
 * seguinte.
 */
export function podeApurarPeriodo(estado: {
  readonly lancamentosDaApuracaoNoPeriodo: number;
  readonly apuracaoFechada: boolean;
}): { ok: true } | { ok: false; recusa: RecusaPeriodo } {
  if (estado.apuracaoFechada || estado.lancamentosDaApuracaoNoPeriodo > 0) return { ok: false, recusa: 'periodo-ja-apurado' };
  return { ok: true };
}

export interface TotaisApuracao {
  readonly itens: number;
  readonly comRepasse: number;
  readonly pendentes: number;
  readonly pendenciasPorMotivo: Readonly<Record<string, number>>;
  readonly baseCentavos: number;
  readonly repasseCentavos: number;
  /** Repasse por beneficiário (parcelas do total, para o demonstrativo). */
  readonly porBeneficiario: ReadonlyMap<number, number>;
}

/** Totais com as parcelas: a soma de porBeneficiario é sempre repasseCentavos. */
export function totalizar(memorias: readonly MemoriaCalculo[]): TotaisApuracao {
  const pend: Record<string, number> = {};
  const porBeneficiario = new Map<number, number>();
  let base = 0;
  let repasse = 0;
  let com = 0;
  for (const m of memorias) {
    if (m.pendencia) {
      pend[m.pendencia] = (pend[m.pendencia] ?? 0) + 1;
      continue;
    }
    com += 1;
    base += m.baseCentavos;
    repasse += m.valorCentavos;
    const b = m.beneficiario as number;
    porBeneficiario.set(b, (porBeneficiario.get(b) ?? 0) + m.valorCentavos);
  }
  return {
    itens: memorias.length,
    comRepasse: com,
    pendentes: memorias.length - com,
    pendenciasPorMotivo: pend,
    baseCentavos: base,
    repasseCentavos: repasse,
    porBeneficiario,
  };
}

/** Prova pós-escrita: a soma relida do período bate com a memória de cálculo. */
export function somaConfere(relidoCentavos: readonly number[], memorias: readonly MemoriaCalculo[]): boolean {
  return relidoCentavos.reduce((s, v) => s + v, 0) === totalizar(memorias).repasseCentavos;
}
