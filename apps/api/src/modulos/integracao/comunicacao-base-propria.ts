// Base das portas próprias da F3.9-6 (mensagens ao paciente, pacotes de parceiros e classificação externa): leitura
// pelo estabelecimento da sessão e gravação pelo executor (trilha da operação), SQL parametrizado.
import { randomUUID } from 'node:crypto';
import { fusoEmMinutos } from '@sgh/dominio-integracao';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

export interface NucleoComunicacao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** O contexto da sessão (o mesmo de `sessaoDe(req).porta`). */
export interface ContextoComunicacao {
  readonly cliente: string;
  readonly hospital: string;
  readonly usuario: number | null;
  readonly correlacao: string;
}

export interface ErroDeRegra {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

export const num = (v: unknown): number => Number(v);
export const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const txtOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
export const bool = (v: unknown): boolean => Boolean(Number(v));
export const dataOuNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

export function entradaValida<T>(esq: z.ZodType<T>, entrada: unknown): T {
  const r = esq.safeParse(entrada);
  if (!r.success)
    throw new ErroOperacao(400, 'entrada-invalida', 'Entrada inválida', 'Confira os campos indicados.', {
      campos: r.error.issues.map((i) => i.path.map(String).join('.')),
    });
  return r.data;
}

export function recusa(erros: readonly ErroDeRegra[], titulo = 'Recusado'): ErroOperacao {
  return new ErroOperacao(422, erros[0]!.codigo, titulo, erros.map((e) => e.mensagem).join(' '), {
    campos: erros.map((e) => e.campo),
  });
}

export const conflito = () =>
  new ErroOperacao(
    409,
    'conflito-versao',
    'Gravado por outra pessoa',
    'O cadastro foi alterado por outra pessoa enquanto você editava. Releia e grave de novo.',
  );

export const naoEncontrado = (o: string) =>
  new ErroOperacao(404, 'nao-encontrado', 'Não encontrado', `${o} não encontrado.`);

/** O fuso do estabelecimento (nome IANA gravado no cadastro) em minutos no instante dado. */
export async function fusoDoEstabelecimento(
  db: { uma: (sql: string, p: unknown[]) => Promise<Record<string, unknown> | null> },
  est: number,
  agora: Date,
): Promise<number> {
  const e = await db.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return fusoEmMinutos(txtOuNull(e?.['fuso_horario']), agora);
}

export class BaseComunicacaoPropria {
  protected readonly executor: Executor;

  constructor(
    protected readonly nucleo: NucleoComunicacao,
    protected readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  protected banco(c: ContextoComunicacao): string {
    return c.cliente || this.cliente;
  }

  protected ler<T>(
    c: ContextoComunicacao,
    rotulo: string,
    fn: (l: Leitor, est: number) => Promise<T>,
  ): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.banco(c), correlacao: `integracao.${rotulo}` },
      async (l) => {
        const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
          c.hospital,
        ]);
        if (!e) throw naoEncontrado('Estabelecimento');
        return fn(l, num(e['id']));
      },
    );
  }

  protected async gravar<T>(
    c: ContextoComunicacao,
    nome: string,
    tabelas: readonly string[],
    fn: (tx: TxOperacao, est: number, usuario: number) => Promise<{ id: number } & T>,
  ): Promise<{ id: number } & T> {
    if (c.usuario === null)
      throw new ErroOperacao(
        403,
        'usuario-inexistente',
        'Operação recusada',
        'A sessão não tem usuário neste cliente.',
      );
    const usuario = c.usuario;
    const est = await this.ler(c, 'identidade', async (_l, e) => e);
    const contexto: ContextoOperacao = {
      cliente: this.banco(c),
      estabelecimento: est,
      usuario,
      correlacao: (c.correlacao || nome).slice(0, 64),
      chaveIdempotencia: `${nome}:${randomUUID()}`,
    };
    let feito: ({ id: number } & T) | null = null;
    const op = definirOperacao({
      nome,
      tabelas: [...tabelas],
      entrada: z.object({}).strict(),
      gravar: async (tx: TxOperacao) => {
        feito = await fn(tx, est, usuario);
        return { tabela: tabelas[0]!, id: feito.id };
      },
      alvo: (_e, s) => ({ tabela: String(s['tabela']), id: Number(s['id']) }),
    });
    await this.executor.executar(op, this.banco(c), {}, contexto);
    if (feito === null) throw new Error(`A operação ${nome} terminou sem resultado.`);
    return feito;
  }
}
