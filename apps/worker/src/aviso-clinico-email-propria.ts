// Despacho por e-mail do aviso clínico (F3.3, 03-PEP L133), leitura e gravação no banco do cliente: os destinatários
// do canal 'email' ainda pendentes (aviso_clinico_destinatario, gravados pela central de regras na transação do evento)
// e a marca do resultado da entrega (enviado com a hora, ou falha com o motivo curto, nunca o endereço). Só o endereço
// da conta do destinatário é lido, para o envio; nada do aviso além do número e da prioridade sai para o e-mail.
import { randomUUID } from 'node:crypto';
import { definirOperacao, type Executor, type Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import { type AlvoEstabelecimento, estabelecimentosAtivos, type NucleoWorker } from './servico-worker.js';

export interface DestinoEmailAviso {
  readonly id: number;
  readonly versao: number;
  readonly aviso: number;
  readonly prioridade: string;
  /** O endereço da conta (null: a conta não tem e-mail). Nunca vai a log. */
  readonly para: string | null;
}

export type ResultadoEntregaAviso =
  { readonly enviado: true } | { readonly enviado: false; readonly erro: string };

export interface PortaAvisoClinicoEmail {
  estabelecimentos(): Promise<AlvoEstabelecimento[]>;
  pendentes(est: AlvoEstabelecimento, limite: number): Promise<DestinoEmailAviso[]>;
  marcar(est: AlvoEstabelecimento, d: DestinoEmailAviso, r: ResultadoEntregaAviso): Promise<boolean>;
}

const ENTRADA = z.object({
  estabelecimento: z.number().int().positive(),
  destinatario: z.number().int().positive(),
  versao: z.number().int().positive(),
  enviado: z.boolean(),
  erro: z.string().max(500).nullable(),
});

const MARCAR = definirOperacao<z.infer<typeof ENTRADA>, { marcado: boolean }>({
  nome: 'pep.aviso_clinico.email',
  tabelas: ['aviso_clinico_destinatario'],
  entrada: ENTRADA,
  gravar: async (tx, e) => {
    // A trava da linha serializa dois despachos: o segundo vê a linha já marcada e não marca de novo.
    const [d] = await tx.consultarParaAtualizar(
      `SELECT d.id, d.versao, d.situacao FROM aviso_clinico_destinatario d
         JOIN aviso_clinico a ON a.id = d.aviso_clinico_id AND a.estabelecimento_id = ?
        WHERE d.id = ? AND d.canal = 'email' AND d.excluido_em IS NULL`,
      [e.estabelecimento, e.destinatario],
      { teto: 1 },
    );
    if (!d || String(d['situacao']) !== 'pendente') return { marcado: false };
    await tx.alterar(
      'aviso_clinico_destinatario',
      e.destinatario,
      Number(d['versao']),
      e.enviado
        ? { situacao: 'enviado', enviado_em: new Date(), erro_envio: null }
        : { situacao: 'falha', erro_envio: e.erro },
    );
    return { marcado: true };
  },
  alvo: (e) => ({ tabela: 'aviso_clinico_destinatario', id: e.destinatario }),
});

export class PortaAvisoClinicoEmailPropria implements PortaAvisoClinicoEmail {
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
      { cliente: this.cliente, estabelecimento: est, correlacao: 'aviso-clinico-email' },
      fn,
    );
  }

  estabelecimentos(): Promise<AlvoEstabelecimento[]> {
    return this.ler(null, (l) => estabelecimentosAtivos(l, this.cliente));
  }

  pendentes(est: AlvoEstabelecimento, limite: number): Promise<DestinoEmailAviso[]> {
    return this.ler(est.id, async (l) =>
      (
        await l.consultar(
          `SELECT d.id, d.versao, a.id AS aviso, a.prioridade, u.email
             FROM aviso_clinico_destinatario d
             JOIN aviso_clinico a ON a.id = d.aviso_clinico_id AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
             LEFT JOIN usuario u ON u.id = d.usuario_id
            WHERE d.canal = 'email' AND d.situacao = 'pendente' AND d.excluido_em IS NULL
            ORDER BY d.id LIMIT 500`,
          [est.id],
          { teto: 500 },
        )
      )
        .slice(0, Math.max(1, limite))
        .map((r) => ({
          id: Number(r['id']),
          versao: Number(r['versao']),
          aviso: Number(r['aviso']),
          prioridade: String(r['prioridade']),
          para:
            r['email'] === null || r['email'] === undefined || String(r['email']).trim() === ''
              ? null
              : String(r['email']).trim(),
        })),
    );
  }

  async marcar(est: AlvoEstabelecimento, d: DestinoEmailAviso, r: ResultadoEntregaAviso): Promise<boolean> {
    const x = await this.executor.executar(
      MARCAR,
      this.cliente,
      {
        estabelecimento: est.id,
        destinatario: d.id,
        versao: d.versao,
        enviado: r.enviado,
        erro: r.enviado ? null : r.erro.slice(0, 500),
      },
      {
        cliente: this.cliente,
        estabelecimento: est.id,
        usuario: null,
        correlacao: `aviso-email-${d.id}`.slice(0, 64),
        chaveIdempotencia: `worker.aviso_clinico.email.${d.id}.${randomUUID()}`,
      },
    );
    return x.resultado.marcado;
  }
}
