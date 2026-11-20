// Linha de base da onda 0 (ficha do M38, regra 4 e campo 11; cap-10 §10.11; cap-14 §14.5): compara o antes e o
// depois da liberação das operações-chave do Delphi (p95 por operação) e decide se a onda segue ou recolhe; e
// confere os SLIs do Sante SGH contra as metas da onda. Só números agregados, nenhum valor de linha.
import { METAS_ONDA_0 } from '@sgh/contratos';

export interface MedidaLinhaDeBase {
  /** p95 em ms de cada operação-chave do Delphi (nome estável da operação, sem dado). */
  readonly operacoesChaveP95Ms: Readonly<Record<string, number>>;
  /** Próxima − OIT no fim da janela (folga do coletor de lixo; MON$DATABASE). */
  readonly folgaOit: number;
}

export interface VariacaoOperacao {
  readonly operacao: string;
  readonly antesMs: number;
  readonly depoisMs: number;
  /** (depois − antes) / antes, em pontos percentuais com uma casa. */
  readonly variacaoPct: number;
  readonly acimaDoLimite: boolean;
}

export interface ComparacaoLinhaDeBase {
  readonly operacoes: readonly VariacaoOperacao[];
  /** Operações medidas só de um lado (a comparação fica incompleta: não decide pela onda). */
  readonly semPar: readonly string[];
  readonly folgaOitAntes: number;
  readonly folgaOitDepois: number;
  /** `recolher` se alguma operação-chave piorou acima do limite; `incompleta` se falta par; senão `segue`. */
  readonly decisao: 'segue' | 'recolher' | 'incompleta';
}

const umaCasa = (n: number) => Math.round(n * 10) / 10;

/**
 * Regra 4: "operações-chave do Delphi sem piora acima do limite acordado com a TI; piora acima do limite recolhe
 * a onda". `limitePct` é o limite acordado (proposta: 10, marcada "a aprovar" até a TI aceitar).
 */
export function compararLinhaDeBase(
  antes: MedidaLinhaDeBase,
  depois: MedidaLinhaDeBase,
  limitePct: number,
): ComparacaoLinhaDeBase {
  if (!Number.isFinite(limitePct) || limitePct < 0) throw new RangeError('limite de piora inválido');
  const a = antes.operacoesChaveP95Ms;
  const d = depois.operacoesChaveP95Ms;
  const nomes = [...new Set([...Object.keys(a), ...Object.keys(d)])].sort();
  const operacoes: VariacaoOperacao[] = [];
  const semPar: string[] = [];
  for (const op of nomes) {
    const x = a[op];
    const y = d[op];
    if (x === undefined || y === undefined || x <= 0) {
      semPar.push(op);
      continue;
    }
    const variacaoPct = umaCasa(((y - x) / x) * 100);
    operacoes.push({
      operacao: op,
      antesMs: x,
      depoisMs: y,
      variacaoPct,
      acimaDoLimite: variacaoPct > limitePct,
    });
  }
  const decisao = operacoes.some((o) => o.acimaDoLimite)
    ? 'recolher'
    : semPar.length > 0 || operacoes.length === 0
      ? 'incompleta'
      : 'segue';
  return {
    operacoes,
    semPar,
    folgaOitAntes: antes.folgaOit,
    folgaOitDepois: depois.folgaOit,
    decisao,
  };
}

export type SliOnda0 = keyof typeof METAS_ONDA_0;

/** SLIs medidos (p95 ou tempo do ciclo, em ms) que estouram a meta da onda; ausente não é conferido. */
export function slisForaDaMeta(medidos: Readonly<Partial<Record<SliOnda0, number>>>): SliOnda0[] {
  return (Object.keys(METAS_ONDA_0) as SliOnda0[]).filter((k) => {
    const v = medidos[k];
    return v !== undefined && v > METAS_ONDA_0[k];
  });
}
