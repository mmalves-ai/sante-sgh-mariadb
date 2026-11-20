// Regra 8 (ficha do M54; cap-07 §7.2): o custeio só é confiável com a competência completa de estoque, financeiro,
// faturamento e pessoal. Sem uma delas, a apuração sai marcada "parcial (sem …)": sem a folha (M53 ainda não aceito),
// "parcial (sem pessoal)". A marca vai no resultado, no relatório e na exportação.
import {
  type CompletudeFonte,
  type FonteCompletude,
  FONTES_COMPLETUDE,
  ROTULOS_FONTE_COMPLETUDE,
  type SituacaoCompletude,
} from '@sgh/contratos';

/** As contagens agregadas de cada fonte na competência. */
export interface ContagensCompletude {
  /** Linhas de saída de estoque do mês. */
  readonly saidas: number;
  /** Lançamentos de despesa do financeiro no mês. */
  readonly despesas: number;
  /** Contas fechadas (ou apresentadas) da competência. */
  readonly contas: number;
  /** Linhas da folha do mês com lotação (proventos). */
  readonly folha: number;
}

const mil = (n: number) => n.toLocaleString('pt-BR');

function juntar(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
}

export function avaliarCompletude(c: ContagensCompletude): SituacaoCompletude {
  const presentes: Record<FonteCompletude, { presente: boolean; detalhe: string }> = {
    estoque: { presente: c.saidas > 0, detalhe: `${mil(c.saidas)} linha(s) de saída de estoque` },
    financeiro: { presente: c.despesas > 0, detalhe: `${mil(c.despesas)} lançamento(s) de despesa` },
    faturamento: { presente: c.contas > 0, detalhe: `${mil(c.contas)} conta(s) fechada(s)` },
    pessoal: {
      presente: c.folha > 0,
      detalhe:
        c.folha > 0
          ? `${mil(c.folha)} linha(s) de folha com lotação`
          : 'nenhuma folha da competência com lotação (folha de pagamento ainda não liberada)',
    },
  };
  const fontes: CompletudeFonte[] = FONTES_COMPLETUDE.map((f) => ({ fonte: f, ...presentes[f] }));
  const faltam = fontes
    .filter((f) => !f.presente)
    .map((f) => ROTULOS_FONTE_COMPLETUDE[f.fonte].toLowerCase());
  return {
    fontes,
    parcial: faltam.length > 0,
    rotulo: faltam.length > 0 ? `parcial (sem ${juntar(faltam)})` : null,
  };
}
