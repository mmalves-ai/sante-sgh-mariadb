// Lances da disputa aberta do pregão e do leilão (C2-030, 05-SUP linha 26; Lei 14.133/2021, art. 56 e 57) sobre o
// MariaDB do cliente pelo Executor do núcleo (trilha na mesma transação, Idempotency-Key). A regra pura mora em
// `@sgh/contratos/regras-suprimentos` (lance-pregao); aqui fica a gravação:
//   - lance_licitacao: cada lance do licitante no item, com a hora, quem registrou, a proposta e a ordem do licitante
//     (rodada). Nada é apagado: a sequência dos lances é o histórico da disputa;
//   - proposta_licitacao_item.valor_ultimo_lance: o último lance passa a ser a oferta da proposta, que o julgamento do
//     processo (porta da licitação) já usa.
// O item do processo é travado na transação (FOR UPDATE): dois lances do mesmo item não se cruzam.
import {
  classificacaoDosLances,
  podeRegistrarLance,
  type RecusaSuprimentos,
  type SentidoDisputa,
  sentidoDaDisputa,
} from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';

export const PORTA_LANCE_PREGAO = Symbol('PORTA_LANCE_PREGAO');
export const OPERACAO_LANCE = 'suprimentos.lance-licitacao.registrar';
export const TABELAS_LANCE = ['lance_licitacao', 'proposta_licitacao_item'] as const;

const id = z.number().int().positive();
export const esquemaLance = z
  .object({
    item: id,
    fornecedor: id,
    valor: z.number().positive().max(999_999_999),
    intervaloMinimoPercentual: z.number().min(0).max(50).nullable().optional(),
  })
  .strict();
export type EntradaLance = z.infer<typeof esquemaLance>;

export type ResultadoLance = {
  readonly id: number;
  readonly item: number;
  readonly fornecedor: number;
  readonly rodada: number;
  readonly valor: number;
  readonly posicao: number;
};

export interface ProcessoEmDisputa {
  readonly id: number;
  readonly numero: string;
  readonly objeto: string;
  readonly modalidade: string;
}
export interface LanceVisao {
  readonly id: number;
  readonly fornecedor: number;
  readonly rodada: number;
  readonly valor: number;
  readonly em: string;
}
export interface ItemDisputaVisao {
  readonly id: number;
  readonly sequencia: number;
  readonly descricao: string;
  readonly quantidade: number;
  readonly propostas: readonly {
    readonly fornecedor: number;
    readonly fornecedorNome: string;
    readonly valor: number;
    readonly ultimoLance: number | null;
    readonly apta: boolean;
  }[];
  readonly lances: readonly LanceVisao[];
  readonly classificacao: readonly { fornecedor: number; valor: number; posicao: number }[];
}
export interface DisputaVisao {
  readonly id: number;
  readonly numero: string;
  readonly objeto: string;
  readonly etapa: string;
  readonly modalidade: string;
  readonly sentido: SentidoDisputa | null;
  readonly itens: readonly ItemDisputaVisao[];
}

export interface PortaLancePregao {
  readonly destino: 'banco' | 'indisponivel';
  processos(c: ContextoPortaM18): Promise<ProcessoEmDisputa[]>;
  disputa(c: ContextoPortaM18, processo: number): Promise<DisputaVisao>;
  registrar(c: ContextoPortaM18, processo: number, e: EntradaLance, chave: string): Promise<ResultadoLance>;
}

const n = (v: unknown) => Number(v ?? 0);
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const instante = (v: unknown) => (v instanceof Date ? v.toISOString() : t(v));

function recusar(r: RecusaSuprimentos | null | undefined): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : undefined);
}

type Leitor = Pick<TxOperacao, 'uma' | 'consultar'>;

const SQL_PROPOSTAS = `SELECT pi.id, pi.processo_licitatorio_item_id, pi.valor_unitario, pi.valor_ultimo_lance, pi.resultado,
        pl.empresa_fornecedora_id, pl.habilitacao, COALESCE(ef.nome_fantasia, ef.razao_social) AS fornecedor_nome
   FROM proposta_licitacao_item pi
   JOIN proposta_licitacao pl ON pl.id = pi.proposta_licitacao_id
   JOIN empresa_fornecedora ef ON ef.id = pl.empresa_fornecedora_id
  WHERE pl.processo_licitatorio_id = ? AND pi.excluido_em IS NULL AND pl.excluido_em IS NULL
  ORDER BY pi.id`;
const SQL_LANCES = `SELECT l.id, l.processo_licitatorio_item_id, l.empresa_fornecedora_id, l.rodada, l.valor_unitario,
        l.ocorrido_em
   FROM lance_licitacao l JOIN processo_licitatorio_item i ON i.id = l.processo_licitatorio_item_id
  WHERE i.processo_licitatorio_id = ? AND l.operacao = 'inclusao'
  ORDER BY l.id`;

async function processoDoEstabelecimento(q: Leitor, est: number, processo: number): Promise<Linha> {
  const p = await q.uma<Linha>(
    `SELECT id, numero, objeto, etapa, modalidade FROM processo_licitatorio
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [processo, est],
  );
  if (!p) throw recusa('licitacao-inexistente', 'O processo não existe neste estabelecimento.');
  return p;
}

async function registrar(
  tx: TxOperacao,
  est: number,
  processo: number,
  e: EntradaLance,
): Promise<ResultadoLance> {
  const usuario = tx.contexto.usuario;
  if (usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  const p = await processoDoEstabelecimento(tx, est, processo);
  const [item] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id FROM processo_licitatorio_item
      WHERE id = ? AND processo_licitatorio_id = ? AND excluido_em IS NULL`,
    [e.item, processo],
  );
  if (!item) throw recusa('licitacao-item-inexistente', 'O item não é deste processo.', { campos: ['item'] });
  const prop = await tx.uma<Linha>(
    `SELECT pi.id, pi.proposta_licitacao_id, pi.valor_unitario, pi.resultado, pl.habilitacao
       FROM proposta_licitacao_item pi JOIN proposta_licitacao pl ON pl.id = pi.proposta_licitacao_id
      WHERE pl.processo_licitatorio_id = ? AND pi.processo_licitatorio_item_id = ? AND pl.empresa_fornecedora_id = ?
        AND pi.excluido_em IS NULL AND pl.excluido_em IS NULL`,
    [processo, e.item, e.fornecedor],
  );
  const proprios = (
    await tx.consultar<Linha>(
      `SELECT valor_unitario FROM lance_licitacao
        WHERE processo_licitatorio_item_id = ? AND empresa_fornecedora_id = ? AND operacao = 'inclusao' ORDER BY id`,
      [e.item, e.fornecedor],
    )
  ).map((r) => n(r['valor_unitario']));
  recusar(
    podeRegistrarLance({
      etapa: t(p['etapa']),
      modalidade: t(p['modalidade']),
      proposta: prop
        ? {
            valor: n(prop['valor_unitario']),
            desclassificada: prop['resultado'] === 'desclassificado',
            inabilitada: prop['habilitacao'] === 'inabilitada',
          }
        : null,
      lancesProprios: proprios,
      valor: e.valor,
      intervaloMinimoPercentual: e.intervaloMinimoPercentual ?? null,
    }),
  );
  const agora = new Date();
  const rodada = proprios.length + 1;
  const lance = await tx.incluir('lance_licitacao', {
    processo_licitatorio_item_id: e.item,
    operacao: 'inclusao',
    ocorrido_em: agora,
    usuario_id: usuario,
    empresa_fornecedora_id: e.fornecedor,
    proposta_licitacao_id: n(prop!['proposta_licitacao_id']),
    rodada,
    valor_unitario: e.valor,
    vencedor: false,
    desclassificado: false,
  });
  await tx.executar(
    `UPDATE proposta_licitacao_item SET valor_ultimo_lance = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
      WHERE id = ?`,
    [e.valor, agora, usuario, n(prop!['id'])],
  );
  const todos = await tx.consultar<Linha>(
    `SELECT empresa_fornecedora_id, valor_unitario, id FROM lance_licitacao
      WHERE processo_licitatorio_item_id = ? AND operacao = 'inclusao'`,
    [e.item],
  );
  const sentido = sentidoDaDisputa(t(p['modalidade']))!;
  const posicao =
    classificacaoDosLances(
      sentido,
      todos.map((r) => ({
        fornecedor: n(r['empresa_fornecedora_id']),
        valor: n(r['valor_unitario']),
        ordem: n(r['id']),
      })),
    ).find((c) => c.fornecedor === e.fornecedor)?.posicao ?? 0;
  return { id: lance, item: e.item, fornecedor: e.fornecedor, rodada, valor: e.valor, posicao };
}

export class PortaLancePregaoPropria implements PortaLancePregao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18): ContextoNucleo & { estabelecimento: number } {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'lance-pregao',
    };
  }

  processos(c: ContextoPortaM18): Promise<ProcessoEmDisputa[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT id, numero, objeto, modalidade FROM processo_licitatorio
            WHERE estabelecimento_id = ? AND etapa = 'sessao' AND excluido_em IS NULL
              AND (modalidade LIKE 'pregao%' OR modalidade = 'leilao')
            ORDER BY sessao_em DESC, id DESC LIMIT 50`,
          [ctx.estabelecimento],
        )
      ).map((r) => ({
        id: n(r['id']),
        numero: t(r['numero']),
        objeto: t(r['objeto']),
        modalidade: t(r['modalidade']).replace(/_/g, '-'),
      })),
    );
  }

  disputa(c: ContextoPortaM18, processo: number): Promise<DisputaVisao> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const p = await processoDoEstabelecimento(l, ctx.estabelecimento, processo);
      const sentido = sentidoDaDisputa(t(p['modalidade']));
      const itens = await l.consultar<Linha>(
        `SELECT id, sequencia, descricao, quantidade FROM processo_licitatorio_item
          WHERE processo_licitatorio_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [processo],
      );
      const propostas = await l.consultar<Linha>(SQL_PROPOSTAS, [processo]);
      const lances = await l.consultar<Linha>(SQL_LANCES, [processo]);
      return {
        id: processo,
        numero: t(p['numero']),
        objeto: t(p['objeto']),
        etapa: t(p['etapa']),
        modalidade: t(p['modalidade']).replace(/_/g, '-'),
        sentido,
        itens: itens.map((i) => {
          const doItem = lances.filter((x) => n(x['processo_licitatorio_item_id']) === n(i['id']));
          return {
            id: n(i['id']),
            sequencia: n(i['sequencia']),
            descricao: t(i['descricao']),
            quantidade: n(i['quantidade']),
            propostas: propostas
              .filter((x) => n(x['processo_licitatorio_item_id']) === n(i['id']))
              .map((x) => ({
                fornecedor: n(x['empresa_fornecedora_id']),
                fornecedorNome: t(x['fornecedor_nome']),
                valor: n(x['valor_unitario']),
                ultimoLance: x['valor_ultimo_lance'] === null ? null : n(x['valor_ultimo_lance']),
                apta: x['resultado'] !== 'desclassificado' && x['habilitacao'] !== 'inabilitada',
              })),
            lances: doItem.map((x) => ({
              id: n(x['id']),
              fornecedor: n(x['empresa_fornecedora_id']),
              rodada: n(x['rodada']),
              valor: n(x['valor_unitario']),
              em: instante(x['ocorrido_em']),
            })),
            classificacao: sentido
              ? classificacaoDosLances(
                  sentido,
                  doItem.map((x) => ({
                    fornecedor: n(x['empresa_fornecedora_id']),
                    valor: n(x['valor_unitario']),
                    ordem: n(x['id']),
                  })),
                )
              : [],
          };
        }),
      };
    });
  }

  async registrar(
    c: ContextoPortaM18,
    processo: number,
    e: EntradaLance,
    chave: string,
  ): Promise<ResultadoLance> {
    const ctxN = this.contexto(c);
    const op = definirOperacao({
      nome: OPERACAO_LANCE,
      tabelas: [...TABELAS_LANCE],
      entrada: esquemaLance,
      gravar: (tx: TxOperacao, x: EntradaLance) => registrar(tx, ctxN.estabelecimento, processo, x),
      alvo: (_e, r: ResultadoLance) => ({ tabela: 'lance_licitacao', id: r.id }),
      trilha: (x: EntradaLance) => ({
        dados: { processo, item: x.item, fornecedor: x.fornecedor },
        motivo: null,
      }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, e, ctx);
    return resultado as ResultadoLance;
  }
}

export function portaLancePregaoIndisponivel(): PortaLancePregao {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'Os lances do pregão exigem o banco próprio.');
  };
  return { destino: 'indisponivel', processos: falha, disputa: falha, registrar: falha };
}
