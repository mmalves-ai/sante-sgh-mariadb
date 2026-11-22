// Contabilização dos fatos pelo `worker` (M54.2; lote F2.2 05-12): depois de cada ciclo, os fatos pendentes do
// estabelecimento viram lançamentos, lote a lote. O plano é o do domínio (`planoDaContabilizacao`); a leitura e a
// gravação vêm do `AcessoContabilizacao` (a porta do banco do cliente, `porta-propria.ts`, ou um dublê nos testes). O
// worker só contabiliza os pendentes: os sem regra e os sem conta voltam quando alguém corrige a regra ou o de-para e
// pede na tela. Há um teto de lotes por ciclo (o resto fica para o ciclo seguinte, 5 minutos depois).
// Melhoria: a "empresa" contábil é o estabelecimento do banco do cliente (id), sem número de empresa configurado à parte.
// Melhoria: a trilha leva só contagens (as parcelas do lote), nunca valores de pessoas.
import { LOTE_CONTABILIZACAO, type ContaPlano, type RegraContabil, type SituacaoFato } from '@sgh/contratos';
import {
  type AcaoContabilizacao,
  contextoDeAplicacao,
  type FatoCandidato,
  type ItemDeParaExportacao,
  type LancamentoDoFato,
  type PeriodoContabil,
  planoDaContabilizacao,
  resumoDaContabilizacao,
} from '@sgh/dominio-contabil';

/** Lotes por ciclo do worker (500 fatos cada). */
export const LOTES_POR_CICLO = 10;

/** O que a contabilização lê de uma vez para um lote de candidatos. */
export interface LeituraContabilizacao {
  readonly candidatos: readonly FatoCandidato[];
  /** Todos os fatos registrados das origens dos candidatos (o ativo e o original do estorno). */
  readonly registrados: readonly FatoCandidato[];
  /** Os lançamentos já gravados desses fatos, pelo id do fato. */
  readonly lancamentos: ReadonlyMap<number, LancamentoDoFato>;
  /** Há mais candidatos além deste lote. */
  readonly restam: boolean;
  readonly plano: readonly ContaPlano[];
  readonly dePara: readonly ItemDeParaExportacao[];
  /** As versões publicadas das regras de contabilização. */
  readonly publicadas: readonly { readonly id: number; readonly regra: RegraContabil }[];
  readonly periodos: readonly PeriodoContabil[];
}

/** O resultado da gravação de um lote. */
export interface GravacaoContabilizacao {
  readonly lancamentos: number;
  readonly repetidos: number;
  /** Fatos que outra gravação mudou entre a leitura e a do worker (ficam como estão). */
  readonly mudaram: number;
}

/** A leitura e a gravação da contabilização no banco do cliente (cada lote numa transação). */
export interface AcessoContabilizacao {
  ler(
    estabelecimento: number,
    situacoes: readonly SituacaoFato[],
    competencia: string | null,
    lote: number,
  ): Promise<LeituraContabilizacao>;
  gravar(
    estabelecimento: number,
    competencia: string | null,
    acoes: readonly AcaoContabilizacao[],
    diferenca: string,
  ): Promise<GravacaoContabilizacao>;
}

export interface ResumoContabilizacao {
  readonly fatos: number;
  readonly lancamentos: number;
  readonly semRegra: number;
  readonly semConta: number;
  readonly movidos: number;
  /** Fatos que outra gravação mudou entre a leitura e a do worker (ficaram como estavam). */
  readonly mudaram: number;
  readonly lotes: number;
  readonly restam: boolean;
}

/** As contagens do lote para a trilha (sem valor de pessoa). */
export function diferencaDoLote(fatos: number, r: ReturnType<typeof resumoDaContabilizacao>): string {
  return `fatos=${fatos};lancamentos=${r.lancamentos};movidos=${r.movidos};semRegra=${r.porSituacao.semRegra};semConta=${r.porSituacao.semConta};debitos=${r.debitos};creditos=${r.creditos}`;
}

/** Contabiliza os fatos pendentes de um estabelecimento, lote a lote, até não restar nenhum ou chegar ao teto. */
export async function contabilizarPendentes(
  acesso: AcessoContabilizacao,
  c: {
    readonly estabelecimento: number;
    readonly competencia?: string | null;
    readonly maxLotes?: number;
    readonly lote?: number;
  },
): Promise<ResumoContabilizacao> {
  const maxLotes = Math.max(1, c.maxLotes ?? LOTES_POR_CICLO);
  const lote = Math.max(1, c.lote ?? LOTE_CONTABILIZACAO);
  const competencia = c.competencia ?? null;
  const total = {
    fatos: 0,
    lancamentos: 0,
    semRegra: 0,
    semConta: 0,
    movidos: 0,
    mudaram: 0,
    lotes: 0,
    restam: false,
  };
  for (let i = 0; i < maxLotes; i++) {
    const lido = await acesso.ler(c.estabelecimento, ['pendente'], competencia, lote);
    if (lido.candidatos.length === 0) {
      total.restam = false;
      break;
    }
    const acoes = planoDaContabilizacao({
      candidatos: lido.candidatos,
      registrados: lido.registrados,
      lancamentos: lido.lancamentos,
      publicadas: lido.publicadas.map((p) => ({ id: p.id, regra: p.regra })),
      ctx: contextoDeAplicacao(lido.plano, lido.dePara),
      periodos: lido.periodos.map((p) => ({
        empresa: p.empresa,
        competencia: p.competencia,
        situacao: p.situacao,
      })),
    });
    const r = resumoDaContabilizacao(acoes);
    const g = await acesso.gravar(
      c.estabelecimento,
      competencia,
      acoes,
      diferencaDoLote(lido.candidatos.length, r),
    );
    total.mudaram += g.mudaram;
    total.fatos += lido.candidatos.length;
    total.lancamentos += r.lancamentos;
    total.semRegra += r.porSituacao.semRegra;
    total.semConta += r.porSituacao.semConta;
    total.movidos += r.movidos;
    total.lotes++;
    total.restam = lido.restam;
    if (!lido.restam) break;
  }
  return total;
}
