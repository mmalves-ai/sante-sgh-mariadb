// Porta própria da rotina diária de efetivação dos cancelamentos de contrato de plano vencidos (08-SGO L94, C2-108):
// por estabelecimento em atividade, lê os pedidos solicitados ou agendados com a data de efeito alcançada e efetiva cada
// um numa operação própria (trilha e idempotência do executor), pela mesma porta de persistência da API
// (@sgh/persistencia: efetivarCancelamentoContrato) com as regras do domínio (podeEfetivarCancelamento e
// motivoDaBaixa): o contrato encerra, cada beneficiário vigente recebe a baixa cadastral com o movimento de exclusão e o
// crédito ao contratante vira crédito de fatura em aberto. O pedido que a regra recusa fica na lista de recusados, com
// o código, sem travar os demais. Nada se apaga.
import { randomUUID } from 'node:crypto';
import { motivoDaBaixa, podeEfetivarCancelamento } from '@sgh/dominio-operadora';
import { definirOperacao, ErroOperacao, type Executor, type Leitor } from '@sgh/nucleo';
import {
  cancelamentosVencidos,
  efetivarCancelamentoContrato,
  type RegrasEfetivacao,
  TABELAS_EFETIVACAO_CANCELAMENTO,
} from '@sgh/persistencia';
import { z } from 'zod';
import { type AlvoEstabelecimento, estabelecimentosAtivos, type NucleoWorker } from './servico-worker.js';

export const OPERACAO_EFETIVAR_CANCELAMENTO = 'operadora.cancelamento.efetivar';

const REGRAS: RegrasEfetivacao = { podeEfetivar: podeEfetivarCancelamento, motivoDaBaixa };

const ENTRADA = z.object({ estabelecimento: z.number().int().positive(), id: z.number().int().positive() });

const EFETIVAR = definirOperacao<z.infer<typeof ENTRADA>, { id: number; baixados: number }>({
  nome: OPERACAO_EFETIVAR_CANCELAMENTO,
  tabelas: [...TABELAS_EFETIVACAO_CANCELAMENTO],
  entrada: ENTRADA,
  gravar: async (tx, e) => {
    const h = await tx.uma<{ hoje: unknown }>("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS hoje");
    const hoje = String(h?.['hoje'] ?? new Date().toISOString().slice(0, 10));
    return efetivarCancelamentoContrato(tx, e.estabelecimento, e.id, hoje, REGRAS);
  },
  alvo: (_e, r) => ({ tabela: 'cancelamento_contrato_plano', id: r.id }),
});

export interface ResultadoEfetivacao {
  readonly efetivados: readonly number[];
  readonly baixados: number;
  readonly recusados: readonly { id: number; codigo: string }[];
}

export interface PortaCancelamentoContrato {
  readonly cliente: string;
  estabelecimentos(): Promise<AlvoEstabelecimento[]>;
  vencidos(est: AlvoEstabelecimento): Promise<number[]>;
  efetivar(est: AlvoEstabelecimento, id: number): Promise<{ id: number; baixados: number }>;
}

export class PortaCancelamentoContratoPropria implements PortaCancelamentoContrato {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoWorker,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(est: number | null, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, estabelecimento: est, correlacao: 'cancelamento-contrato' },
      fn,
    );
  }

  estabelecimentos(): Promise<AlvoEstabelecimento[]> {
    return this.ler(null, (l) => estabelecimentosAtivos(l, this.cliente));
  }

  vencidos(est: AlvoEstabelecimento): Promise<number[]> {
    return this.ler(est.id, (l) => cancelamentosVencidos(l, est.id));
  }

  async efetivar(est: AlvoEstabelecimento, id: number): Promise<{ id: number; baixados: number }> {
    const r = await this.executor.executar(
      EFETIVAR,
      this.cliente,
      { estabelecimento: est.id, id },
      {
        cliente: this.cliente,
        estabelecimento: est.id,
        usuario: null,
        correlacao: `cancelamento-${est.codigo}-${id}`.slice(0, 64),
        chaveIdempotencia: `worker.cancelamento.${est.id}.${id}.${randomUUID()}`,
      },
    );
    return r.resultado;
  }
}

/** A volta de um estabelecimento: efetiva cada vencido; o recusado pela regra fica com o código, sem travar os demais. */
export async function efetivarVencidosDoEstabelecimento(
  porta: PortaCancelamentoContrato,
  est: AlvoEstabelecimento,
): Promise<ResultadoEfetivacao> {
  const efetivados: number[] = [];
  const recusados: { id: number; codigo: string }[] = [];
  let baixados = 0;
  for (const id of await porta.vencidos(est)) {
    try {
      const r = await porta.efetivar(est, id);
      efetivados.push(id);
      baixados += r.baixados;
    } catch (e) {
      if (!(e instanceof ErroOperacao)) throw e;
      recusados.push({ id, codigo: String(e.problema.codigo ?? 'erro') });
    }
  }
  return { efetivados, baixados, recusados };
}
