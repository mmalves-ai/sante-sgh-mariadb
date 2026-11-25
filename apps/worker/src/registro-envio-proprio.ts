// Registro geral de envio de e-mail (01-ADM L77) no banco do cliente, pelo @sgh/nucleo: a cada tentativa de entrega da
// fila `email-<cliente>` fica uma linha em envio_email (situação, tentativas, identificador da mensagem, erro) e uma em
// envio_email_destinatario (o endereço e o resultado dele), numa operação do Executor (trilha na mesma transação).
// - A tentativa seguinte da mesma entrega (mesmo identificador da mensagem, ainda em falha) atualiza a mesma linha e
//   soma a tentativa: o histórico mostra um envio com N tentativas, não N envios.
// - Fora de produção o aceite fica "capturado" (a mensagem só chegou à caixa de captura), nunca "enviado".
// - O erro guardado é o resumo do domínio (tipo e código de resposta): nunca endereço nem conteúdo.
// O servidor usado é o do ambiente (SMTP_URL), por isso servidor_email_id fica nulo.
import { randomUUID } from 'node:crypto';
import { resultadoDaTentativa, resumoDoErro } from '@sgh/dominio-acesso';
import { definirOperacao, type Executor } from '@sgh/nucleo';
import { z } from 'zod';
import type { NucleoWorker } from './servico-worker.js';

export const ENTIDADE_FILA_EMAIL = 'fila_email';

export interface TentativaDeEnvio {
  /** Código do estabelecimento do alerta (sem ele, ou desconhecido no cliente: envio sem estabelecimento). */
  readonly estabelecimento?: string | null;
  readonly remetente: string;
  readonly destinatario: string;
  readonly assunto: string;
  readonly corpo: string;
  /** Identificador da mensagem, o mesmo em todas as tentativas da entrega. */
  readonly identificador: string;
  /** O servidor aceitou a mensagem. */
  readonly aceito: boolean;
  readonly erro?: unknown;
}

// Tipo (não interface): o resultado da operação do Executor é um registro de valores simples.
export type EnvioRegistrado = {
  readonly envio: number;
  readonly situacao: string;
  readonly tentativas: number;
};

export interface RegistroEnvio {
  registrar(t: TentativaDeEnvio): Promise<EnvioRegistrado>;
}

const ENTRADA = z.object({
  estabelecimento: z.number().int().positive().nullable(),
  remetente: z.string().min(3).max(254),
  destinatario: z.string().min(3).max(254),
  assunto: z.string().min(1).max(255),
  corpo: z.string().max(200_000),
  identificador: z.string().min(3).max(255),
  aceito: z.boolean(),
  erro: z.string().max(1000).nullable(),
});

export class RegistroEnvioProprio implements RegistroEnvio {
  private readonly executor: Executor;

  private readonly op = definirOperacao<z.infer<typeof ENTRADA>, EnvioRegistrado>({
    nome: 'email.envio_registrar',
    tabelas: ['envio_email', 'envio_email_destinatario'],
    entrada: ENTRADA,
    gravar: async (tx, e) => {
      const agora = this.agora();
      // A tentativa anterior desta entrega, ainda em falha (travada: duas tentativas não somam a mesma contagem).
      const anterior = (
        await tx.consultarParaAtualizar(
          `SELECT id, versao, tentativas FROM envio_email
            WHERE situacao = 'falhou' AND identificador_mensagem = ? AND entidade = ?
            ORDER BY id DESC LIMIT 1`,
          [e.identificador, ENTIDADE_FILA_EMAIL],
          { teto: 1 },
        )
      )[0];
      const r = resultadoDaTentativa({
        aceito: e.aceito,
        producao: this.producao,
        tentativasAnteriores: anterior ? Number(anterior['tentativas']) : 0,
      });
      const resultado = {
        situacao: r.situacao,
        tentativas: r.tentativas,
        enviado_em: e.aceito ? agora : null,
        erro: e.aceito ? null : e.erro,
      };
      const doDestinatario = {
        situacao: r.situacaoDestinatario,
        resultado_em: agora,
        erro: e.aceito ? null : e.erro,
      };
      if (anterior) {
        const envio = Number(anterior['id']);
        await tx.alterar('envio_email', envio, Number(anterior['versao']), resultado);
        const d = await tx.uma(
          'SELECT id, versao FROM envio_email_destinatario WHERE envio_email_id = ? AND sequencia = 1',
          [envio],
        );
        if (d)
          await tx.alterar('envio_email_destinatario', Number(d['id']), Number(d['versao']), doDestinatario);
        return { envio, situacao: r.situacao, tentativas: r.tentativas };
      }
      const envio = await tx.incluir('envio_email', {
        estabelecimento_id: e.estabelecimento,
        remetente: e.remetente,
        assunto: e.assunto,
        corpo: e.corpo,
        entidade: ENTIDADE_FILA_EMAIL,
        identificador_mensagem: e.identificador,
        ocorrido_em: agora,
        ...resultado,
      });
      await tx.incluir('envio_email_destinatario', {
        envio_email_id: envio,
        sequencia: 1,
        tipo_destinatario: 'para',
        email: e.destinatario,
        ...doDestinatario,
      });
      return { envio, situacao: r.situacao, tentativas: r.tentativas };
    },
    alvo: (_e, r) => ({ tabela: 'envio_email', id: r.envio }),
  });

  constructor(
    private readonly nucleo: NucleoWorker,
    readonly cliente: string,
    private readonly producao: boolean,
    executor?: Executor,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  async registrar(t: TentativaDeEnvio): Promise<EnvioRegistrado> {
    const codigo = t.estabelecimento?.trim() || null;
    const estabelecimento = codigo
      ? await this.nucleo.lerSomente(
          { cliente: this.cliente, estabelecimento: null, correlacao: 'email-registro' },
          async (l) => {
            const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
              codigo,
            ]);
            return e ? Number(e['id']) : null;
          },
        )
      : null;
    const r = await this.executor.executar(
      this.op,
      this.cliente,
      {
        estabelecimento,
        remetente: t.remetente,
        destinatario: t.destinatario,
        assunto: t.assunto.slice(0, 255),
        corpo: t.corpo,
        identificador: t.identificador,
        aceito: t.aceito,
        erro: t.aceito ? null : resumoDoErro(t.erro),
      },
      {
        cliente: this.cliente,
        estabelecimento,
        usuario: null,
        correlacao: 'email-registro',
        chaveIdempotencia: `worker.email.${randomUUID()}`,
      },
    );
    return r.resultado;
  }
}
