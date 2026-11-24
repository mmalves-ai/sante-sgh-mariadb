// Base das portas próprias pequenas (F3.4: gases medicinais e texto padrão da cirurgia), sobre o banco do cliente pelo
// @sgh/nucleo: a leitura no estabelecimento da sessão e a gravação pelo executor (trilha da operação na mesma
// transação), com o usuário da sessão. SQL parametrizado; nada aqui conhece regra de negócio.
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

export interface NucleoPortaPropria {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** O contexto da sessão que a porta usa (o `porta` de sessaoDe). */
export interface ContextoPortaPropria {
  readonly cliente: string;
  readonly hospital: string;
  readonly usuario: number | null;
  readonly correlacao: string;
}

export interface EstabelecimentoDaSessao {
  readonly id: number;
  readonly fuso: string;
}

export const num = (v: unknown): number => Number(v ?? 0);
export const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const txtOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
export const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';

export const naoEncontrado = (o: string) =>
  new ErroOperacao(404, 'registro-inexistente', `${o} não encontrado`, `${o} não existe neste cliente.`);

export function recusaRegra(
  titulo: string,
  problemas: readonly { campo: string; mensagem: string }[],
): ErroOperacao {
  return new ErroOperacao(422, 'regra-violada', titulo, problemas.map((p) => p.mensagem).join(' '), {
    campos: problemas.map((p) => p.campo),
  });
}

/** Valida a entrada com o esquema; erro de forma vira 400 com os campos. */
export function entradaValida<T>(esquema: z.ZodType<T>, entrada: unknown): T {
  const r = esquema.safeParse(entrada);
  if (!r.success)
    throw new ErroOperacao(400, 'entrada-invalida', 'Entrada inválida', 'Confira os campos destacados.', {
      campos: r.error.issues.map((i) => i.path.map(String).join('.')),
    });
  return r.data;
}

export class PortaEstabelecimentoPropria {
  private readonly executor: Executor;

  constructor(
    protected readonly nucleo: NucleoPortaPropria,
    protected readonly cliente: string,
    private readonly tabelas: readonly string[],
    private readonly prefixo: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  protected banco(c: ContextoPortaPropria): string {
    return c.cliente || this.cliente;
  }

  protected ler<T>(
    c: ContextoPortaPropria,
    rotulo: string,
    fn: (l: Leitor, est: EstabelecimentoDaSessao) => Promise<T>,
  ): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.banco(c), correlacao: `${this.prefixo}.${rotulo}` },
      async (l) => {
        const e = await l.uma(
          'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
          [c.hospital],
        );
        if (!e) throw naoEncontrado('Estabelecimento');
        return fn(l, { id: num(e['id']), fuso: String(e['fuso_horario'] || 'America/Sao_Paulo') });
      },
    );
  }

  /** Grava pelo executor, no estabelecimento da sessão, com o usuário da sessão; devolve o que `fn` devolveu. */
  protected async gravar<T extends Record<string, unknown>>(
    c: ContextoPortaPropria,
    nome: string,
    tabelas: readonly string[],
    fn: (
      tx: TxOperacao,
      est: EstabelecimentoDaSessao,
      usuario: number,
    ) => Promise<T & { tabela: string; id: number | null }>,
  ): Promise<T> {
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
      estabelecimento: est.id,
      usuario,
      correlacao: (c.correlacao || nome).slice(0, 64),
      chaveIdempotencia: `${nome}:${randomUUID()}`,
    };
    let feito: T | null = null;
    const op = definirOperacao({
      nome,
      tabelas: tabelas.filter((t) => this.tabelas.includes(t)),
      entrada: z.object({}).strict(),
      gravar: async (tx: TxOperacao) => {
        const r = await fn(tx, est, usuario);
        feito = r;
        return { tabela: r.tabela, id: r.id };
      },
      alvo: (_e, s) => ({ tabela: String(s['tabela']), id: s['id'] === null ? null : Number(s['id']) }),
    });
    await this.executor.executar(op, this.banco(c), {}, contexto);
    if (!feito) throw new Error(`A operação ${nome} terminou sem resultado.`);
    return feito;
  }
}
