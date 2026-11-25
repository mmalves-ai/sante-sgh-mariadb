// Registro único da impressão da prescrição no banco próprio (01-ADM L82): cada via impressa (a 1ª com a
// justificativa, as seguintes com o motivo) entra em exportacao_documento com quem imprimiu, quando, o paciente, o
// atendimento e o resumo (SHA-256) do PDF entregue, com a trilha na mesma transação. A regra (1ª via é impressão,
// as seguintes reimpressão, texto obrigatório) é do domínio (registroDaVia); aqui só a gravação. Nada é apagado.
import { randomUUID } from 'node:crypto';
import { registroDaVia } from '@sgh/dominio-pep';
import { definirOperacao, ErroOperacao, type Executor, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPrescricao } from './prescricao-porta.js';

/** A via da prescrição que acabou de ser emitida. */
export interface ImpressaoPrescricaoRegistrada {
  readonly paciente: number;
  readonly prescricao: number;
  /** Número da via emitida (1 = a primeira). */
  readonly via: number;
  /** A justificativa da 1ª via ou o motivo da nova via. */
  readonly justificativa: string;
  /** SHA-256 do PDF entregue, quando a emissão o calcula. */
  readonly hash?: string | null;
}

/** O que esta gravação usa do NucleoProprio (os testes trocam). */
export interface NucleoImpressaoPrescricao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const OPERACAO = 'pep.prescricao.impressao-registrar';

const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Impressão não registrada', detalhe);

/** A linha do registro único, dentro da transação: a prescrição é do paciente e do estabelecimento da sessão. */
export async function gravarImpressaoDaPrescricao(
  tx: TxOperacao,
  estabelecimento: number,
  usuario: number,
  e: ImpressaoPrescricaoRegistrada,
): Promise<number> {
  const reg = registroDaVia({ via: e.via, texto: e.justificativa, primeiraViaPedeTexto: true });
  if (!reg.ok)
    throw recusar(
      400,
      reg.codigo,
      reg.codigo === 'motivo-obrigatorio'
        ? 'Informe o motivo da nova via.'
        : 'Informe a justificativa da impressão.',
    );
  const p = await tx.uma(
    `SELECT id, atendimento_id FROM prescricao
      WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [e.prescricao, e.paciente, estabelecimento],
  );
  if (!p)
    throw recusar(404, 'registro-inexistente', 'A prescrição não foi encontrada neste estabelecimento.');
  const hash = (e.hash ?? '').toLowerCase();
  return tx.incluir('exportacao_documento', {
    estabelecimento_id: estabelecimento,
    entidade: 'prescricao',
    entidade_id: e.prescricao,
    paciente_id: e.paciente,
    atendimento_id: Number(p['atendimento_id']),
    tipo_operacao: reg.operacao,
    formato: 'pdf',
    destino: 'download',
    justificativa: reg.justificativa,
    hash_sha256: /^[0-9a-f]{64}$/.test(hash) ? hash : null,
    dados: JSON.stringify({ via: e.via }),
    ocorrido_em: new Date(),
    usuario_id: usuario,
  });
}

export class ImpressaoPrescricaoPropria {
  private executorCriado: Executor | null = null;

  constructor(
    private readonly nucleo: NucleoImpressaoPrescricao,
    /** Cliente desta API (um banco por cliente), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
  ) {}

  private get executor(): Executor {
    this.executorCriado ??= this.nucleo.criarExecutor();
    return this.executorCriado;
  }

  /** Grava a via impressa no registro único; devolve o id da linha. */
  async registrarImpressao(
    c: ContextoPrescricao,
    login: string,
    e: ImpressaoPrescricaoRegistrada,
  ): Promise<number> {
    const cliente = c.cliente || this.cliente;
    const ident = await this.nucleo.lerSomente({ cliente, correlacao: OPERACAO }, async (l) => {
      const est = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]);
      const u = await l.uma(
        `SELECT id FROM usuario WHERE excluido_em IS NULL AND ${c.usuario !== null ? 'id = ?' : 'login = ?'}`,
        [c.usuario ?? login],
      );
      return { est: est ? Number(est['id']) : null, usuario: u ? Number(u['id']) : null };
    });
    if (ident.est === null)
      throw recusar(
        404,
        'estabelecimento-inexistente',
        'O estabelecimento da sessão não existe neste cliente.',
      );
    if (ident.usuario === null)
      throw recusar(409, 'usuario-inexistente', 'O usuário da sessão não existe neste cliente.');
    const est = ident.est;
    const usuario = ident.usuario;
    let id: number | null = null;
    const op = definirOperacao({
      nome: OPERACAO,
      tabelas: ['exportacao_documento'],
      entrada: z.object({ prescricao: z.number(), via: z.number() }).strict(),
      gravar: async (tx: TxOperacao) => {
        id = await gravarImpressaoDaPrescricao(tx, est, usuario, e);
        return { id };
      },
      alvo: (_e, s) => ({ tabela: 'exportacao_documento', id: Number(s['id']) }),
      trilha: () => ({ motivo: e.justificativa.trim().slice(0, 500) }),
    });
    await this.executor.executar(
      op,
      cliente,
      { prescricao: e.prescricao, via: e.via },
      {
        cliente,
        estabelecimento: est,
        usuario,
        correlacao: (c.correlacao || OPERACAO).slice(0, 64),
        chaveIdempotencia: `${OPERACAO}:${randomUUID()}`.slice(0, 80),
      },
    );
    if (id === null) throw new Error(`A operação ${OPERACAO} terminou sem resultado.`);
    return id;
  }
}
