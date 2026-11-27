// Ata de registro de preços e nota de empenho (C2-030, 05-SUP linha 26; Lei 14.133/2021, art. 82 a 86, e Lei 4.320/1964,
// art. 58 a 61) sobre o MariaDB do cliente pelo Executor do núcleo (trilha na mesma transação, versão conferida,
// Idempotency-Key). A regra pura mora em `@sgh/contratos/regras-suprimentos` (ata-empenho); aqui fica a gravação:
//   - ata_registro_preco e ata_registro_preco_item: a ata assinada (vigente, com quem a fechou e quando), os itens com o
//     fornecedor, a quantidade registrada, o preço e o saldo (registrada menos utilizada); da ata ligada ao processo
//     homologado, a tela traz os itens adjudicados prontos (o vencedor e o valor adjudicado);
//   - empenho e empenho_item: a nota de empenho de um credor só, com a fonte de recurso, cada item ligado ao item da ata
//     cujo saldo consome; o item da ata esgotado muda de situação;
//   - a anulação do empenho (só do emitido, sem execução, com motivo) devolve o saldo à ata e fica registrada: nada é
//     apagado.
import {
  conferirAta,
  conferirEmpenho,
  type ItemAdjudicado,
  type ItemAtaRelido,
  podeAnularEmpenho,
  type RecusaSuprimentos,
  saldoItemAta,
  type SituacaoAta,
  type SituacaoItemAta,
  situacaoItemAtaApos,
  totalEmpenho,
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
import {
  type AdesaoVisao,
  decidirAdesao,
  type EntradaAdesao,
  type EntradaDecisaoAdesao,
  esquemaAdesao,
  esquemaDecisaoAdesao,
  lerAdesoes,
  OPERACAO_DECIDIR_ADESAO,
  OPERACAO_SOLICITAR_ADESAO,
  solicitarAdesao,
  TABELAS_ADESAO,
} from './adesao-ata.js';
import { hojeNoEstabelecimento, insumoAtivo } from './porta-propria.js';
import {
  type CandidatosReferenciaVisao,
  type EntradaReferenciaEmpenho,
  esquemaReferenciaEmpenho,
  lerCandidatos,
  lerExportacao,
  lerReferencias,
  OPERACAO_REFERIR_PEDIDO,
  OPERACAO_REFERIR_TITULO,
  type ReferenciasEmpenhoVisao,
  referirPedido,
  referirTitulo,
  TABELAS_REFERIR_PEDIDO,
  TABELAS_REFERIR_TITULO,
} from './referencia-empenho.js';

export const PORTA_ATA_EMPENHO = Symbol('PORTA_ATA_EMPENHO');
export const OPERACAO_ATA = 'suprimentos.ata-registro-preco.registrar';
export const OPERACAO_EMPENHO = 'suprimentos.empenho.emitir';
export const OPERACAO_ANULAR_EMPENHO = 'suprimentos.empenho.anular';
export const TABELAS_ATA = ['ata_registro_preco', 'ata_registro_preco_item'] as const;
export const TABELAS_EMPENHO = ['empenho', 'empenho_item', 'ata_registro_preco_item'] as const;

const id = z.number().int().positive();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const esquemaAta = z
  .object({
    numero: z.string().trim().min(1).max(30),
    objeto: z.string().trim().min(1).max(500),
    vigenciaInicio: dataIso,
    vigenciaFim: dataIso,
    processo: id.nullable(),
    observacao: z.string().trim().max(2000).nullable().optional(),
    itens: z
      .array(
        z
          .object({
            insumo: id,
            fornecedor: id,
            quantidade: z.number().positive().max(999_999_999),
            valorUnitario: z.number().nonnegative().max(999_999_999),
            marca: z.string().trim().max(70).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(300),
  })
  .strict();
export type EntradaAta = z.infer<typeof esquemaAta>;

export const esquemaEmpenho = z
  .object({
    numero: z.string().trim().min(1).max(20),
    emitidoEm: dataIso,
    validoAte: dataIso.nullable(),
    fonteRecurso: z.string().trim().min(1).max(60),
    naturezaDespesa: z.string().trim().max(20).nullable().optional(),
    observacao: z.string().trim().max(2000).nullable().optional(),
    itens: z
      .array(z.object({ ataItem: id, quantidade: z.number().positive().max(999_999_999) }).strict())
      .min(1)
      .max(300),
  })
  .strict();
export type EntradaEmpenho = z.infer<typeof esquemaEmpenho>;

export const esquemaAnulacaoEmpenho = z
  .object({ motivo: z.string().trim().min(1).max(500), versao: z.number().int().positive() })
  .strict();
export type EntradaAnulacaoEmpenho = z.infer<typeof esquemaAnulacaoEmpenho>;

export interface ItemAtaVisao {
  readonly id: number;
  readonly sequencia: number;
  readonly insumo: number;
  readonly insumoNome: string;
  readonly fornecedor: number;
  readonly fornecedorNome: string;
  readonly registrada: number;
  readonly utilizada: number;
  readonly saldo: number;
  readonly valorUnitario: number;
  readonly situacao: SituacaoItemAta;
}
export interface AtaVisao {
  readonly id: number;
  readonly numero: string;
  readonly objeto: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string;
  readonly situacao: SituacaoAta;
  readonly processo: string | null;
  readonly itens: readonly ItemAtaVisao[];
}
export interface EmpenhoVisao {
  readonly id: number;
  readonly numero: string;
  readonly emitidoEm: string;
  readonly fornecedor: string;
  readonly fonteRecurso: string;
  readonly valorTotal: number;
  readonly situacao: string;
  readonly ata: string | null;
  readonly itens: number;
  readonly versao: number;
  readonly motivoAnulacao: string | null;
}
/** O processo homologado com os itens adjudicados, prontos para a ata. */
export interface ProcessoParaAta {
  readonly id: number;
  readonly numero: string;
  readonly objeto: string;
  readonly itens: readonly {
    readonly insumo: number;
    readonly insumoNome: string;
    readonly fornecedor: number;
    readonly fornecedorNome: string;
    readonly quantidade: number;
    readonly valor: number;
  }[];
}
// Tipo (não interface) para servir de resultado da operação, que só guarda valores simples.
export type ResultadoAtaEmpenho = {
  readonly id: number;
  readonly numero: string;
  readonly itens: number;
  readonly valorTotal: number;
};

export interface PortaAtaEmpenho {
  readonly destino: 'banco' | 'indisponivel';
  atas(c: ContextoPortaM18): Promise<AtaVisao[]>;
  empenhos(c: ContextoPortaM18): Promise<EmpenhoVisao[]>;
  processosHomologados(c: ContextoPortaM18): Promise<ProcessoParaAta[]>;
  registrarAta(c: ContextoPortaM18, e: EntradaAta, chave: string): Promise<ResultadoAtaEmpenho>;
  emitirEmpenho(c: ContextoPortaM18, e: EntradaEmpenho, chave: string): Promise<ResultadoAtaEmpenho>;
  anularEmpenho(
    c: ContextoPortaM18,
    empenho: number,
    e: EntradaAnulacaoEmpenho,
    chave: string,
  ): Promise<ResultadoAtaEmpenho>;
  /** C3-025 (07-FIN linha 132): só a referência do empenho no pedido e no título, com a exportação para o ente. */
  referencias(c: ContextoPortaM18, empenho: number): Promise<ReferenciasEmpenhoVisao>;
  candidatosReferencia(
    c: ContextoPortaM18,
    empenho: number,
    termo: string,
  ): Promise<CandidatosReferenciaVisao>;
  referirPedido(
    c: ContextoPortaM18,
    empenho: number,
    e: EntradaReferenciaEmpenho,
    chave: string,
  ): Promise<ResultadoAtaEmpenho>;
  referirTitulo(
    c: ContextoPortaM18,
    empenho: number,
    e: EntradaReferenciaEmpenho,
    chave: string,
  ): Promise<ResultadoAtaEmpenho>;
  exportacao(c: ContextoPortaM18, inicio: string, fim: string): Promise<string>;
  /** C2-017 (09-AREA linha 81): adesão à ata de registro de preços (Lei 14.133, art. 86). */
  adesoes(c: ContextoPortaM18): Promise<AdesaoVisao[]>;
  solicitarAdesao(c: ContextoPortaM18, e: EntradaAdesao, chave: string): Promise<ResultadoAtaEmpenho>;
  decidirAdesao(
    c: ContextoPortaM18,
    adesao: number,
    e: EntradaDecisaoAdesao,
    chave: string,
  ): Promise<ResultadoAtaEmpenho>;
}

const n = (v: unknown) => Number(v ?? 0);
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const dia = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : t(v).slice(0, 10);

function recusar(r: RecusaSuprimentos | null | undefined): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : undefined);
}
function exigirUsuario(tx: TxOperacao): number {
  const u = tx.contexto.usuario;
  if (u === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return u;
}

/** Os itens adjudicados do processo (o vencedor pela proposta do item e o valor adjudicado). */
const SQL_ADJUDICADOS = `SELECT i.insumo_id, i.quantidade, i.valor_adjudicado, pl.empresa_fornecedora_id,
        ins.nome AS insumo_nome, COALESCE(ef.nome_fantasia, ef.razao_social) AS fornecedor_nome
   FROM processo_licitatorio_item i
   JOIN proposta_licitacao_item pi ON pi.id = i.vencedora_proposta_licitacao_item_id
   JOIN proposta_licitacao pl ON pl.id = pi.proposta_licitacao_id
   JOIN insumo ins ON ins.id = i.insumo_id
   JOIN empresa_fornecedora ef ON ef.id = pl.empresa_fornecedora_id
  WHERE i.processo_licitatorio_id = ? AND i.resultado_julgamento = 'adjudicavel' AND i.insumo_id IS NOT NULL
  ORDER BY i.sequencia`;

async function registrarAta(tx: TxOperacao, est: number, e: EntradaAta): Promise<ResultadoAtaEmpenho> {
  const usuario = exigirUsuario(tx);
  let processo: { etapa: string; adjudicados: ItemAdjudicado[] } | null = null;
  if (e.processo !== null) {
    const p = await tx.uma<Linha>(
      'SELECT etapa FROM processo_licitatorio WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.processo, est],
    );
    if (!p)
      throw recusa('processo-inexistente', 'O processo não existe neste estabelecimento.', {
        campos: ['processo'],
      });
    const adj = await tx.consultar<Linha>(SQL_ADJUDICADOS, [e.processo]);
    processo = {
      etapa: t(p['etapa']),
      adjudicados: adj.map((r) => ({
        insumo: n(r['insumo_id']),
        fornecedor: n(r['empresa_fornecedora_id']),
        valor: n(r['valor_adjudicado']),
      })),
    };
  }
  recusar(conferirAta({ ...e, processo })[0]);
  if (
    await tx.uma(
      'SELECT id FROM ata_registro_preco WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL',
      [est, e.numero],
    )
  )
    throw recusa('ata-numero-repetido', 'Já existe uma ata com este número.', { campos: ['numero'] });
  for (const [k, it] of e.itens.entries()) {
    const f = await tx.uma(
      "SELECT id FROM empresa_fornecedora WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
      [it.fornecedor],
    );
    if (!f)
      throw recusa('fornecedor-inativo', `O fornecedor do item ${k + 1} não está ativo no cadastro.`, {
        campos: [`itens.${k}.fornecedor`],
      });
  }
  const ata = await tx.incluir('ata_registro_preco', {
    estabelecimento_id: est,
    numero: e.numero,
    processo_licitatorio_id: e.processo,
    objeto: e.objeto,
    vigencia_inicio: e.vigenciaInicio,
    vigencia_fim: e.vigenciaFim,
    fechado_em: new Date(),
    fechado_por_usuario_id: usuario,
    situacao: 'vigente',
    observacao: e.observacao ?? null,
  });
  let total = 0;
  for (const [k, it] of e.itens.entries()) {
    const insumo = await insumoAtivo(tx, it.insumo);
    await tx.incluir('ata_registro_preco_item', {
      ata_registro_preco_id: ata,
      sequencia: k + 1,
      insumo_id: it.insumo,
      empresa_fornecedora_id: it.fornecedor,
      marca: it.marca ?? null,
      unidade_medida_id: insumo['estoque_unidade_medida_id'] ?? null,
      quantidade_registrada: it.quantidade,
      quantidade_utilizada: 0,
      valor_unitario: it.valorUnitario,
      situacao: 'ativo',
    });
    total += it.quantidade * it.valorUnitario;
  }
  return { id: ata, numero: e.numero, itens: e.itens.length, valorTotal: Math.round(total * 100) / 100 };
}

async function itemDaAta(tx: TxOperacao, est: number, ataItem: number): Promise<ItemAtaRelido & Linha> {
  const r = await tx.uma<Linha>(
    `SELECT i.id, i.situacao, i.empresa_fornecedora_id, i.quantidade_registrada, i.quantidade_utilizada,
            i.valor_unitario, i.versao, i.insumo_id, i.unidade_medida_id, i.marca, i.ata_registro_preco_id,
            a.situacao AS ata_situacao, a.vigencia_inicio, a.vigencia_fim
       FROM ata_registro_preco_item i JOIN ata_registro_preco a ON a.id = i.ata_registro_preco_id
      WHERE i.id = ? AND a.estabelecimento_id = ? AND i.excluido_em IS NULL AND a.excluido_em IS NULL`,
    [ataItem, est],
  );
  if (!r)
    throw recusa('ata-item-inexistente', 'O item da ata não existe neste estabelecimento.', {
      campos: ['itens'],
    });
  return {
    ...r,
    id: n(r['id']),
    situacao: t(r['situacao']) as SituacaoItemAta,
    fornecedor: n(r['empresa_fornecedora_id']),
    registrada: n(r['quantidade_registrada']),
    utilizada: n(r['quantidade_utilizada']),
    valorUnitario: n(r['valor_unitario']),
    ata: {
      situacao: t(r['ata_situacao']) as SituacaoAta,
      vigenciaInicio: dia(r['vigencia_inicio']),
      vigenciaFim: dia(r['vigencia_fim']),
    },
  };
}

async function emitirEmpenho(
  tx: TxOperacao,
  est: number,
  e: EntradaEmpenho,
  hoje: string,
): Promise<ResultadoAtaEmpenho> {
  exigirUsuario(tx);
  const relidos = [];
  for (const it of e.itens)
    relidos.push({ quantidade: it.quantidade, ataItem: await itemDaAta(tx, est, it.ataItem) });
  recusar(conferirEmpenho({ ...e, hoje, itens: relidos })[0]);
  if (
    await tx.uma(
      'SELECT id FROM empenho WHERE estabelecimento_id = ? AND numero_empenho = ? AND excluido_em IS NULL',
      [est, e.numero],
    )
  )
    throw recusa('empenho-numero-repetido', 'Já existe um empenho com este número.', { campos: ['numero'] });
  const parcelas = totalEmpenho(
    relidos.map((r) => ({ quantidade: r.quantidade, valorUnitario: r.ataItem.valorUnitario })),
  );
  const atas = new Set(relidos.map((r) => n(r.ataItem['ata_registro_preco_id'])));
  const empenho = await tx.incluir('empenho', {
    estabelecimento_id: est,
    numero_empenho: e.numero,
    empresa_fornecedora_id: relidos[0]!.ataItem.fornecedor,
    ata_registro_preco_id: atas.size === 1 ? [...atas][0] : null,
    emitido_em: e.emitidoEm,
    valido_ate: e.validoAte,
    fonte_recurso: e.fonteRecurso,
    natureza_despesa: e.naturezaDespesa ?? null,
    valor_total: parcelas.total,
    valor_liquidado: 0,
    observacao: e.observacao ?? null,
    situacao: 'emitido',
  });
  for (const [k, r] of relidos.entries()) {
    const a = r.ataItem;
    await tx.incluir('empenho_item', {
      empenho_id: empenho,
      sequencia: k + 1,
      ata_registro_preco_item_id: a.id,
      insumo_id: n(a['insumo_id']),
      unidade_medida_id: a['unidade_medida_id'] ?? null,
      quantidade_homologada: a.registrada,
      quantidade_empenhada: r.quantidade,
      valor_unitario: a.valorUnitario,
      valor_total: parcelas.itens[k],
      marca: tn(a['marca'])?.slice(0, 60) ?? null,
      situacao: 'aberto',
    });
    const utilizada = Math.round((a.utilizada + r.quantidade) * 10_000) / 10_000;
    await tx.alterar('ata_registro_preco_item', a.id, n(a['versao']), {
      quantidade_utilizada: utilizada,
      situacao: situacaoItemAtaApos(a.situacao, a.registrada, utilizada),
    });
  }
  return { id: empenho, numero: e.numero, itens: relidos.length, valorTotal: parcelas.total };
}

async function anularEmpenho(
  tx: TxOperacao,
  est: number,
  empenho: number,
  e: EntradaAnulacaoEmpenho,
): Promise<ResultadoAtaEmpenho> {
  const usuario = exigirUsuario(tx);
  const emp = await tx.uma<Linha>(
    `SELECT id, numero_empenho, situacao, valor_liquidado, valor_total, versao FROM empenho
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [empenho, est],
  );
  if (!emp) throw new ErroProblema('nao-encontrado', 404, 'Empenho não encontrado', 'O empenho não existe.');
  const itens = await tx.consultar<Linha>(
    `SELECT id, versao, quantidade_empenhada, quantidade_recebida, ata_registro_preco_item_id FROM empenho_item
      WHERE empenho_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [empenho],
  );
  recusar(
    podeAnularEmpenho({
      situacao: t(emp['situacao']),
      valorLiquidado: n(emp['valor_liquidado']),
      quantidadeRecebida: itens.reduce((s, i) => s + n(i['quantidade_recebida']), 0),
      motivo: e.motivo,
    }),
  );
  await tx.alterar('empenho', empenho, e.versao, {
    situacao: 'anulado',
    cancelado_em: new Date(),
    motivo_anulacao: e.motivo,
    anulado_por_usuario_id: usuario,
  });
  for (const i of itens) {
    await tx.alterar('empenho_item', n(i['id']), n(i['versao']), { situacao: 'cancelado' });
    const ai = i['ata_registro_preco_item_id'];
    if (ai === null || ai === undefined) continue;
    const a = await itemDaAta(tx, est, n(ai));
    const utilizada = Math.max(0, Math.round((a.utilizada - n(i['quantidade_empenhada'])) * 10_000) / 10_000);
    await tx.alterar('ata_registro_preco_item', a.id, n(a['versao']), {
      quantidade_utilizada: utilizada,
      situacao: situacaoItemAtaApos(a.situacao, a.registrada, utilizada),
    });
  }
  return {
    id: empenho,
    numero: t(emp['numero_empenho']),
    itens: itens.length,
    valorTotal: n(emp['valor_total']),
  };
}

export class PortaAtaEmpenhoPropria implements PortaAtaEmpenho {
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
      correlacao: c.correlacao || 'ata-empenho',
    };
  }

  atas(c: ContextoPortaM18): Promise<AtaVisao[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const atas = await l.consultar<Linha>(
        `SELECT a.id, a.numero, a.objeto, a.vigencia_inicio, a.vigencia_fim, a.situacao, p.numero AS processo
           FROM ata_registro_preco a LEFT JOIN processo_licitatorio p ON p.id = a.processo_licitatorio_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
          ORDER BY a.vigencia_fim DESC, a.id DESC LIMIT 100`,
        [ctx.estabelecimento],
      );
      const ids = atas.map((a) => n(a['id']));
      const itens = ids.length
        ? await l.consultar<Linha>(
            `SELECT i.id, i.ata_registro_preco_id, i.sequencia, i.insumo_id, ins.nome AS insumo_nome,
                    i.empresa_fornecedora_id, COALESCE(ef.nome_fantasia, ef.razao_social) AS fornecedor_nome,
                    i.quantidade_registrada, i.quantidade_utilizada, i.valor_unitario, i.situacao
               FROM ata_registro_preco_item i
               JOIN insumo ins ON ins.id = i.insumo_id
               JOIN empresa_fornecedora ef ON ef.id = i.empresa_fornecedora_id
              WHERE i.ata_registro_preco_id IN (${ids.map(() => '?').join(',')}) AND i.excluido_em IS NULL
              ORDER BY i.ata_registro_preco_id, i.sequencia`,
            ids,
          )
        : [];
      return atas.map((a) => ({
        id: n(a['id']),
        numero: t(a['numero']),
        objeto: t(a['objeto']),
        vigenciaInicio: dia(a['vigencia_inicio']),
        vigenciaFim: dia(a['vigencia_fim']),
        situacao: t(a['situacao']) as SituacaoAta,
        processo: tn(a['processo']),
        itens: itens
          .filter((i) => n(i['ata_registro_preco_id']) === n(a['id']))
          .map((i) => ({
            id: n(i['id']),
            sequencia: n(i['sequencia']),
            insumo: n(i['insumo_id']),
            insumoNome: t(i['insumo_nome']),
            fornecedor: n(i['empresa_fornecedora_id']),
            fornecedorNome: t(i['fornecedor_nome']),
            registrada: n(i['quantidade_registrada']),
            utilizada: n(i['quantidade_utilizada']),
            saldo: saldoItemAta(n(i['quantidade_registrada']), n(i['quantidade_utilizada'])),
            valorUnitario: n(i['valor_unitario']),
            situacao: t(i['situacao']) as SituacaoItemAta,
          })),
      }));
    });
  }

  empenhos(c: ContextoPortaM18): Promise<EmpenhoVisao[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT e.id, e.numero_empenho, e.emitido_em, e.fonte_recurso, e.valor_total, e.situacao, e.versao,
                  e.motivo_anulacao, COALESCE(ef.nome_fantasia, ef.razao_social) AS fornecedor, a.numero AS ata,
                  (SELECT COUNT(*) FROM empenho_item ei WHERE ei.empenho_id = e.id AND ei.excluido_em IS NULL) AS itens
             FROM empenho e
             JOIN empresa_fornecedora ef ON ef.id = e.empresa_fornecedora_id
             LEFT JOIN ata_registro_preco a ON a.id = e.ata_registro_preco_id
            WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL
            ORDER BY e.emitido_em DESC, e.id DESC LIMIT 100`,
          [ctx.estabelecimento],
        )
      ).map((r) => ({
        id: n(r['id']),
        numero: t(r['numero_empenho']),
        emitidoEm: dia(r['emitido_em']),
        fornecedor: t(r['fornecedor']),
        fonteRecurso: t(r['fonte_recurso']),
        valorTotal: n(r['valor_total']),
        situacao: t(r['situacao']),
        ata: tn(r['ata']),
        itens: n(r['itens']),
        versao: n(r['versao']),
        motivoAnulacao: tn(r['motivo_anulacao']),
      })),
    );
  }

  processosHomologados(c: ContextoPortaM18): Promise<ProcessoParaAta[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const ps = await l.consultar<Linha>(
        `SELECT p.id, p.numero, p.objeto FROM processo_licitatorio p
          WHERE p.estabelecimento_id = ? AND p.etapa = 'homologado' AND p.excluido_em IS NULL
            AND NOT EXISTS (SELECT 1 FROM ata_registro_preco a WHERE a.processo_licitatorio_id = p.id
                             AND a.situacao <> 'cancelada' AND a.excluido_em IS NULL)
          ORDER BY p.id DESC LIMIT 50`,
        [ctx.estabelecimento],
      );
      const r: ProcessoParaAta[] = [];
      for (const p of ps)
        r.push({
          id: n(p['id']),
          numero: t(p['numero']),
          objeto: t(p['objeto']),
          itens: (await l.consultar<Linha>(SQL_ADJUDICADOS, [n(p['id'])])).map((i) => ({
            insumo: n(i['insumo_id']),
            insumoNome: t(i['insumo_nome']),
            fornecedor: n(i['empresa_fornecedora_id']),
            fornecedorNome: t(i['fornecedor_nome']),
            quantidade: n(i['quantidade']),
            valor: n(i['valor_adjudicado']),
          })),
        });
      return r;
    });
  }

  private async executar<E>(
    c: ContextoPortaM18,
    chave: string,
    nome: string,
    tabelas: readonly string[],
    esquema: z.ZodType<E>,
    entrada: E,
    gravar: (tx: TxOperacao, est: number, x: E, hoje: string) => Promise<ResultadoAtaEmpenho>,
    tabelaAlvo: string,
    dados: (x: E) => Record<string, string | number | null>,
  ): Promise<ResultadoAtaEmpenho> {
    const ctxN = this.contexto(c);
    const hoje = await this.nucleo.lerSomente(ctxN, (l) => hojeNoEstabelecimento(l, ctxN.estabelecimento));
    const op = definirOperacao({
      nome,
      tabelas: [...tabelas],
      entrada: esquema,
      gravar: (tx: TxOperacao, x: E) => gravar(tx, ctxN.estabelecimento, x, hoje),
      alvo: (_e, r: ResultadoAtaEmpenho) => ({ tabela: tabelaAlvo, id: r.id }),
      trilha: (x: E) => ({ dados: dados(x), motivo: null }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as ResultadoAtaEmpenho;
  }

  registrarAta(c: ContextoPortaM18, e: EntradaAta, chave: string) {
    return this.executar(
      c,
      chave,
      OPERACAO_ATA,
      TABELAS_ATA,
      esquemaAta,
      e,
      registrarAta,
      'ata_registro_preco',
      (x) => ({
        numero: x.numero,
        processo: x.processo,
        itens: x.itens.length,
      }),
    );
  }

  emitirEmpenho(c: ContextoPortaM18, e: EntradaEmpenho, chave: string) {
    return this.executar(
      c,
      chave,
      OPERACAO_EMPENHO,
      TABELAS_EMPENHO,
      esquemaEmpenho,
      e,
      emitirEmpenho,
      'empenho',
      (x) => ({
        numero: x.numero,
        itens: x.itens.length,
      }),
    );
  }

  anularEmpenho(c: ContextoPortaM18, empenho: number, e: EntradaAnulacaoEmpenho, chave: string) {
    return this.executar(
      c,
      chave,
      OPERACAO_ANULAR_EMPENHO,
      TABELAS_EMPENHO,
      esquemaAnulacaoEmpenho,
      e,
      (tx, est, x) => anularEmpenho(tx, est, empenho, x),
      'empenho',
      () => ({ empenho }),
    );
  }

  referencias(c: ContextoPortaM18, empenho: number): Promise<ReferenciasEmpenhoVisao> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, (l) => lerReferencias(l, ctx.estabelecimento, empenho));
  }

  candidatosReferencia(
    c: ContextoPortaM18,
    empenho: number,
    termo: string,
  ): Promise<CandidatosReferenciaVisao> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, (l) => lerCandidatos(l, ctx.estabelecimento, empenho, termo));
  }

  exportacao(c: ContextoPortaM18, inicio: string, fim: string): Promise<string> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, (l) => lerExportacao(l, ctx.estabelecimento, inicio, fim));
  }

  referirPedido(c: ContextoPortaM18, empenho: number, e: EntradaReferenciaEmpenho, chave: string) {
    return this.executar(
      c,
      chave,
      OPERACAO_REFERIR_PEDIDO,
      TABELAS_REFERIR_PEDIDO,
      esquemaReferenciaEmpenho,
      e,
      (tx, est, x) => referirPedido(tx, est, empenho, x),
      'pedido_compra',
      (x) => ({ empenho, pedido: x.id }),
    );
  }

  referirTitulo(c: ContextoPortaM18, empenho: number, e: EntradaReferenciaEmpenho, chave: string) {
    return this.executar(
      c,
      chave,
      OPERACAO_REFERIR_TITULO,
      TABELAS_REFERIR_TITULO,
      esquemaReferenciaEmpenho,
      e,
      (tx, est, x) => referirTitulo(tx, est, empenho, x),
      'titulo_pagar',
      (x) => ({ empenho, titulo: x.id }),
    );
  }

  adesoes(c: ContextoPortaM18): Promise<AdesaoVisao[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, (l) => lerAdesoes(l, ctx.estabelecimento));
  }

  solicitarAdesao(c: ContextoPortaM18, e: EntradaAdesao, chave: string) {
    return this.executar(
      c,
      chave,
      OPERACAO_SOLICITAR_ADESAO,
      TABELAS_ADESAO,
      esquemaAdesao,
      e,
      solicitarAdesao,
      'adesao_ata_registro_preco',
      (x) => ({ numero: x.numero, tipo: x.tipo, ata: x.ata, insumo: x.insumo }),
    );
  }

  decidirAdesao(c: ContextoPortaM18, adesao: number, e: EntradaDecisaoAdesao, chave: string) {
    return this.executar(
      c,
      chave,
      OPERACAO_DECIDIR_ADESAO,
      TABELAS_ADESAO,
      esquemaDecisaoAdesao,
      e,
      (tx, est, x) => decidirAdesao(tx, est, adesao, x),
      'adesao_ata_registro_preco',
      (x) => ({ adesao, decisao: x.decisao }),
    );
  }
}

export function portaAtaEmpenhoIndisponivel(): PortaAtaEmpenho {
  const falha = (): never => {
    throw new ErroProblema(
      'indisponivel',
      503,
      'A ata de registro de preços e o empenho exigem o banco próprio.',
    );
  };
  return {
    destino: 'indisponivel',
    atas: falha,
    empenhos: falha,
    processosHomologados: falha,
    registrarAta: falha,
    emitirEmpenho: falha,
    anularEmpenho: falha,
    referencias: falha,
    candidatosReferencia: falha,
    referirPedido: falha,
    referirTitulo: falha,
    exportacao: falha,
    adesoes: falha,
    solicitarAdesao: falha,
    decidirAdesao: falha,
  };
}
