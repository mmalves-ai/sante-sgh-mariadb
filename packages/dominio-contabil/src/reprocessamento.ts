// Regra 2, segunda metade, e o `pnpm contabil:reprocessar -- --periodo=<p>` (Desvio da fase, convencoes.md §13):
// reprocessar um período ABERTO dá lançamentos idênticos aos da primeira execução. A comparação é pela chave do
// lançamento (fato + impressão + versão da regra) e pelo conteúdo das partidas, com as parcelas para o relatório.
import type {
  ContaPlano,
  FatoContabil,
  LancamentoGerado,
  PartidaGerada,
  RegraContabil,
} from '@sgh/contratos';
import { equilibrioDoPeriodo } from './partidas.js';
import type { ContextoAplicacao } from './regra.js';
import { contextoDeAplicacao, type ItemDeParaExportacao, simularRegra } from './registro.js';

export interface ComparacaoReprocessamento {
  readonly identico: boolean;
  readonly iguais: number;
  readonly diferentes: readonly string[];
  readonly soNaPrimeira: readonly string[];
  readonly soNaSegunda: readonly string[];
  readonly totais: {
    readonly primeira: { readonly debitos: number; readonly creditos: number };
    readonly segunda: { readonly debitos: number; readonly creditos: number };
  };
}

const assinaturaDasPartidas = (l: { readonly partidas: readonly PartidaGerada[] }) =>
  l.partidas
    .map((p) => `${p.lado}|${p.conta}|${p.valorCentavos}|${p.centroCusto ?? ''}|${p.historico}`)
    .join('\n');

export function compararReprocessamento(
  primeira: readonly LancamentoGerado[],
  segunda: readonly LancamentoGerado[],
): ComparacaoReprocessamento {
  const a = new Map(primeira.map((l) => [l.chave, l]));
  const b = new Map(segunda.map((l) => [l.chave, l]));
  const diferentes: string[] = [];
  const soNaPrimeira: string[] = [];
  const soNaSegunda: string[] = [];
  let iguais = 0;
  for (const [k, l] of a) {
    const m = b.get(k);
    if (!m) soNaPrimeira.push(k);
    else if (assinaturaDasPartidas(l) !== assinaturaDasPartidas(m) || l.data !== m.data) diferentes.push(k);
    else iguais += 1;
  }
  for (const k of b.keys()) if (!a.has(k)) soNaSegunda.push(k);
  const ea = equilibrioDoPeriodo(primeira);
  const eb = equilibrioDoPeriodo(segunda);
  return {
    identico: diferentes.length === 0 && soNaPrimeira.length === 0 && soNaSegunda.length === 0,
    iguais,
    diferentes: diferentes.sort(),
    soNaPrimeira: soNaPrimeira.sort(),
    soNaSegunda: soNaSegunda.sort(),
    totais: {
      primeira: { debitos: ea.debitos, creditos: ea.creditos },
      segunda: { debitos: eb.debitos, creditos: eb.creditos },
    },
  };
}

/** Os lançamentos gravados dos fatos (pelo ID do fato), só com as partidas (a forma de `lancamentosDosFatosSgh`). */
export type LancamentosGravados = ReadonlyMap<number, { readonly partidas: readonly PartidaGerada[] }>;

/**
 * A derivação de hoje frente ao que está gravado (desde a F2 a "primeira execução" grava lançamentos): para cada fato
 * contabilizado da competência que não é estorno (o estorno inverte o lançamento do original, não aplica regra), as
 * partidas que as regras publicadas dão agora contra as do lançamento gravado (chave `fato:<id>`).
 */
export interface ComparacaoComGravado {
  readonly comparados: number;
  readonly iguais: number;
  /** As regras dão hoje outras partidas (por exemplo, regra republicada depois da contabilização), ou nenhuma. */
  readonly diferentes: number;
  /** Fato "contabilizado" sem lançamento gravado (nunca deveria acontecer). */
  readonly semLancamento: number;
}

type FatoComSituacao = FatoContabil & { readonly idFato?: number; readonly situacao?: string };

export function compararComGravado(
  fatos: readonly FatoComSituacao[],
  regras: readonly RegraContabil[],
  ctx: ContextoAplicacao,
  gravados: LancamentosGravados,
): ComparacaoComGravado {
  let comparados = 0;
  let iguais = 0;
  let diferentes = 0;
  let semLancamento = 0;
  for (const f of fatos) {
    if (f.situacao !== 'contabilizado' || f.estorno || f.idFato === undefined) continue;
    comparados++;
    const g = gravados.get(f.idFato);
    if (!g) {
      semLancamento++;
      continue;
    }
    const agora = simularRegra([f], regras, ctx, 0).todos[0];
    if (agora && assinaturaDasPartidas(agora) === assinaturaDasPartidas(g)) iguais++;
    else diferentes++;
  }
  return { comparados, iguais, diferentes, semLancamento };
}

/** Uma leitura do período (fatos, plano, de-para da exportação e regras publicadas), como o reprocessamento a faz. */
export interface LeituraDoPeriodo {
  readonly fatos: readonly FatoContabil[];
  readonly plano: readonly ContaPlano[];
  readonly dePara: readonly ItemDeParaExportacao[];
  readonly regras: readonly RegraContabil[];
  readonly parcial: boolean;
  /** Os lançamentos gravados dos fatos contabilizados (a conferência compara a derivação com eles). */
  readonly gravados?: LancamentosGravados;
}

export interface ResultadoConferencia {
  readonly fatos: number;
  readonly parcial: boolean;
  readonly identico: boolean;
  readonly iguais: number;
  readonly diferentes: number;
  readonly lancamentos: { readonly primeira: number; readonly segunda: number };
  /** A derivação frente aos lançamentos gravados (nula quando a leitura não os trouxe). */
  readonly gravado: ComparacaoComGravado | null;
  readonly totais: {
    readonly primeira: { readonly debitos: number; readonly creditos: number };
    readonly segunda: { readonly debitos: number; readonly creditos: number };
  };
}

/** Aplica as regras de uma leitura (puro). Os fatos substituídos não contam (a mesma regra da tela). */
export function aplicarLeitura(l: LeituraDoPeriodo) {
  const fatos = l.fatos.filter((f) => (f as { situacao?: string }).situacao !== 'substituido');
  return simularRegra(fatos, l.regras, contextoDeAplicacao(l.plano, l.dePara), 0);
}

/**
 * Compara as duas execuções (puro): idêntico só com as duas leituras inteiras, os mesmos lançamentos e, quando a
 * leitura traz os gravados, a derivação igual a eles em todo fato contabilizado (correção da revisão do M54.2: desde a
 * F2 a primeira execução é a gravada). É a rotina do `pnpm contabil:reprocessar` e da integração na cópia.
 */
export function conferirExecucoes(a: LeituraDoPeriodo, b: LeituraDoPeriodo): ResultadoConferencia {
  const x = aplicarLeitura(a);
  const y = aplicarLeitura(b);
  const c = compararReprocessamento(x.todos, y.todos);
  const diferentes = c.diferentes.length + c.soNaPrimeira.length + c.soNaSegunda.length;
  const gravado = a.gravados
    ? compararComGravado(a.fatos, a.regras, contextoDeAplicacao(a.plano, a.dePara), a.gravados)
    : null;
  const igualAoGravado = !gravado || (gravado.diferentes === 0 && gravado.semLancamento === 0);
  return {
    fatos: x.fatos,
    parcial: a.parcial || b.parcial,
    identico: c.identico && x.fatos === y.fatos && !a.parcial && !b.parcial && igualAoGravado,
    iguais: c.iguais,
    diferentes,
    lancamentos: { primeira: x.todos.length, segunda: y.todos.length },
    gravado,
    totais: c.totais,
  };
}
