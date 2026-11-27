// Devolução de compra ao fornecedor (C2-015, 05-SUP linha 22), sobre o MariaDB do cliente pelo Executor do núcleo
// (trilha na mesma transação, versão conferida, Idempotency-Key). A regra pura mora em `@sgh/contratos/regras-suprimentos`
// (devolucao-fornecedor): quantidade até o recebido menos o já devolvido, chave da NF-e de devolução, valor pelo custo da
// compra e a ordem do abatimento. Aqui fica a gravação, tudo numa transação:
//   devolucao_fornecedor(_item) com o número de negócio, o motivo e a NF-e de devolução;
//   a saída pelo motor do estoque (movimento "devolucao_fornecedor" pelo valor da compra, dos lotes que vieram na nota,
//   ligado ao item da devolução), que desfaz a entrada e recalcula o custo médio;
//   a nota de crédito recebida do fornecedor (motivo "devolucao"), uma por parcela em aberto do título a pagar da nota,
//   emitida e aplicada pela operação do financeiro (desconto na parcela e no título); o que sobra fica pendente.
// Nada é apagado.
import { TABELAS_PUBLICACAO_FATO } from '../contabil/publicacao-fato.js';
import {
  conferirDevolucaoFornecedor,
  disponivelParaDevolver,
  distribuirAbatimento,
  type RecusaSuprimentos,
  tipoDaDevolucao,
  valoresDevolucao,
} from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { type EmitirNotaEntrada, OPERACOES_NOTA_CESSAO } from '../financeiro/public-api.js';
import { ErroProblema } from '../../problema.filter.js';
import { conferirPolitica } from './politica-local-propria.js';
import {
  exigirMesAberto,
  hojeNoEstabelecimento,
  insumoAtivo,
  type LoteMandado,
  localDoEstabelecimento,
  lotesDaSaida,
  movimentar,
  tipoMovimentoId,
} from './porta-propria.js';

export const PORTA_DEVOLUCAO_FORNECEDOR = Symbol('PORTA_DEVOLUCAO_FORNECEDOR');
export const OPERACAO_DEVOLUCAO_FORNECEDOR = 'suprimentos.devolucao_fornecedor.registrar';
export const TABELAS_DEVOLUCAO_FORNECEDOR = [
  'devolucao_fornecedor',
  'devolucao_fornecedor_item',
  'saldo_estoque',
  'saldo_lote',
  'lote_insumo',
  'movimento_estoque',
  // C2-093: o movimento publica o fato contábil.
  ...TABELAS_PUBLICACAO_FATO,
  'movimento_lote',
  'nota_credito_debito',
  'tributo_nota_credito_debito',
  'parcela_pagar',
  'parcela_receber',
  'titulo_pagar',
  'titulo_receber',
  'sequencia_negocio',
] as const;

const id = z.number().int().positive();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const esquemaDevolucaoFornecedor = z
  .object({
    nota: id,
    motivo: id,
    /** Local de onde o produto sai; nulo: o local da entrada. */
    local: id.nullable().optional(),
    abaterContasPagar: z.boolean().default(true),
    numeroNotaFiscal: z.string().trim().max(15).nullable().optional(),
    serieNotaFiscal: z.string().trim().max(10).nullable().optional(),
    chaveAcesso: z.string().trim().max(60).nullable().optional(),
    dataEmissao: dataIso.nullable().optional(),
    observacao: z.string().trim().max(2000).nullable().optional(),
    itens: z
      .array(z.object({ notaItem: id, quantidade: z.number().positive().max(999_999_999) }).strict())
      .min(1)
      .max(200),
  })
  .strict();
export type DevolucaoFornecedorEntrada = z.infer<typeof esquemaDevolucaoFornecedor>;

export interface NotaDevolvivel {
  readonly id: number;
  readonly numero: number;
  readonly documento: string;
  readonly fornecedor: string;
  readonly entradaEm: string;
  readonly valorTotal: number;
  readonly itensDisponiveis: number;
}
export interface ItemNotaDevolucao {
  readonly notaItem: number;
  readonly item: number;
  readonly nome: string;
  readonly recebida: number;
  readonly jaDevolvida: number;
  readonly disponivel: number;
  readonly custoUnitario: number;
  readonly lotes: string;
}
export interface NotaParaDevolver {
  readonly id: number;
  readonly numero: number;
  readonly documento: string;
  readonly fornecedor: string;
  readonly entradaEm: string;
  readonly local: number;
  readonly localNome: string;
  readonly situacao: string;
  /** Soma dos saldos das parcelas a pagar em aberto do título da nota. */
  readonly saldoAPagar: number;
  readonly itens: readonly ItemNotaDevolucao[];
}
export interface MotivoDevolucao {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipoFiscal: string;
}
export interface DevolucaoRegistrada {
  readonly id: number;
  readonly numero: string;
  readonly tipo: string;
  readonly fornecedor: string;
  readonly documentoEntrada: string;
  readonly devolvidaEm: string;
  readonly motivo: string;
  readonly numeroNotaFiscal: string | null;
  readonly itens: number;
  readonly valorTotal: number;
  readonly valorAbatido: number;
  readonly creditoPendente: number;
  readonly situacao: string;
}
export type ResultadoDevolucao = {
  readonly id: number;
  readonly numero: string;
  readonly tipo: 'total' | 'parcial';
  readonly valorTotal: number;
  readonly valorAbatido: number;
  readonly creditoPendente: number;
  /** Ids das notas de crédito aplicadas (uma por parcela abatida), separados por vírgula. */
  readonly notasCredito: string;
};

export interface PortaDevolucaoFornecedor {
  readonly destino: 'banco' | 'indisponivel';
  notas(c: ContextoPortaM18, busca: string): Promise<NotaDevolvivel[]>;
  nota(c: ContextoPortaM18, nota: number): Promise<NotaParaDevolver>;
  motivos(c: ContextoPortaM18): Promise<MotivoDevolucao[]>;
  devolucoes(c: ContextoPortaM18): Promise<DevolucaoRegistrada[]>;
  registrar(c: ContextoPortaM18, e: DevolucaoFornecedorEntrada, chave: string): Promise<ResultadoDevolucao>;
}

const n = (v: unknown) => Number(v ?? 0);
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const q4 = (x: number) => Math.round(x * 10_000) / 10_000;
const dia = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : t(v).slice(0, 10);

function recusar(r: RecusaSuprimentos | undefined): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : undefined);
}

/** Itens da nota com o recebido, o já devolvido (devoluções não canceladas) e o custo por unidade de estoque. */
async function itensDaNota(l: Leitor, nota: number): Promise<Linha[]> {
  return l.consultar<Linha>(
    `SELECT ni.id, ni.insumo_id, ni.quantidade_estoque, ni.custo_unitario, ni.lote_insumo_id, i.nome,
            COALESCE((SELECT SUM(di.quantidade) FROM devolucao_fornecedor_item di
                        JOIN devolucao_fornecedor d ON d.id = di.devolucao_fornecedor_id
                       WHERE di.nota_entrada_item_id = ni.id AND d.situacao <> 'cancelada'
                         AND d.excluido_em IS NULL AND di.excluido_em IS NULL), 0) AS devolvida,
            (SELECT GROUP_CONCAT(DISTINCT li.numero_lote ORDER BY li.validade SEPARATOR ', ')
               FROM movimento_estoque me JOIN movimento_lote ml ON ml.movimento_estoque_id = me.id
               JOIN lote_insumo li ON li.id = ml.lote_insumo_id
              WHERE me.nota_entrada_item_id = ni.id AND me.natureza = 'entrada') AS lotes
       FROM nota_entrada_item ni JOIN insumo i ON i.id = ni.insumo_id
      WHERE ni.nota_entrada_id = ? AND ni.excluido_em IS NULL ORDER BY ni.sequencia`,
    [nota],
  );
}

/** Parcelas a pagar em aberto dos títulos da nota de entrada (não cancelados nem renegociados). */
async function parcelasDaNota(l: Leitor, est: number, nota: number): Promise<Linha[]> {
  return l.consultar<Linha>(
    `SELECT p.id, p.saldo, p.vencimento, t.id AS titulo FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
      WHERE t.nota_entrada_id = ? AND t.estabelecimento_id = ? AND t.excluido_em IS NULL
        AND t.situacao NOT IN ('cancelado','renegociado') AND p.situacao IN ('aberta','parcial') AND p.saldo > 0
      ORDER BY p.vencimento, p.id`,
    [nota, est],
  );
}

/**
 * Os lotes que a devolução leva, entre os que entraram pela nota (o que vence primeiro sai primeiro). Cada lote vale o
 * menor entre o que entrou pela nota menos o que já voltou ao fornecedor em devoluções anteriores do mesmo item da
 * nota e o saldo livre do lote no local (sem bloqueio, liberado, fora do reservado): o lote já devolvido ou já
 * consumido não é mandado de novo. Sem saldo bastante nos lotes da nota, manda o que há e a conferência dos lotes da
 * saída recusa.
 */
async function lotesDaNota(
  tx: TxOperacao,
  est: number,
  local: number,
  notaItem: number,
  quantidade: number,
): Promise<LoteMandado[]> {
  const entrou = await tx.consultar<Linha>(
    `SELECT li.id, li.numero_lote, li.validade, SUM(ml.quantidade) AS quantidade
       FROM movimento_estoque me JOIN movimento_lote ml ON ml.movimento_estoque_id = me.id
       JOIN lote_insumo li ON li.id = ml.lote_insumo_id
      WHERE me.nota_entrada_item_id = ? AND me.natureza = 'entrada'
      GROUP BY li.id, li.numero_lote, li.validade ORDER BY li.validade IS NULL, li.validade, li.id`,
    [notaItem],
  );
  if (!entrou.length) return [];
  const voltou = await tx.consultar<Linha>(
    `SELECT ml.lote_insumo_id, SUM(ml.quantidade) AS quantidade
       FROM devolucao_fornecedor_item dfi
       JOIN movimento_estoque me ON me.devolucao_fornecedor_item_id = dfi.id AND me.natureza = 'saida'
       JOIN movimento_lote ml ON ml.movimento_estoque_id = me.id
      WHERE dfi.nota_entrada_item_id = ?
      GROUP BY ml.lote_insumo_id`,
    [notaItem],
  );
  const saldo = await tx.consultar<Linha>(
    `SELECT sl.lote_insumo_id, sl.quantidade, sl.quantidade_reservada, sl.bloqueado, li.situacao
       FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id AND li.excluido_em IS NULL
      WHERE sl.estabelecimento_id = ? AND sl.local_estoque_id = ? AND sl.excluido_em IS NULL
        AND sl.lote_insumo_id IN (${entrou.map(() => '?').join(',')})`,
    [est, local, ...entrou.map((l) => n(l['id']))],
  );
  const devolvido = new Map(voltou.map((r) => [n(r['lote_insumo_id']), n(r['quantidade'])]));
  const livre = new Map(
    saldo.map((r) => [
      n(r['lote_insumo_id']),
      n(r['bloqueado']) === 1 || r['situacao'] !== 'liberado'
        ? 0
        : Math.max(0, Math.min(n(r['quantidade']), n(r['quantidade']) - n(r['quantidade_reservada']))),
    ]),
  );
  const out: LoteMandado[] = [];
  let falta = q4(quantidade);
  for (const l of entrou) {
    if (falta <= 0) break;
    const id = n(l['id']);
    const cabe = Math.min(n(l['quantidade']) - (devolvido.get(id) ?? 0), livre.get(id) ?? 0);
    if (cabe <= 0) continue;
    const q = q4(Math.min(falta, cabe));
    out.push({ lote: t(l['numero_lote']), validade: dia(l['validade']), quantidade: q });
    falta = q4(falta - q);
  }
  // Nenhum lote da nota com saldo: manda o primeiro, para a conferência dos lotes recusar com o motivo certo.
  if (!out.length) {
    const l = entrou[0]!;
    out.push({ lote: t(l['numero_lote']), validade: dia(l['validade']), quantidade: q4(quantidade) });
  }
  return out;
}

async function registrarDevolucao(
  tx: TxOperacao,
  est: number,
  e: DevolucaoFornecedorEntrada,
  hoje: string,
  ctx: ContextoOperacao,
): Promise<ResultadoDevolucao> {
  const usuario = tx.contexto.usuario;
  if (usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  const [nota] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, numero, situacao, doacao, empresa_fornecedora_id, local_estoque_id, data_entrada, numero_documento
       FROM nota_entrada WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [e.nota, est],
    { teto: 1 },
  );
  if (!nota || n(nota['doacao']) === 1 || nota['empresa_fornecedora_id'] === null)
    throw recusa('nota-inexistente', 'A nota de compra não existe neste estabelecimento.', {
      campos: ['nota'],
    });
  const doBanco = await itensDaNota(tx, e.nota);
  const porId = new Map(doBanco.map((r) => [n(r['id']), r]));
  for (const i of e.itens)
    if (!porId.has(i.notaItem))
      throw recusa('item-fora-da-nota', 'Há item que não é desta nota de entrada.', { campos: ['itens'] });
  const motivo = await tx.uma<Linha>('SELECT id, ativo FROM motivo_devolucao_fornecedor WHERE id = ?', [
    e.motivo,
  ]);
  const paraConferir = e.itens.map((i) => {
    const r = porId.get(i.notaItem)!;
    return {
      notaItem: i.notaItem,
      quantidade: i.quantidade,
      recebida: n(r['quantidade_estoque']),
      jaDevolvida: n(r['devolvida']),
    };
  });
  const chaveAcesso = e.chaveAcesso ? e.chaveAcesso.replace(/\s/g, '') : null;
  recusar(
    conferirDevolucaoFornecedor({
      situacaoNota: t(nota['situacao']),
      entradaEm: dia(nota['data_entrada']),
      hoje,
      motivoAtivo: Boolean(motivo && n(motivo['ativo'])),
      itens: paraConferir,
      numeroNotaFiscal: e.numeroNotaFiscal ?? null,
      chaveAcesso,
      dataEmissao: e.dataEmissao ?? null,
    })[0],
  );
  const local = e.local ?? n(nota['local_estoque_id']);
  await exigirMesAberto(tx, est, hoje);
  await localDoEstabelecimento(tx, est, local);
  recusar(
    (await conferirPolitica(tx, {
      est,
      usuario,
      itens: e.itens.map((i) => n(porId.get(i.notaItem)!['insumo_id'])),
      acao: 'movimentar',
      locaisQueGuardam: [local],
    })) ?? undefined,
  );
  const fornecedor = n(nota['empresa_fornecedora_id']);
  const valores = valoresDevolucao(
    e.itens.map((i) => ({
      quantidade: i.quantidade,
      valorUnitario: n(porId.get(i.notaItem)!['custo_unitario']),
    })),
  );
  const tipo = tipoDaDevolucao(
    doBanco.map((r) => ({
      notaItem: n(r['id']),
      recebida: n(r['quantidade_estoque']),
      jaDevolvida: n(r['devolvida']),
    })),
    paraConferir,
  );
  const tipoMov = await tipoMovimentoId(tx, 'devolucao_fornecedor');
  await garantirSequencia(
    tx,
    { tipo: 'devolucao_fornecedor', estabelecimento: est, prefixo: null },
    { usuario, agora: new Date() },
  );
  const numero = String((await tx.proximoNumero('devolucao_fornecedor')).valor);
  const devolucao = await tx.incluir('devolucao_fornecedor', {
    estabelecimento_id: est,
    numero,
    tipo,
    empresa_fornecedora_id: fornecedor,
    nota_entrada_id: e.nota,
    motivo_devolucao_fornecedor_id: e.motivo,
    local_estoque_id: local,
    devolvido_em: new Date(),
    numero_nota_fiscal: e.numeroNotaFiscal || null,
    serie_nota_fiscal: e.serieNotaFiscal || null,
    chave_acesso: chaveAcesso || null,
    data_emissao: e.dataEmissao ?? null,
    valor_total: valores.total,
    abate_contas_pagar: e.abaterContasPagar,
    situacao: 'concluida',
    observacao: e.observacao || null,
  });
  for (const [k, i] of e.itens.entries()) {
    const r = porId.get(i.notaItem)!;
    const insumo = await insumoAtivo(tx, n(r['insumo_id']));
    const quantidade = q4(i.quantidade);
    const item = await tx.incluir('devolucao_fornecedor_item', {
      devolucao_fornecedor_id: devolucao,
      sequencia: k + 1,
      nota_entrada_item_id: i.notaItem,
      insumo_id: n(r['insumo_id']),
      unidade_medida_id: n(insumo['estoque_unidade_medida_id']),
      lote_insumo_id: r['lote_insumo_id'] ?? null,
      quantidade,
      valor_unitario: n(r['custo_unitario']),
      valor_total: valores.itens[k]!,
    });
    const lotes = await lotesDaSaida(
      tx,
      est,
      local,
      insumo,
      quantidade,
      await lotesDaNota(tx, est, local, i.notaItem, quantidade),
      hoje,
      undefined,
      'libera',
    );
    const mov = await movimentar(tx, est, {
      local,
      insumo: n(r['insumo_id']),
      quantidade,
      natureza: 'saida',
      tipoMovimento: tipoMov,
      valorSaida: valores.itens[k]!,
      lotes,
      hoje,
      fornecedor,
    });
    await tx.alterar('movimento_estoque', mov.id, 1, { devolucao_fornecedor_item_id: item });
  }
  // O crédito do fornecedor: uma nota de crédito recebida por parcela em aberto (vencimento mais próximo primeiro).
  let abatido = 0;
  let pendente = 0;
  let titulo: number | null = null;
  const notas: number[] = [];
  if (e.abaterContasPagar && valores.total > 0) {
    const parcelas = await parcelasDaNota(tx, est, e.nota);
    const plano = distribuirAbatimento(
      valores.total,
      parcelas.map((p) => ({ parcela: n(p['id']), saldo: n(p['saldo']), vencimento: dia(p['vencimento']) })),
    );
    pendente = plano.pendente;
    if (plano.abatimentos.length) {
      const m = await tx.uma<Linha>(
        "SELECT id FROM motivo_nota_credito_debito WHERE codigo = 'devolucao' AND ativo = TRUE",
      );
      if (!m)
        throw recusa(
          'motivo-nota-nao-configurado',
          'O motivo "devolucao" da nota de crédito não está no cadastro deste cliente.',
        );
      for (const a of plano.abatimentos) {
        const entrada: EmitirNotaEntrada = {
          lado: 'pagar',
          parcela: a.parcela,
          direcao: 'recebida',
          natureza: 'credito',
          motivo: n(m['id']),
          dataEmissao: hoje,
          dataVencimento: null,
          ...(e.serieNotaFiscal ? { serie: e.serieNotaFiscal } : {}),
          ...(e.numeroNotaFiscal ? { numeroDocumento: e.numeroNotaFiscal } : {}),
          valorItens: a.valor,
          valorDesconto: 0,
          valorOutros: 0,
          tributos: [],
          observacao: `Devolução ao fornecedor ${numero}`,
          aplicar: true,
        };
        const r = await OPERACOES_NOTA_CESSAO.emitirNota.gravar(tx, entrada, ctx);
        const nc = n(r['nota']);
        const v = await tx.uma<Linha>('SELECT versao FROM nota_credito_debito WHERE id = ?', [nc]);
        await tx.alterar('nota_credito_debito', nc, n(v?.['versao']), {
          devolucao_fornecedor_id: devolucao,
          nota_entrada_id: e.nota,
          local_estoque_id: local,
          tipo_conteudo: 'produto',
        });
        notas.push(nc);
        abatido = Math.round((abatido + a.valor) * 100) / 100;
        titulo ??= n(parcelas.find((p) => n(p['id']) === a.parcela)?.['titulo']) || null;
      }
    }
    await tx.alterar('devolucao_fornecedor', devolucao, 1, {
      titulo_pagar_id: titulo,
      valor_abatido: abatido,
      valor_credito_pendente: pendente,
    });
  }
  return {
    id: devolucao,
    numero,
    tipo,
    valorTotal: valores.total,
    valorAbatido: abatido,
    creditoPendente: pendente,
    notasCredito: notas.join(','),
  };
}

export class PortaDevolucaoFornecedorPropria implements PortaDevolucaoFornecedor {
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
      correlacao: c.correlacao || 'devolucao-fornecedor',
    };
  }

  notas(c: ContextoPortaM18, busca: string): Promise<NotaDevolvivel[]> {
    const ctx = this.contexto(c);
    const termo = busca.trim().slice(0, 60);
    const like = `%${termo.replace(/[%_\\]/g, '\\$&')}%`;
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT ne.id, ne.numero, ne.numero_documento, ne.data_entrada, ne.valor_total,
                  COALESCE(ef.nome_fantasia, ef.razao_social) AS fornecedor,
                  (SELECT COUNT(*) FROM nota_entrada_item ni WHERE ni.nota_entrada_id = ne.id AND ni.excluido_em IS NULL
                      AND ni.quantidade_estoque > COALESCE((SELECT SUM(di.quantidade) FROM devolucao_fornecedor_item di
                        JOIN devolucao_fornecedor d ON d.id = di.devolucao_fornecedor_id
                       WHERE di.nota_entrada_item_id = ni.id AND d.situacao <> 'cancelada'), 0)) AS disponiveis
             FROM nota_entrada ne JOIN empresa_fornecedora ef ON ef.id = ne.empresa_fornecedora_id
            WHERE ne.estabelecimento_id = ? AND ne.situacao = 'confirmada' AND ne.doacao = FALSE AND ne.excluido_em IS NULL
              AND (? = '' OR ne.numero_documento LIKE ? OR ef.razao_social LIKE ? OR ef.nome_fantasia LIKE ?)
            ORDER BY ne.data_entrada DESC, ne.id DESC LIMIT 50`,
          [ctx.estabelecimento, termo, like, like, like],
        )
      )
        .map((r) => ({
          id: n(r['id']),
          numero: n(r['numero']),
          documento: t(r['numero_documento']),
          fornecedor: t(r['fornecedor']),
          entradaEm: dia(r['data_entrada']),
          valorTotal: n(r['valor_total']),
          itensDisponiveis: n(r['disponiveis']),
        }))
        .filter((x) => x.itensDisponiveis > 0),
    );
  }

  nota(c: ContextoPortaM18, nota: number): Promise<NotaParaDevolver> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const r = await l.uma<Linha>(
        `SELECT ne.id, ne.numero, ne.numero_documento, ne.data_entrada, ne.situacao, ne.local_estoque_id,
                le.nome AS local_nome, COALESCE(ef.nome_fantasia, ef.razao_social) AS fornecedor
           FROM nota_entrada ne JOIN empresa_fornecedora ef ON ef.id = ne.empresa_fornecedora_id
           JOIN local_estoque le ON le.id = ne.local_estoque_id
          WHERE ne.id = ? AND ne.estabelecimento_id = ? AND ne.doacao = FALSE AND ne.excluido_em IS NULL`,
        [nota, ctx.estabelecimento],
      );
      if (!r)
        throw new ErroProblema('nao-encontrado', 404, 'Nota não encontrada', 'A nota de compra não existe.');
      const parcelas = await parcelasDaNota(l, ctx.estabelecimento, nota);
      return {
        id: n(r['id']),
        numero: n(r['numero']),
        documento: t(r['numero_documento']),
        fornecedor: t(r['fornecedor']),
        entradaEm: dia(r['data_entrada']),
        local: n(r['local_estoque_id']),
        localNome: t(r['local_nome']),
        situacao: t(r['situacao']),
        saldoAPagar: Math.round(parcelas.reduce((s, p) => s + n(p['saldo']), 0) * 100) / 100,
        itens: (await itensDaNota(l, nota)).map((i) => ({
          notaItem: n(i['id']),
          item: n(i['insumo_id']),
          nome: t(i['nome']),
          recebida: n(i['quantidade_estoque']),
          jaDevolvida: n(i['devolvida']),
          disponivel: disponivelParaDevolver({
            recebida: n(i['quantidade_estoque']),
            jaDevolvida: n(i['devolvida']),
          }),
          custoUnitario: n(i['custo_unitario']),
          lotes: t(i['lotes']),
        })),
      };
    });
  }

  motivos(c: ContextoPortaM18): Promise<MotivoDevolucao[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          'SELECT id, codigo, descricao, tipo_fiscal FROM motivo_devolucao_fornecedor WHERE ativo = TRUE ORDER BY descricao',
        )
      ).map((r) => ({
        id: n(r['id']),
        codigo: t(r['codigo']),
        descricao: t(r['descricao']),
        tipoFiscal: t(r['tipo_fiscal']),
      })),
    );
  }

  devolucoes(c: ContextoPortaM18): Promise<DevolucaoRegistrada[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT d.id, d.numero, d.tipo, d.devolvido_em, d.numero_nota_fiscal, d.valor_total, d.valor_abatido,
                  d.valor_credito_pendente, d.situacao, ne.numero_documento, m.descricao AS motivo,
                  COALESCE(ef.nome_fantasia, ef.razao_social) AS fornecedor,
                  (SELECT COUNT(*) FROM devolucao_fornecedor_item di WHERE di.devolucao_fornecedor_id = d.id) AS itens
             FROM devolucao_fornecedor d
             JOIN empresa_fornecedora ef ON ef.id = d.empresa_fornecedora_id
             JOIN motivo_devolucao_fornecedor m ON m.id = d.motivo_devolucao_fornecedor_id
             LEFT JOIN nota_entrada ne ON ne.id = d.nota_entrada_id
            WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL
            ORDER BY d.devolvido_em DESC, d.id DESC LIMIT 100`,
          [ctx.estabelecimento],
        )
      ).map((r) => ({
        id: n(r['id']),
        numero: t(r['numero']),
        tipo: t(r['tipo']),
        fornecedor: t(r['fornecedor']),
        documentoEntrada: t(r['numero_documento']),
        devolvidaEm: dia(r['devolvido_em']),
        motivo: t(r['motivo']),
        numeroNotaFiscal: r['numero_nota_fiscal'] === null ? null : t(r['numero_nota_fiscal']),
        itens: n(r['itens']),
        valorTotal: n(r['valor_total']),
        valorAbatido: n(r['valor_abatido']),
        creditoPendente: n(r['valor_credito_pendente']),
        situacao: t(r['situacao']),
      })),
    );
  }

  async registrar(
    c: ContextoPortaM18,
    e: DevolucaoFornecedorEntrada,
    chave: string,
  ): Promise<ResultadoDevolucao> {
    const ctxN = this.contexto(c);
    const hoje = await this.nucleo.lerSomente(ctxN, (l) => hojeNoEstabelecimento(l, ctxN.estabelecimento));
    const op = definirOperacao({
      nome: OPERACAO_DEVOLUCAO_FORNECEDOR,
      tabelas: [...TABELAS_DEVOLUCAO_FORNECEDOR],
      entrada: esquemaDevolucaoFornecedor,
      gravar: (tx: TxOperacao, x: DevolucaoFornecedorEntrada, ctx: ContextoOperacao) =>
        registrarDevolucao(tx, ctxN.estabelecimento, x, hoje, ctx),
      alvo: (_e, r: ResultadoDevolucao) => ({ tabela: 'devolucao_fornecedor', id: r.id }),
      trilha: (x: DevolucaoFornecedorEntrada) => ({
        dados: { nota: x.nota, motivo: x.motivo, itens: x.itens.length, abate: x.abaterContasPagar },
        motivo: null,
      }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, e, ctx);
    return resultado as ResultadoDevolucao;
  }
}

export function portaDevolucaoFornecedorIndisponivel(): PortaDevolucaoFornecedor {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'A devolução ao fornecedor exige o banco próprio.');
  };
  return {
    destino: 'indisponivel',
    notas: falha,
    nota: falha,
    motivos: falha,
    devolucoes: falha,
    registrar: falha,
  };
}
