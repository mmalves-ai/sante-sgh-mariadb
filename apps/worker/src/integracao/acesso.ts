// Acesso do worker às leituras e gravações das integrações sobre o banco próprio do cliente (MariaDB, @sgh/nucleo):
// a leitura em transação somente leitura e a gravação pelo Executor (trilha, idempotência e mensagens de saída na mesma
// transação). Abstraído para os testes de unidade (dublê) e de integração (cliente de teste).
// Melhoria: cada gravação é uma operação declarada (nome e tabelas que grava), no estabelecimento resolvido pelo código e
// conferido no banco; código desconhecido é recusado. Processo automático: sem usuário, com a correlação do rótulo.
import { randomUUID } from 'node:crypto';
import {
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

/** As tabelas que a entrega das integrações grava (consumidor, entrega, fila de mortos e vigia dos fatos). */
export const TABELAS_INTEGRACAO: readonly string[] = [
  'parceiro_dados',
  'sistema_externo',
  'ponto_integracao',
  'mensagem_integracao_saida',
  'falha_integracao',
  'integracao_mensagem',
  'marca_sincronismo',
];

export interface OpcoesGravacao {
  /** Nome da operação na trilha (padrão: integracao.<rótulo>). */
  readonly operacao?: string;
  /** Tabelas que a operação grava (padrão: as da integração). */
  readonly tabelas?: readonly string[];
}

export interface AcessoIntegracao {
  /** Leitura somente leitura no banco do cliente (as consultas filtram pelo código do estabelecimento). */
  ler<T>(hospital: string, fn: (l: Leitor) => Promise<T>): Promise<T>;
  /** Uma operação do Executor no estabelecimento do código (processo automático: sem usuário). */
  gravar<T>(hospital: string, fn: (tx: TxOperacao) => Promise<T>, opcoes?: OpcoesGravacao): Promise<T>;
}

/** O que o acesso usa do NucleoProprio (os testes trocam). */
export interface NucleoIntegracao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const ENTRADA = z.object({ estabelecimento: z.number().int().positive() });

export function acessoDoNucleo(
  nucleo: NucleoIntegracao,
  cliente: string,
  rotulo: string,
  executor: Executor = nucleo.criarExecutor(),
): AcessoIntegracao {
  const correlacao = rotulo.slice(0, 64);
  const ids = new Map<string, number>();
  const ler = <T>(fn: (l: Leitor) => Promise<T>): Promise<T> => nucleo.lerSomente({ cliente, correlacao }, fn);
  async function estabelecimento(hospital: string): Promise<number> {
    const ja = ids.get(hospital);
    if (ja !== undefined) return ja;
    const r = await ler((l) =>
      l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [hospital]),
    );
    if (!r) throw recusa('estabelecimento-desconhecido', 'O estabelecimento da integração não está cadastrado.');
    const id = Number(r.id);
    ids.set(hospital, id);
    return id;
  }
  return {
    ler: (_hospital, fn) => ler(fn),
    async gravar<T>(hospital: string, fn: (tx: TxOperacao) => Promise<T>, o: OpcoesGravacao = {}): Promise<T> {
      const est = await estabelecimento(hospital);
      const tabelas = o.tabelas ?? TABELAS_INTEGRACAO;
      const caixa: { valor?: T } = {};
      const op = definirOperacao({
        nome: o.operacao ?? `integracao.${rotulo}`,
        tabelas,
        entrada: ENTRADA,
        gravar: async (tx): Promise<ResultadoOperacao> => {
          caixa.valor = await fn(tx);
          return {};
        },
        alvo: () => ({ tabela: tabelas[0] ?? 'integracao_mensagem', id: null }),
      });
      await executor.executar(
        op,
        cliente,
        { estabelecimento: est },
        { cliente, estabelecimento: est, usuario: null, correlacao, chaveIdempotencia: `worker.${randomUUID()}` },
      );
      return caixa.valor as T;
    },
  };
}
