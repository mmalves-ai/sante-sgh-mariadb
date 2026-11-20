// Contabilização dos fatos pelo `worker` (M54.2; ficha, regras 1, 3 e 5): depois de cada ciclo da leitura incremental,
// os fatos pendentes do estabelecimento viram lançamentos (o plano é o do domínio, `planoDaContabilizacao`; a leitura e
// a gravação são as do legado, `acessoContabilizacao`, as mesmas da rota "Contabilizar" da tela). Cada lote vai numa
// transação SGH_ só, com o evento `contabil.fatos.contabilizados` na SGH_TRILHA (usuário `SGH.CONTABIL`). O worker só
// contabiliza os pendentes: os sem regra e os sem conta voltam quando alguém corrige a regra ou o de-para e pede na
// tela. Há um teto de lotes por ciclo (o resto fica para o ciclo seguinte, 5 minutos depois).
import { LOTE_CONTABILIZACAO } from '@sgh/contratos';
import { contextoDeAplicacao, planoDaContabilizacao, resumoDaContabilizacao } from '@sgh/dominio-contabil';
import type { AcessoContabilizacao } from '@sgh/legado';

/** Lotes por ciclo do worker (500 fatos cada). */
export const LOTES_POR_CICLO = 10;

export interface ResumoContabilizacao {
  readonly fatos: number;
  readonly lancamentos: number;
  readonly semRegra: number;
  readonly semConta: number;
  readonly movidos: number;
  /** Fatos que outra gravação mudou entre a leitura e a do worker (ficaram como estavam; D-CORRIDA-542). */
  readonly mudaram: number;
  readonly lotes: number;
  readonly restam: boolean;
}

/** Contabiliza os fatos pendentes de uma empresa, lote a lote, até não restar nenhum ou chegar ao teto de lotes. */
export async function contabilizarPendentes(
  acesso: AcessoContabilizacao,
  c: {
    readonly empresa: number;
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
    const lido = await acesso.ler(c.empresa, ['pendente'], competencia, lote);
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
    const diferenca = `fatos=${lido.candidatos.length};lancamentos=${r.lancamentos};movidos=${r.movidos};semRegra=${r.porSituacao.semRegra};semConta=${r.porSituacao.semConta};debitos=${r.debitos};creditos=${r.creditos}`;
    const g = await acesso.gravar(c.empresa, competencia, acoes, diferenca);
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
