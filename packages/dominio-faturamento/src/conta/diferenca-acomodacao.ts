// F3.4 (04-INT linha 81): diferença de acomodação cobrada do paciente. Quando o paciente ocupa uma acomodação acima da
// de direito pelo plano e aceita pagar a diferença (aceite registrado), cada dia de diária devida nessa acomodação, dentro
// do período da diferença, gera a cobrança do valor diário combinado na conta particular. Regras puras (sem banco):
// - só a diferença "aceita" cobra (a proposta, a recusada e a cancelada não; a encerrada vale até o fim);
// - o dia conta quando a diária principal do dia (cheia ou parcial) foi lançada na acomodação utilizada da diferença;
// - sem item faturável a diferença não é cobrada e volta como pendência para o faturista (nunca valor sem item);
// - a chave `diferenca:<id>` por dia torna a apuração idempotente, como a das diárias.
import type { LancamentoDesejado } from './admissao.js';

export type SituacaoDiferenca = 'proposta' | 'aceita' | 'recusada' | 'encerrada' | 'cancelada';

export interface DiferencaAcomodacao {
  readonly id: number;
  readonly direito: number;
  readonly utilizada: number;
  readonly item: number | null;
  readonly valorDiario: number;
  /** AAAA-MM-DD. */
  readonly inicio: string;
  readonly fim: string | null;
  readonly situacao: SituacaoDiferenca;
  readonly aceite: boolean;
}

export interface CobrancaDiferenca {
  readonly devidos: readonly LancamentoDesejado[];
  readonly pendencias: readonly { readonly diferenca: number; readonly motivo: 'sem-item' }[];
}

/** Recusa na hora a diferença incoerente (mesma acomodação, valor negativo, período invertido, aceita sem aceite). */
export function validarDiferenca(d: DiferencaAcomodacao): string | null {
  if (d.direito === d.utilizada) return 'A acomodação utilizada é a mesma de direito: não há diferença.';
  if (!(d.valorDiario >= 0)) return 'O valor diário da diferença não pode ser negativo.';
  if (d.fim !== null && d.fim < d.inicio) return 'O fim da diferença é anterior ao início.';
  if (d.situacao === 'aceita' && !d.aceite) return 'A diferença só é aceita com o aceite do paciente.';
  return null;
}

/** As cobranças de diferença devidas a partir das diárias principais devidas do período. */
export function cobrancasDeDiferenca(
  diarias: readonly LancamentoDesejado[],
  diferencas: readonly DiferencaAcomodacao[],
): CobrancaDiferenca {
  const devidos: LancamentoDesejado[] = [];
  const pendencias: { diferenca: number; motivo: 'sem-item' }[] = [];
  const principais = diarias.filter((x) => x.chave === 'diaria' || x.chave === 'diaria-parcial');
  for (const d of diferencas) {
    if ((d.situacao !== 'aceita' && d.situacao !== 'encerrada') || !d.aceite) continue;
    if (validarDiferenca(d)) continue;
    const dias = principais.filter(
      (x) => x.categoriaAcomodacao === d.utilizada && x.dia >= d.inicio && (d.fim === null || x.dia <= d.fim),
    );
    if (dias.length === 0) continue;
    if (d.item === null) {
      pendencias.push({ diferenca: d.id, motivo: 'sem-item' });
      continue;
    }
    for (const x of dias)
      devidos.push({
        chave: `diferenca:${d.id}`,
        dia: x.dia,
        hora: x.hora,
        item: d.item,
        grupo: null,
        quantidade: 1,
        valorFixo: d.valorDiario,
        categoriaAcomodacao: d.utilizada,
        regraDiaria: null,
        regraLancamento: null,
        regraItem: null,
        tabelaPreco: null,
      });
  }
  return { devidos, pendencias };
}
