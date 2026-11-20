// Regra 1 do M33: a regra mais específica vence (profissional, procedimento, especialidade, ato, local, unidade,
// centro de custo, cooperativa, tipo de lançamento, tipo de conta, convênio); no empate, a vigência mais recente que
// já começou na data do item; por fim, o maior ID (determinístico). A ordem das dimensões é DIMENSOES_REGRA e é
// conferida contra as apurações gravadas no teste dourado (a validar com o setor).
import { DIMENSOES_REGRA, type DimensaoRegra } from '@sgh/contratos';
import type { ItemProducao, RegraRepasse } from './regra.js';

export type MotivoIgnorada =
  | 'fora-da-vigencia'
  | 'outro-profissional'
  | 'outro-procedimento'
  | 'outra-dimensao'
  | 'outro-tipo-de-conta'
  | 'fora-do-horario'
  | 'menos-especifica';

export interface RegraIgnorada {
  readonly regra: number;
  readonly motivo: MotivoIgnorada;
  readonly dimensao?: DimensaoRegra;
}

export interface ResolucaoRegra {
  readonly regra: RegraRepasse | null;
  /** Dimensões que a regra escolhida fixa (para a memória de cálculo). */
  readonly dimensoes: readonly DimensaoRegra[];
  readonly ignoradas: readonly RegraIgnorada[];
}

type Simples = Exclude<DimensaoRegra, 'profissional' | 'procedimento' | 'tipoConta'>;
const SIMPLES: readonly Simples[] = [
  'especialidade',
  'ato',
  'local',
  'unidade',
  'centroCusto',
  'cooperativa',
  'tipoLancamento',
  'convenio',
];

function naHora(r: RegraRepasse, hora: string): boolean {
  return hora >= r.horaInicial && hora <= r.horaFinal;
}

/** Por que a regra não vale para o item (null: vale). */
export function motivoNaoAplica(
  r: RegraRepasse,
  item: ItemProducao,
): { motivo: MotivoIgnorada; dimensao?: DimensaoRegra } | null {
  if (r.vigencia > item.data) return { motivo: 'fora-da-vigencia' };
  if (r.profissional !== null && r.profissional !== item.executante)
    return { motivo: 'outro-profissional', dimensao: 'profissional' };
  if (r.procedimentoInicial !== null) {
    const fim = r.procedimentoFinal ?? r.procedimentoInicial;
    if (item.procedimento < r.procedimentoInicial || item.procedimento > Math.max(fim, r.procedimentoInicial))
      return { motivo: 'outro-procedimento', dimensao: 'procedimento' };
  }
  for (const d of SIMPLES) {
    const v = r[d];
    if (v !== null && v !== item[d]) return { motivo: 'outra-dimensao', dimensao: d };
  }
  if (r.tipoConta !== 'A' && r.tipoConta !== item.tipoConta)
    return { motivo: 'outro-tipo-de-conta', dimensao: 'tipoConta' };
  if (!naHora(r, item.hora)) return { motivo: 'fora-do-horario' };
  return null;
}

/** Dimensões que a regra fixa, na ordem de DIMENSOES_REGRA. */
export function dimensoesFixadas(r: RegraRepasse): DimensaoRegra[] {
  return DIMENSOES_REGRA.filter((d) => {
    if (d === 'procedimento') return r.procedimentoInicial !== null;
    if (d === 'tipoConta') return r.tipoConta !== 'A';
    return r[d] !== null;
  });
}

/** Largura da faixa de procedimento (0: um só; sem procedimento: infinita). */
function larguraFaixa(r: RegraRepasse): number {
  if (r.procedimentoInicial === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, (r.procedimentoFinal ?? r.procedimentoInicial) - r.procedimentoInicial);
}

/** Compara duas regras que valem para o item: negativo se `a` vence. */
export function compararEspecificidade(a: RegraRepasse, b: RegraRepasse): number {
  const da = new Set(dimensoesFixadas(a));
  const db = new Set(dimensoesFixadas(b));
  for (const d of DIMENSOES_REGRA) {
    if (da.has(d) !== db.has(d)) return da.has(d) ? -1 : 1;
    if (d === 'procedimento' && da.has(d)) {
      const la = larguraFaixa(a);
      const lb = larguraFaixa(b);
      if (la !== lb) return la - lb;
    }
  }
  if (a.vigencia !== b.vigencia) return a.vigencia > b.vigencia ? -1 : 1;
  return b.id - a.id;
}

/** Escolhe a regra do item entre as candidatas (as do convênio e do beneficiário, lidas do legado). */
export function resolverRegra(item: ItemProducao, regras: readonly RegraRepasse[]): ResolucaoRegra {
  const ignoradas: RegraIgnorada[] = [];
  const validas: RegraRepasse[] = [];
  for (const r of regras) {
    const m = motivoNaoAplica(r, item);
    if (m) ignoradas.push({ regra: r.id, ...m });
    else validas.push(r);
  }
  if (validas.length === 0) return { regra: null, dimensoes: [], ignoradas };
  const [vence, ...resto] = [...validas].sort(compararEspecificidade);
  for (const r of resto) ignoradas.push({ regra: r.id, motivo: 'menos-especifica' });
  return { regra: vence!, dimensoes: dimensoesFixadas(vence!), ignoradas };
}
