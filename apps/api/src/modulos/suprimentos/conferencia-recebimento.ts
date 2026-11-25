// Conferência física do recebimento (C2-038, 05-SUP linha 21), sobre o MariaDB do cliente pelo Executor do núcleo
// (trilha na mesma transação, versão conferida, Idempotency-Key). A regra pura mora em `@sgh/contratos/regras-suprimentos`
// (conferencia-recebimento): itens, divergência por item (apontamento, validade curta, falta, sobra), validação por
// outra pessoa com justificativa da divergência e cancelamento com motivo. Aqui fica a gravação: a conferência
// (conferente, chegada, situação), os itens conferidos (esperado do pedido recalculado no servidor, conferido, lote,
// validade, divergência), a validação e o cancelamento. A nota de entrada usa a validada (recebimento-nf-gravacao.ts).
// Nada é apagado.
import {
  APONTAMENTOS_RECEBIMENTO,
  classificarRecebimento,
  completarComPedido,
  conferirItensRecebimento,
  type ItemParaConferir,
  podeCancelarRecebimento,
  podeValidarRecebimento,
  type RecusaSuprimentos,
  type SituacaoConferencia,
  TIPOS_RECEBIMENTO,
} from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { hojeNoEstabelecimento, insumoAtivo, localDoEstabelecimento } from './porta-propria.js';

export const PORTA_CONFERENCIA_RECEBIMENTO = Symbol('PORTA_CONFERENCIA_RECEBIMENTO');
export const OPERACOES_CONFERENCIA_RECEBIMENTO = {
  registrar: 'suprimentos.conferencia-recebimento.registrar',
  validar: 'suprimentos.conferencia-recebimento.validar',
  cancelar: 'suprimentos.conferencia-recebimento.cancelar',
} as const;
export const TABELAS_CONFERENCIA_RECEBIMENTO = [
  'conferencia_recebimento',
  'conferencia_recebimento_item',
] as const;

const id = z.number().int().positive();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const texto = (max: number) => z.string().trim().max(max);

export const esquemaConferenciaRecebimento = z
  .object({
    tipo: z.enum(TIPOS_RECEBIMENTO).default('compra'),
    fornecedor: id,
    local: id,
    pedido: z
      .object({ ano: z.number().int().min(2000).max(2100), doc: id })
      .strict()
      .nullable()
      .optional(),
    numeroNota: z
      .string()
      .trim()
      .regex(/^\d{1,15}$/)
      .nullable()
      .optional(),
    serie: texto(10).nullable().optional(),
    chave: z
      .string()
      .regex(/^\d{44}$/)
      .nullable()
      .optional(),
    emissao: dataIso.nullable().optional(),
    observacao: texto(2000).nullable().optional(),
    itens: z
      .array(
        z
          .object({
            item: id,
            esperada: z.number().nonnegative().max(999_999_999).nullable(),
            conferida: z.number().nonnegative().max(999_999_999),
            lote: texto(40).nullable().optional(),
            validade: dataIso.nullable().optional(),
            apontamento: z.enum(APONTAMENTOS_RECEBIMENTO).nullable().optional(),
            observacao: texto(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(300),
  })
  .strict();
export type ConferenciaRecebimentoEntrada = z.infer<typeof esquemaConferenciaRecebimento>;

export const esquemaValidarConferencia = z
  .object({ id, justificativa: texto(500).nullable().optional() })
  .strict();
export const esquemaCancelarConferencia = z.object({ id, motivo: texto(500) }).strict();
export type ValidarConferencia = z.infer<typeof esquemaValidarConferencia>;
export type CancelarConferencia = z.infer<typeof esquemaCancelarConferencia>;

export interface ConferenciaResumo {
  readonly id: number;
  readonly tipo: string;
  readonly fornecedor: number;
  readonly fornecedorNome: string;
  readonly local: number;
  readonly localNome: string;
  readonly numeroNota: string | null;
  readonly chegadaEm: string;
  readonly situacao: SituacaoConferencia;
  readonly conferente: string | null;
  readonly validador: string | null;
  readonly nota: number | null;
  readonly itens: number;
  readonly divergentes: number;
}

export interface ItemConferenciaLido {
  readonly sequencia: number;
  readonly item: number;
  readonly nome: string;
  readonly esperada: number | null;
  readonly conferida: number;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly divergencia: string;
  readonly observacao: string | null;
}

export interface ConferenciaDetalhe extends ConferenciaResumo {
  readonly observacao: string | null;
  readonly motivoCancelamento: string | null;
  readonly itensDetalhe: readonly ItemConferenciaLido[];
}

export interface EsperadoDoPedido {
  readonly item: number;
  readonly nome: string;
  readonly esperada: number;
  readonly controlaLote: boolean;
}

// Alias (não interface): o Executor exige o resultado como registro de valores simples.
export type ResultadoConferencia = {
  readonly id: number;
  readonly situacao: SituacaoConferencia;
  readonly divergentes: number;
};

export interface PortaConferenciaRecebimento {
  readonly destino: 'banco' | 'indisponivel';
  listar(c: ContextoPortaM18, situacao: string | null): Promise<ConferenciaResumo[]>;
  detalhe(c: ContextoPortaM18, id: number): Promise<ConferenciaDetalhe>;
  esperadosDoPedido(
    c: ContextoPortaM18,
    ano: number,
    doc: number,
  ): Promise<{ fornecedor: number; itens: EsperadoDoPedido[] }>;
  registrar(
    c: ContextoPortaM18,
    e: ConferenciaRecebimentoEntrada,
    chave: string,
  ): Promise<ResultadoConferencia>;
  validar(c: ContextoPortaM18, e: ValidarConferencia, chave: string): Promise<ResultadoConferencia>;
  cancelar(c: ContextoPortaM18, e: CancelarConferencia, chave: string): Promise<ResultadoConferencia>;
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const t = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const dia = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const instante = (v: unknown): string => (v instanceof Date ? v.toISOString() : t(v));

function recusar(r: RecusaSuprimentos | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : {});
}

function usuarioDe(tx: TxOperacao): number {
  const u = tx.contexto.usuario;
  if (u === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return u;
}

/** O saldo a receber de cada item do pedido (pedido − cancelado − recebido). */
async function saldosDoPedido(l: Leitor | TxOperacao, pedido: number): Promise<Map<number, number>> {
  const r = await l.consultar<Linha>(
    `SELECT insumo_id, SUM(quantidade - quantidade_cancelada - quantidade_recebida) AS saldo
       FROM pedido_compra_item WHERE pedido_compra_id = ? AND excluido_em IS NULL AND cancelado_em IS NULL
      GROUP BY insumo_id`,
    [pedido],
  );
  return new Map(r.map((x) => [n(x['insumo_id']), Math.max(0, n(x['saldo']))]));
}

/** A unidade de estoque do item do pedido que não veio na entrega (a falta é registrada mesmo com o item inativo). */
async function unidadeDoInsumo(tx: TxOperacao, insumo: number): Promise<Linha> {
  const r = await tx.uma<Linha>(
    'SELECT id, estoque_unidade_medida_id, controla_lote FROM insumo WHERE id = ? AND excluido_em IS NULL',
    [insumo],
  );
  if (!r) throw recusa('item-inexistente', `O item ${insumo} do pedido não existe no cadastro.`);
  return r;
}

async function registrarConferencia(
  tx: TxOperacao,
  est: number,
  e: ConferenciaRecebimentoEntrada,
  hoje: string,
): Promise<ResultadoConferencia> {
  await localDoEstabelecimento(tx, est, e.local);
  const f = await tx.uma<Linha>(
    "SELECT id FROM empresa_fornecedora WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
    [e.fornecedor],
  );
  if (!f)
    throw recusa('fornecedor-inexistente', 'O fornecedor não está cadastrado ou não está ativo.', {
      campos: ['fornecedor'],
    });
  let pedido: number | null = null;
  let saldos: Map<number, number> | null = null;
  if (e.pedido) {
    const p = await tx.uma<Linha>(
      'SELECT id, empresa_fornecedora_id FROM pedido_compra WHERE estabelecimento_id = ? AND ano = ? AND numero = ? AND excluido_em IS NULL',
      [est, e.pedido.ano, e.pedido.doc],
    );
    if (!p) throw recusa('pedido-inexistente', 'O pedido não existe.', { campos: ['pedido'] });
    if (n(p['empresa_fornecedora_id']) !== e.fornecedor)
      throw recusa('pedido-de-outro-fornecedor', 'O pedido é de outro fornecedor.', { campos: ['pedido'] });
    pedido = n(p['id']);
    saldos = await saldosDoPedido(tx, pedido);
  }
  const insumos = new Map<number, Linha>();
  for (const i of e.itens) insumos.set(i.item, await insumoAtivo(tx, i.item));
  // A lista da tela, conferida como veio; depois, com pedido, o esperado é o saldo do pedido (o servidor recalcula e
  // ignora o que a tela manda), o item sem saldo vira produto errado e o item do pedido que não veio entra como falta.
  const daTela: ItemParaConferir[] = e.itens.map((i) => ({
    item: i.item,
    esperada: i.esperada,
    conferida: i.conferida,
    controlaLote: Boolean(n(insumos.get(i.item)!['controla_lote'])),
    lote: i.lote ?? null,
    validade: i.validade ?? null,
    apontamento: i.apontamento ?? null,
    observacao: i.observacao ?? null,
  }));
  recusar(conferirItensRecebimento(daTela));
  const paraConferir = completarComPedido(daTela, saldos);
  for (const i of paraConferir)
    if (!insumos.has(i.item)) insumos.set(i.item, await unidadeDoInsumo(tx, i.item));
  const classe = classificarRecebimento(paraConferir, hoje);
  const agora = new Date();
  const conf = await tx.incluir('conferencia_recebimento', {
    estabelecimento_id: est,
    tipo: e.tipo,
    empresa_fornecedora_id: e.fornecedor,
    pedido_compra_id: pedido,
    local_estoque_id: e.local,
    numero_nota_fiscal: e.numeroNota ?? null,
    serie_nota_fiscal: e.serie ?? null,
    chave_acesso: e.chave ?? null,
    data_emissao: e.emissao ?? null,
    chegada_em: agora,
    conferente_usuario_id: usuarioDe(tx),
    conferido_em: agora,
    situacao: classe.situacao,
    observacao: e.observacao ?? null,
  });
  for (const [k, i] of paraConferir.entries())
    await tx.incluir('conferencia_recebimento_item', {
      conferencia_recebimento_id: conf,
      sequencia: k + 1,
      insumo_id: i.item,
      unidade_medida_id: n(insumos.get(i.item)!['estoque_unidade_medida_id']),
      quantidade_esperada: i.esperada,
      quantidade_conferida: i.conferida,
      numero_lote: i.lote?.trim() || null,
      validade: i.validade ?? null,
      divergencia: classe.itens[k]!.divergencia,
      observacao: i.observacao?.trim() || null,
    });
  return {
    id: conf,
    situacao: classe.situacao,
    divergentes: classe.itens.filter((x) => x.divergencia !== 'nenhuma').length,
  };
}

async function conferenciaTravada(tx: TxOperacao, est: number, idConf: number): Promise<Linha> {
  const [c] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, situacao, conferente_usuario_id, nota_entrada_id, observacao,
            (SELECT COUNT(*) FROM conferencia_recebimento_item i
              WHERE i.conferencia_recebimento_id = conferencia_recebimento.id AND i.excluido_em IS NULL
                AND i.divergencia <> 'nenhuma') AS divergentes
       FROM conferencia_recebimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [idConf, est],
  );
  if (!c) throw recusa('conferencia-inexistente', 'A conferência não existe neste estabelecimento.');
  return c;
}

async function validarConferencia(
  tx: TxOperacao,
  est: number,
  e: ValidarConferencia,
): Promise<ResultadoConferencia> {
  const c = await conferenciaTravada(tx, est, e.id);
  const validador = usuarioDe(tx);
  recusar(
    podeValidarRecebimento(
      {
        situacao: t(c['situacao']) as SituacaoConferencia,
        conferente: c['conferente_usuario_id'] === null ? null : n(c['conferente_usuario_id']),
      },
      validador,
      e.justificativa,
    ),
  );
  const justificativa = e.justificativa?.trim();
  await tx.alterar('conferencia_recebimento', e.id, n(c['versao']), {
    situacao: 'validada',
    validador_usuario_id: validador,
    validado_em: new Date(),
    ...(justificativa
      ? {
          observacao: `${tn(c['observacao']) ? `${t(c['observacao'])}\n` : ''}Aceite: ${justificativa}`.slice(
            0,
            4000,
          ),
        }
      : {}),
  });
  return { id: e.id, situacao: 'validada', divergentes: n(c['divergentes']) };
}

async function cancelarConferencia(
  tx: TxOperacao,
  est: number,
  e: CancelarConferencia,
): Promise<ResultadoConferencia> {
  const c = await conferenciaTravada(tx, est, e.id);
  recusar(
    podeCancelarRecebimento(
      { situacao: t(c['situacao']) as SituacaoConferencia, notaLigada: c['nota_entrada_id'] !== null },
      e.motivo,
    ),
  );
  await tx.alterar('conferencia_recebimento', e.id, n(c['versao']), {
    situacao: 'cancelada',
    cancelado_em: new Date(),
    cancelado_por_usuario_id: usuarioDe(tx),
    motivo_cancelamento: e.motivo.trim(),
  });
  return { id: e.id, situacao: 'cancelada', divergentes: n(c['divergentes']) };
}

const SELECT_RESUMO = `SELECT c.id, c.tipo, c.empresa_fornecedora_id, COALESCE(ef.nome_fantasia, ef.razao_social) AS fornecedor_nome,
       c.local_estoque_id, le.nome AS local_nome, c.numero_nota_fiscal, c.chegada_em, c.situacao, c.nota_entrada_id,
       c.observacao, c.motivo_cancelamento, uc.login AS conferente, uv.login AS validador,
       (SELECT COUNT(*) FROM conferencia_recebimento_item i WHERE i.conferencia_recebimento_id = c.id AND i.excluido_em IS NULL) AS itens,
       (SELECT COUNT(*) FROM conferencia_recebimento_item i WHERE i.conferencia_recebimento_id = c.id AND i.excluido_em IS NULL
          AND i.divergencia <> 'nenhuma') AS divergentes
  FROM conferencia_recebimento c
  JOIN empresa_fornecedora ef ON ef.id = c.empresa_fornecedora_id
  JOIN local_estoque le ON le.id = c.local_estoque_id
  LEFT JOIN usuario uc ON uc.id = c.conferente_usuario_id
  LEFT JOIN usuario uv ON uv.id = c.validador_usuario_id`;

function resumo(r: Linha): ConferenciaResumo {
  return {
    id: n(r['id']),
    tipo: t(r['tipo']),
    fornecedor: n(r['empresa_fornecedora_id']),
    fornecedorNome: t(r['fornecedor_nome']),
    local: n(r['local_estoque_id']),
    localNome: t(r['local_nome']),
    numeroNota: tn(r['numero_nota_fiscal']),
    chegadaEm: instante(r['chegada_em']),
    situacao: t(r['situacao']) as SituacaoConferencia,
    conferente: tn(r['conferente']),
    validador: tn(r['validador']),
    nota: r['nota_entrada_id'] === null ? null : n(r['nota_entrada_id']),
    itens: n(r['itens']),
    divergentes: n(r['divergentes']),
  };
}

export class PortaConferenciaRecebimentoPropria implements PortaConferenciaRecebimento {
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
      correlacao: c.correlacao || 'conferencia-recebimento',
    };
  }

  listar(c: ContextoPortaM18, situacao: string | null): Promise<ConferenciaResumo[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          `${SELECT_RESUMO} WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND (? IS NULL OR c.situacao = ?)
            ORDER BY c.chegada_em DESC, c.id DESC LIMIT 100`,
          [ctx.estabelecimento, situacao, situacao],
        )
      ).map(resumo),
    );
  }

  detalhe(c: ContextoPortaM18, idConf: number): Promise<ConferenciaDetalhe> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const r = await l.uma<Linha>(
        `${SELECT_RESUMO} WHERE c.id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL`,
        [idConf, ctx.estabelecimento],
      );
      if (!r) throw new ErroProblema('nao-encontrado', 404, 'Conferência não encontrada');
      const itens = await l.consultar<Linha>(
        `SELECT ci.sequencia, ci.insumo_id, i.nome, ci.quantidade_esperada, ci.quantidade_conferida, ci.numero_lote,
                ci.validade, ci.divergencia, ci.observacao
           FROM conferencia_recebimento_item ci JOIN insumo i ON i.id = ci.insumo_id
          WHERE ci.conferencia_recebimento_id = ? AND ci.excluido_em IS NULL ORDER BY ci.sequencia`,
        [idConf],
      );
      return {
        ...resumo(r),
        observacao: tn(r['observacao']),
        motivoCancelamento: tn(r['motivo_cancelamento']),
        itensDetalhe: itens.map((x) => ({
          sequencia: n(x['sequencia']),
          item: n(x['insumo_id']),
          nome: t(x['nome']),
          esperada: x['quantidade_esperada'] === null ? null : n(x['quantidade_esperada']),
          conferida: n(x['quantidade_conferida']),
          lote: tn(x['numero_lote']),
          validade: dia(x['validade']),
          divergencia: t(x['divergencia']),
          observacao: tn(x['observacao']),
        })),
      };
    });
  }

  esperadosDoPedido(
    c: ContextoPortaM18,
    ano: number,
    doc: number,
  ): Promise<{ fornecedor: number; itens: EsperadoDoPedido[] }> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const p = await l.uma<Linha>(
        'SELECT id, empresa_fornecedora_id FROM pedido_compra WHERE estabelecimento_id = ? AND ano = ? AND numero = ? AND excluido_em IS NULL',
        [ctx.estabelecimento, ano, doc],
      );
      if (!p) throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado');
      const itens = await l.consultar<Linha>(
        `SELECT pi.insumo_id, i.nome, i.controla_lote,
                SUM(pi.quantidade - pi.quantidade_cancelada - pi.quantidade_recebida) AS saldo
           FROM pedido_compra_item pi JOIN insumo i ON i.id = pi.insumo_id
          WHERE pi.pedido_compra_id = ? AND pi.excluido_em IS NULL AND pi.cancelado_em IS NULL
          GROUP BY pi.insumo_id, i.nome, i.controla_lote ORDER BY MIN(pi.sequencia)`,
        [n(p['id'])],
      );
      return {
        fornecedor: n(p['empresa_fornecedora_id']),
        itens: itens
          .map((x) => ({
            item: n(x['insumo_id']),
            nome: t(x['nome']),
            esperada: Math.max(0, n(x['saldo'])),
            controlaLote: Boolean(n(x['controla_lote'])),
          }))
          .filter((x) => x.esperada > 0),
      };
    });
  }

  private async rodar<E extends object>(
    c: ContextoPortaM18,
    nome: string,
    entrada: z.ZodType<E>,
    e: E,
    chave: string,
    gravar: (tx: TxOperacao, est: number, x: E, hoje: string) => Promise<ResultadoConferencia>,
    trilha: (x: E) => { dados: Record<string, unknown>; motivo: string | null },
  ): Promise<ResultadoConferencia> {
    const ctxN = this.contexto(c);
    const hoje = await this.nucleo.lerSomente(ctxN, (l) => hojeNoEstabelecimento(l, ctxN.estabelecimento));
    const op = definirOperacao({
      nome,
      tabelas: [...TABELAS_CONFERENCIA_RECEBIMENTO],
      entrada,
      gravar: (tx: TxOperacao, x: E) => gravar(tx, ctxN.estabelecimento, x, hoje),
      alvo: (_e, r) => ({ tabela: 'conferencia_recebimento', id: Number(r['id']) }),
      trilha,
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, e, ctx);
    return resultado as ResultadoConferencia;
  }

  registrar(
    c: ContextoPortaM18,
    e: ConferenciaRecebimentoEntrada,
    chave: string,
  ): Promise<ResultadoConferencia> {
    return this.rodar(
      c,
      OPERACOES_CONFERENCIA_RECEBIMENTO.registrar,
      esquemaConferenciaRecebimento as z.ZodType<ConferenciaRecebimentoEntrada>,
      e,
      chave,
      registrarConferencia,
      (x) => ({
        dados: { fornecedor: x.fornecedor, local: x.local, itens: x.itens.length, pedido: Boolean(x.pedido) },
        motivo: null,
      }),
    );
  }

  validar(c: ContextoPortaM18, e: ValidarConferencia, chave: string): Promise<ResultadoConferencia> {
    return this.rodar(
      c,
      OPERACOES_CONFERENCIA_RECEBIMENTO.validar,
      esquemaValidarConferencia as z.ZodType<ValidarConferencia>,
      e,
      chave,
      (tx, est, x) => validarConferencia(tx, est, x),
      (x) => ({ dados: { id: x.id }, motivo: x.justificativa?.trim() || null }),
    );
  }

  cancelar(c: ContextoPortaM18, e: CancelarConferencia, chave: string): Promise<ResultadoConferencia> {
    return this.rodar(
      c,
      OPERACOES_CONFERENCIA_RECEBIMENTO.cancelar,
      esquemaCancelarConferencia as z.ZodType<CancelarConferencia>,
      e,
      chave,
      (tx, est, x) => cancelarConferencia(tx, est, x),
      (x) => ({ dados: { id: x.id }, motivo: x.motivo }),
    );
  }
}

export function portaConferenciaRecebimentoIndisponivel(): PortaConferenciaRecebimento {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'A conferência física do recebimento exige o banco próprio.');
  };
  return {
    destino: 'indisponivel',
    listar: falha,
    detalhe: falha,
    esperadosDoPedido: falha,
    registrar: falha,
    validar: falha,
    cancelar: falha,
  };
}
