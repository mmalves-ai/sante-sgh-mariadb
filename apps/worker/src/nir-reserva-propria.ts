// Porta própria da expiração das reservas de leito do NIR (M44, etapa 2; regra 11; `internacao.expirarReserva`; lote
// F2.2 05-15) sobre o banco do cliente, pelo @sgh/nucleo. Leitura (somente leitura, filtrada pelo estabelecimento e pelos
// excluídos): as reservas ativas ou confirmadas com a validade passada (reserva_leito). Gravação, uma operação do
// Executor por reserva (trilha na mesma transação): a reserva relida com trava sai da vigência (situação expirada,
// encerrada_em) e a solicitação de leito (pedido_leito) reservada ou a caminho volta à análise pela máquina de estados do
// domínio (transicao 'liberarReserva'), soltando a reserva.
// Melhoria: o relógio é um instante (ISO com fuso), não a hora local sem fuso; a condição (ainda vigente e vencida) é
// conferida na linha travada: o segundo consumidor não altera nada; a reserva de outro estabelecimento é recusada.
// Melhoria: a solicitação que volta à análise deixa de apontar a reserva expirada (pedido_leito.reserva_leito_id).
import { randomUUID } from 'node:crypto';
import { type EstadoSolicitacaoNir } from '@sgh/contratos';
import { transicao } from '@sgh/dominio-internacao';
import { definirOperacao, type Executor, type Leitor, recusa } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type AlvoEstabelecimento,
  conflitoConcorrente,
  estabelecimentosAtivos,
  type NucleoWorker,
} from './servico-worker.js';

export interface ReservaVencida {
  readonly id: number;
  /** A solicitação de leito da reserva (null: reserva sem solicitação, como a do agendamento). */
  readonly solicitacao: number | null;
  readonly leito: number;
  readonly validaAte: string;
}

export interface Expiracao {
  readonly expirou: boolean;
  /** A solicitação voltou à análise. */
  readonly voltouAnalise: boolean;
}

export interface PortaNir {
  estabelecimentos(): Promise<AlvoEstabelecimento[]>;
  vencidas(est: AlvoEstabelecimento, agora: Date): Promise<ReservaVencida[]>;
  /** expirou false: outro consumidor expirou antes, a reserva já saiu da vigência ou ainda vale. */
  expirar(est: AlvoEstabelecimento, reserva: number, agora: Date): Promise<Expiracao>;
}

const n = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

const ENTRADA = z.object({
  estabelecimento: z.number().int().positive(),
  reserva: z.number().int().positive(),
  agora: z.string().min(20),
});

export const MOTIVO_EXPIRACAO = 'Validade vencida';

export class PortaNirPropria implements PortaNir {
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
      { cliente: this.cliente, estabelecimento: est, correlacao: 'nir-expiracao' },
      fn,
    );
  }

  estabelecimentos(): Promise<AlvoEstabelecimento[]> {
    return this.ler(null, (l) => estabelecimentosAtivos(l, this.cliente));
  }

  vencidas(est: AlvoEstabelecimento, agora: Date): Promise<ReservaVencida[]> {
    return this.ler(est.id, async (l) =>
      (
        await l.consultar(
          `SELECT id, pedido_leito_id, leito_hospitalar_id, valida_ate FROM reserva_leito
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ('ativa', 'confirmada') AND valida_ate < ?
            ORDER BY valida_ate, id`,
          [est.id, agora],
          { teto: 5000 },
        )
      ).map((r) => ({
        id: n(r['id']),
        solicitacao:
          r['pedido_leito_id'] === null || r['pedido_leito_id'] === undefined
            ? null
            : n(r['pedido_leito_id']),
        leito: n(r['leito_hospitalar_id']),
        validaAte: iso(r['valida_ate']),
      })),
    );
  }

  async expirar(est: AlvoEstabelecimento, reserva: number, agora: Date): Promise<Expiracao> {
    const op = definirOperacao<z.infer<typeof ENTRADA>, { expirou: boolean; voltouAnalise: boolean }>({
      nome: 'internacao.expirar_reserva',
      tabelas: ['reserva_leito', 'pedido_leito'],
      entrada: ENTRADA,
      gravar: async (tx, e) => {
        const instante = new Date(e.agora);
        const [r] = await tx.consultarParaAtualizar(
          'SELECT id, versao, situacao, valida_ate, pedido_leito_id FROM reserva_leito WHERE id = ? AND excluido_em IS NULL',
          [e.reserva],
          { teto: 1 },
        );
        if (!r) throw recusa('reserva-inexistente', 'A reserva de leito não existe.');
        const daqui = await tx.uma('SELECT id FROM reserva_leito WHERE id = ? AND estabelecimento_id = ?', [
          e.reserva,
          e.estabelecimento,
        ]);
        if (!daqui)
          throw recusa('reserva-outro-estabelecimento', 'A reserva de leito é de outro estabelecimento.');
        const vigente = ['ativa', 'confirmada'].includes(String(r['situacao']));
        const validaAte =
          r['valida_ate'] instanceof Date ? r['valida_ate'] : new Date(String(r['valida_ate']));
        if (!vigente || validaAte.getTime() >= instante.getTime())
          return { expirou: false, voltouAnalise: false };
        await tx.alterar('reserva_leito', e.reserva, n(r['versao']), {
          situacao: 'expirada',
          encerrada_em: instante,
          motivo_encerramento: MOTIVO_EXPIRACAO,
        });
        const pedido = r['pedido_leito_id'];
        if (pedido === null || pedido === undefined) return { expirou: true, voltouAnalise: false };
        const [p] = await tx.consultarParaAtualizar(
          `SELECT pl.id, pl.versao, pl.reserva_leito_id, sp.estado
             FROM pedido_leito pl JOIN situacao_pedido_leito sp ON sp.id = pl.situacao_pedido_leito_id
            WHERE pl.id = ? AND pl.estabelecimento_id = ? AND pl.excluido_em IS NULL`,
          [n(pedido), e.estabelecimento],
          { teto: 1 },
        );
        if (!p || !transicao(String(p['estado']) as EstadoSolicitacaoNir, 'liberarReserva').ok)
          return { expirou: true, voltouAnalise: false };
        const s = await tx.uma(
          "SELECT id FROM situacao_pedido_leito WHERE estado = 'em_analise' AND ativo = TRUE ORDER BY ordem_exibicao, id LIMIT 1",
          [],
        );
        if (!s)
          throw recusa(
            'situacao-ausente',
            'O cadastro não tem a situação de pedido de leito "em análise" ativa.',
          );
        await tx.alterar('pedido_leito', n(p['id']), n(p['versao']), {
          situacao_pedido_leito_id: n(s['id']),
          ...(n(p['reserva_leito_id']) === e.reserva ? { reserva_leito_id: null } : {}),
        });
        return { expirou: true, voltouAnalise: true };
      },
      alvo: (e) => ({ tabela: 'reserva_leito', id: e.reserva }),
    });
    try {
      const r = await this.executor.executar(
        op,
        this.cliente,
        { estabelecimento: est.id, reserva, agora: agora.toISOString() },
        {
          cliente: this.cliente,
          estabelecimento: est.id,
          usuario: null,
          correlacao: `nir-expira-${reserva}`.slice(0, 64),
          chaveIdempotencia: `worker.nir.${reserva}.${randomUUID()}`,
        },
      );
      return r.resultado;
    } catch (x) {
      // A linha travada por outro consumidor: ele expira; este desiste sem esperar nem errar.
      if (conflitoConcorrente(x)) return { expirou: false, voltouAnalise: false };
      throw x;
    }
  }
}
