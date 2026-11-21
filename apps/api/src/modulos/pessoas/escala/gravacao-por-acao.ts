// Gravação de uma ação da tela da escala ou do realizado numa operação PRÓPRIA do Executor (F2.2 lote 03-04).
// Cada evento auditável da tela (`pessoas.escala.publicada`, `pessoas.troca.decidida`...) vira uma operação com nome,
// entrada Zod e tabelas próprias: a guarda "só grava nas tabelas declaradas" vale por ação, e a trilha e as métricas
// guardam a identidade da ação.
// Melhoria: a chave de idempotência é derivada da requisição (cabeçalho de correlação da tela), não sorteada a cada
// chamada: o reenvio do mesmo pedido devolve o resultado já gravado, sem gravar de novo nem duplicar o outbox. A chave
// de negócio que o serviço dá ao evento (ex.: `<hospital>:escala:<id>:publicada`) segue na carga (`chaveNegocio`),
// para a deduplicação do consumidor.
import { randomUUID } from 'node:crypto';
import {
  type ContextoNucleo,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import { contextoDe, fusoDe } from './porta-escala-propria.js';

/** Nome da operação e tabelas que ela grava. */
export interface AcaoGravacao {
  readonly nome: string;
  readonly tabelas: readonly string[];
}

/** O que a gravação acumula além das linhas: dados da trilha, eventos do outbox e pendências de modelo. */
export interface ExtrasGravacao {
  readonly dados: Record<string, unknown>;
  readonly eventos: { tipo: string; carga: Record<string, string | number> }[];
  readonly pendentes: Record<string, unknown>[];
}

/** O código do evento auditável que a linha da trilha carrega (lido antes de gravar, sem o resultado). */
export function eventoDaTrilha<T>(trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao)): string | null {
  try {
    const vazio = new Proxy({}, { get: () => undefined }) as T;
    const l = typeof trilha === 'function' ? trilha(vazio) : trilha;
    const d = l?.dadosDepois as Record<string, unknown> | undefined;
    return typeof d?.['evento'] === 'string' ? d['evento'] : null;
  } catch {
    return null;
  }
}

/** Correlação que identifica a requisição (cabeçalho da tela), e não um rótulo fixo de reserva. */
const CORRELACAO_DA_REQUISICAO = /^[A-Za-z0-9._:-]{16,64}$/;

export function chaveDaAcao(nome: string, c: ContextoNucleo): string {
  const corr = c.correlacao ?? '';
  // Sem a correlação da requisição, a chave não identifica o pedido: cada gravação é nova.
  const base = CORRELACAO_DA_REQUISICAO.test(corr) && /\d/.test(corr) ? corr : randomUUID();
  return `${nome}:${base}`.slice(0, 80);
}

export async function gravarPorAcao<T>(
  executor: Executor,
  c: ContextoNucleo,
  rotulo: string,
  acao: AcaoGravacao,
  trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
  corpo: (tx: TxOperacao, est: number, usuario: number, fuso: string, x: ExtrasGravacao) => Promise<T>,
): Promise<T> {
  const est = c.estabelecimento;
  if (est === null || est === undefined)
    throw new ErroOperacao(
      422,
      'sem-estabelecimento',
      'Sem estabelecimento',
      'Escolha o estabelecimento da sessão.',
    );
  if (c.usuario === null || c.usuario === undefined)
    throw new ErroOperacao(422, 'sem-usuario', 'Sem usuário', 'A gravação exige o usuário da sessão.');
  const usuario = c.usuario;
  let saida: { valor: T } | null = null;
  const extras: ExtrasGravacao = { dados: {}, eventos: [], pendentes: [] };
  const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
  const entrada = z.object({ acao: z.literal(acao.nome) }).strict();
  const op = definirOperacao({
    nome: acao.nome,
    tabelas: acao.tabelas,
    entrada,
    gravar: async (tx) => {
      const fuso = await fusoDe(tx, est);
      saida = { valor: await corpo(tx, est, usuario, fuso, extras) };
      return { valor: JSON.stringify(saida.valor ?? null) } as ResultadoOperacao;
    },
    alvo: () => {
      const l = linha();
      return { tabela: l?.entidade ?? acao.tabelas[0]!, id: l?.entidadeId ?? null };
    },
    eventos: () => extras.eventos.map((e) => ({ tipo: e.tipo, carga: e.carga })),
    trilha: () => {
      const depois = linha()?.dadosDepois;
      const base =
        depois && typeof depois === 'object'
          ? (depois as object)
          : depois === undefined
            ? {}
            : { valor: depois };
      const dados = {
        ...base,
        ...extras.dados,
        ...(extras.pendentes.length > 0 ? { pendentesDeModelo: extras.pendentes } : {}),
      };
      return { dados, motivo: linha()?.motivo ?? null };
    },
  });
  const chave = chaveDaAcao(acao.nome, c);
  const r = await executor.executar(
    op,
    c.cliente,
    { acao: acao.nome },
    { ...contextoDe(c, rotulo), chaveIdempotencia: chave },
  );
  if (saida) return (saida as { valor: T }).valor;
  // Pedido repetido: o Executor devolve o resultado gravado da primeira vez, sem gravar de novo.
  const valor = (r.resultado as Record<string, unknown> | null)?.['valor'];
  if (typeof valor === 'string') return JSON.parse(valor) as T;
  throw new ErroOperacao(
    500,
    'sem-resultado',
    'Gravação sem resultado',
    'A gravação não devolveu resultado.',
  );
}
