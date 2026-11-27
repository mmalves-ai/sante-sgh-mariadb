// Produção do repasse a partir da conta do paciente (F3, motores). A regra mora em @sgh/dominio-repasse
// (producao-conta.ts, sincronizarProducaoDaConta) e o SQL em @sgh/persistencia (repasse-producao/porta.ts): a API
// (lançar item, fechar conta, glosa e recurso da operadora, retorno da TISS) e o worker (glosa do financeiro) chamam a
// mesma sincronização, na transação de quem mudou a conta. Contrato de efeito: producao-conta.int.spec.ts e
// glosa-repasse.int.spec.ts. Nenhum gatilho.
import {
  type EventoProducao,
  type ResumoProducaoConta,
  sincronizarGlosaDoItem as sincronizarGlosaNaPorta,
  sincronizarProducaoDaConta as sincronizarNaPorta,
} from '@sgh/dominio-repasse';
import { definirOperacao, type ContextoOperacao, type ResultadoOperacao, type TxOperacao } from '@sgh/nucleo';
import { portaProducaoConta, TABELAS_PRODUCAO_CONTA } from '@sgh/persistencia';
import { z } from 'zod';
import { TABELAS_PUBLICACAO_FATO } from '../contabil/publicacao-fato.js';
import { publicarFatosDoRepasse } from './fato-contabil-repasse.js';

/** As tabelas da sincronização, mais as do fato contábil do crédito de glosa revertida (C2-093). */
// Nome próprio, sem alias de import: o gerador de privilégios segue a constante até a definição literal.
export const TABELAS_SINCRONIZACAO_PRODUCAO = [...TABELAS_PRODUCAO_CONTA, ...TABELAS_PUBLICACAO_FATO];
export type { ResumoProducaoConta };

/**
 * Sincroniza a produção do repasse com os itens da conta (todos, ou só os informados). Chamada na transação de quem
 * mudou a conta; o contexto traz o estabelecimento e o usuário da sessão.
 */
export function sincronizarProducaoDaConta(
  tx: TxOperacao,
  d: { readonly conta: number; readonly itens?: readonly number[]; readonly evento: EventoProducao },
  ctx: Pick<ContextoOperacao, 'estabelecimento' | 'usuario'>,
): Promise<ResumoProducaoConta> {
  return comFatoDosCreditos(tx, ctx, (porta) => sincronizarNaPorta(porta, d));
}

/**
 * Roda a sincronização na porta e publica, na mesma transação, o fato `repasse` dos créditos de glosa revertida que ela
 * lançou (C2-093; ADR 0003). O lançamento do crédito é um `lancamento_repasse` de ajuste, positivo.
 */
async function comFatoDosCreditos<R>(
  tx: TxOperacao,
  ctx: Pick<ContextoOperacao, 'estabelecimento' | 'usuario'>,
  sincronizar: (porta: ReturnType<typeof portaProducaoConta>) => Promise<R>,
): Promise<R> {
  const porta = portaProducaoConta(tx, ctx);
  const r = await sincronizar(porta);
  if (porta.creditosLancados.length > 0 && ctx.estabelecimento !== null)
    await publicarFatosDoRepasse(tx, ctx.estabelecimento, porta.creditosLancados);
  return r;
}

/**
 * A glosa do item mudou (decisão da TISS): o item guarda a soma das glosas aceitas (a mesma regra do worker,
 * glosadoAceitoDoItem no domínio) e a produção do repasse acompanha, na mesma transação.
 */
export function sincronizarGlosaDoItem(
  tx: TxOperacao,
  d: { readonly conta: number; readonly item: number },
  ctx: Pick<ContextoOperacao, 'estabelecimento' | 'usuario'>,
): Promise<ResumoProducaoConta & { readonly glosado: number }> {
  return comFatoDosCreditos(tx, ctx, (porta) => sincronizarGlosaNaPorta(porta, d));
}

export const esquemaSincronizarProducaoConta = z
  .object({
    conta: z.number().int().positive(),
    itens: z.array(z.number().int().positive()).max(5000).optional(),
    evento: z.enum(['lancamento', 'fechamento', 'mudanca-item']),
  })
  .strict();
export type SincronizarProducaoContaEntrada = z.infer<typeof esquemaSincronizarProducaoConta>;

/** A operação própria (tela de conferência do repasse, reprocessamento): a mesma sincronização numa transação. */
export const sincronizarProducaoConta = definirOperacao<SincronizarProducaoContaEntrada, ResultadoOperacao>({
  nome: 'repasse.sincronizar-producao-conta',
  tabelas: TABELAS_SINCRONIZACAO_PRODUCAO,
  entrada: esquemaSincronizarProducaoConta,
  async gravar(tx, e, ctx) {
    const r = await sincronizarProducaoDaConta(
      tx,
      { conta: e.conta, evento: e.evento, ...(e.itens ? { itens: e.itens } : {}) },
      ctx,
    );
    return {
      conta: e.conta,
      geradas: r.geradas,
      estornadas: r.estornadas,
      reduzidas: r.reduzidas,
      debitos: r.debitos,
      creditos: r.creditos,
      pendencias: Object.values(r.pendencias).reduce((a, b) => a + b, 0),
    };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.conta }),
});
