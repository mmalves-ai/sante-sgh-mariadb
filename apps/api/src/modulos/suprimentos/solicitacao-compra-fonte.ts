// Solicitação de compra pública com a fonte de recurso de cada item (C2-017, 09-AREA linha 81; Lei 14.133/2021, art. 72,
// IV, e art. 150; Lei 4.320/1964, art. 60), sobre o MariaDB do cliente, pela porta da ata e do empenho (Executor do
// núcleo: trilha na mesma transação, Idempotency-Key). A regra pura mora em `@sgh/contratos/regras-suprimentos`
// (fonte-recurso-compra); aqui fica a gravação:
//   - solicitacao_compra: número de negócio pela sequência do estabelecimento, o local que recebe, a fonte principal
//     (origem_recurso_compra_id) e, se informado, o processo licitatório do mesmo estabelecimento;
//   - solicitacao_compra_item: o insumo, a unidade de estoque, a quantidade e o valor estimado;
//   - solicitacao_compra_fonte_recurso: quanto de cada item cada fonte custeia (quantidade ou percentual).
// As fontes vêm do cadastro de origens de recurso (domínio de suprimentos, Administração > Cadastros); só as ativas.
import {
  conferirFontesSolicitacao,
  fontePrincipal,
  type RecusaSuprimentos,
} from '@sgh/contratos/regras-suprimentos';
import { type Linha, recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { insumoAtivo } from './porta-propria.js';

export const OPERACAO_SOLICITAR_COMPRA_PUBLICA = 'suprimentos.solicitacao-compra.registrar';
export const TABELAS_SOLICITACAO_COMPRA = [
  'solicitacao_compra',
  'solicitacao_compra_item',
  'solicitacao_compra_fonte_recurso',
  'sequencia_negocio',
] as const;

const id = z.number().int().positive();
const parcela = z
  .object({
    origem: id,
    quantidade: z.number().positive().max(999_999_999).nullable(),
    percentual: z.number().positive().max(100).nullable(),
  })
  .strict();
export const esquemaSolicitacaoCompraPublica = z
  .object({
    tipo: z.enum(['insumo', 'registro_preco']),
    localEstoque: id,
    processo: id.nullable().optional(),
    necessarioAte: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    justificativa: z.string().trim().min(1).max(2000),
    itens: z
      .array(
        z
          .object({
            insumo: id,
            quantidade: z.number().positive().max(999_999_999),
            valorUnitarioEstimado: z.number().nonnegative().max(999_999_999).nullable().optional(),
            fontes: z.array(parcela).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type EntradaSolicitacaoCompraPublica = z.infer<typeof esquemaSolicitacaoCompraPublica>;

export interface OrigemRecursoVisao {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly esfera: string | null;
}

export interface FonteItemVisao {
  readonly origem: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: number | null;
  readonly percentual: number | null;
}

export interface SolicitacaoCompraPublicaVisao {
  readonly id: number;
  readonly numero: number;
  readonly tipo: string;
  readonly situacao: string;
  readonly solicitadoEm: string;
  readonly processo: string | null;
  readonly fontePrincipal: string | null;
  readonly valorEstimado: number | null;
  readonly itens: readonly {
    readonly sequencia: number;
    readonly insumoNome: string;
    readonly quantidade: number;
    readonly valorUnitarioEstimado: number | null;
    readonly fontes: readonly FonteItemVisao[];
  }[];
}

export type ResultadoSolicitacaoCompra = {
  readonly id: number;
  readonly numero: string;
  readonly itens: number;
  readonly valorTotal: number;
};

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));

function recusar(r: RecusaSuprimentos | undefined): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : undefined);
}

export async function lerOrigensRecurso(l: {
  consultar: TxOperacao['consultar'];
}): Promise<OrigemRecursoVisao[]> {
  const linhas = await l.consultar<Linha>(
    'SELECT id, codigo, descricao, esfera FROM origem_recurso_compra WHERE ativo = TRUE ORDER BY descricao, id',
    [],
  );
  return linhas.map((r) => ({
    id: n(r['id']),
    codigo: t(r['codigo']),
    descricao: t(r['descricao']),
    esfera: tn(r['esfera']),
  }));
}

export interface ApoioSolicitacaoCompra {
  readonly origens: readonly OrigemRecursoVisao[];
  readonly locais: readonly { readonly id: number; readonly nome: string }[];
  readonly insumos: readonly { readonly id: number; readonly nome: string }[];
}

/** O que a tela precisa para montar a solicitação: as fontes ativas, os locais do estabelecimento e os insumos ativos
 *  que casam com o termo (até 20). */
export async function lerApoioSolicitacao(
  l: { consultar: TxOperacao['consultar'] },
  est: number,
  termo: string,
): Promise<ApoioSolicitacaoCompra> {
  const locais = await l.consultar<Linha>(
    'SELECT id, nome FROM local_estoque WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome, id LIMIT 200',
    [est],
  );
  const busca = termo.trim().slice(0, 60);
  const insumos = busca
    ? await l.consultar<Linha>(
        `SELECT id, nome FROM insumo WHERE nome LIKE ? AND situacao = 'ativo' AND excluido_em IS NULL
          ORDER BY nome, id LIMIT 20`,
        [`%${busca.replace(/[%_\\]/g, (x) => `\\${x}`)}%`],
      )
    : [];
  return {
    origens: await lerOrigensRecurso(l),
    locais: locais.map((r) => ({ id: n(r['id']), nome: t(r['nome']) })),
    insumos: insumos.map((r) => ({ id: n(r['id']), nome: t(r['nome']) })),
  };
}

export async function solicitarCompraPublica(
  tx: TxOperacao,
  est: number,
  e: EntradaSolicitacaoCompraPublica,
): Promise<ResultadoSolicitacaoCompra> {
  const usuario = tx.contexto.usuario;
  if (usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  const ativas = new Set((await lerOrigensRecurso(tx)).map((o) => o.id));
  const itens = e.itens.map((i) => ({
    quantidadeSolicitada: i.quantidade,
    valorUnitarioEstimado: i.valorUnitarioEstimado ?? null,
    fontes: i.fontes,
  }));
  recusar(conferirFontesSolicitacao(itens, ativas)[0]);
  const processo = e.processo ?? null;
  if (
    processo !== null &&
    !(await tx.uma(
      'SELECT id FROM processo_licitatorio WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [processo, est],
    ))
  )
    throw recusa('processo-inexistente', 'O processo licitatório não existe neste estabelecimento.', {
      campos: ['processo'],
    });
  if (
    !(await tx.uma(
      'SELECT id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.localEstoque, est],
    ))
  )
    throw recusa(
      'local-inexistente',
      'O local de estoque que receberá o material não é deste estabelecimento.',
      {
        campos: ['localEstoque'],
      },
    );
  const unidades: (number | null)[] = [];
  for (const i of e.itens) unidades.push(nn((await insumoAtivo(tx, i.insumo))['estoque_unidade_medida_id']));
  const valorTotal =
    Math.round(e.itens.reduce((s, i) => s + i.quantidade * (i.valorUnitarioEstimado ?? 0), 0) * 100) / 100;
  const temValor = e.itens.some(
    (i) => i.valorUnitarioEstimado !== null && i.valorUnitarioEstimado !== undefined,
  );
  // A numeração do estabelecimento (tools/db/configurar_numeracoes.py); o estabelecimento criado antes dela recebe a
  // sua aqui, depois do maior número já gravado.
  const seq = await tx.uma(
    "SELECT id FROM sequencia_negocio WHERE tipo = 'solicitacao_compra' AND estabelecimento_id = ?",
    [est],
  );
  if (!seq) {
    const max = await tx.uma<Linha>(
      'SELECT MAX(numero) AS m FROM solicitacao_compra WHERE estabelecimento_id = ?',
      [est],
    );
    await tx.incluir('sequencia_negocio', {
      estabelecimento_id: est,
      tipo: 'solicitacao_compra',
      proximo_valor: n(max?.['m']) + 1,
      incremento: 1,
      ativo: true,
    });
  }
  const numero = (await tx.proximoNumero('solicitacao_compra')).valor;
  const agora = new Date();
  const idSol = await tx.incluir('solicitacao_compra', {
    estabelecimento_id: est,
    numero,
    tipo: e.tipo,
    local_estoque_id: e.localEstoque,
    solicitante_usuario_id: usuario,
    solicitado_em: agora,
    necessario_ate: e.necessarioAte ?? null,
    justificativa: e.justificativa,
    origem_recurso_compra_id: fontePrincipal(itens),
    processo_licitatorio_id: processo,
    valor_estimado: temValor ? valorTotal : null,
    situacao: 'enviada',
  });
  for (const [k, i] of e.itens.entries()) {
    const idItem = await tx.incluir('solicitacao_compra_item', {
      solicitacao_compra_id: idSol,
      sequencia: k + 1,
      insumo_id: i.insumo,
      unidade_medida_id: unidades[k] ?? null,
      quantidade_solicitada: i.quantidade,
      necessario_ate: e.necessarioAte ?? null,
      valor_unitario_estimado: i.valorUnitarioEstimado ?? null,
    });
    for (const p of i.fontes)
      await tx.incluir('solicitacao_compra_fonte_recurso', {
        solicitacao_compra_item_id: idItem,
        origem_recurso_compra_id: p.origem,
        quantidade: p.quantidade,
        percentual: p.percentual,
      });
  }
  return { id: idSol, numero: String(numero), itens: e.itens.length, valorTotal };
}

export async function lerSolicitacoesCompraPublica(
  l: { consultar: TxOperacao['consultar'] },
  est: number,
): Promise<SolicitacaoCompraPublicaVisao[]> {
  const cab = await l.consultar<Linha>(
    `SELECT s.id, s.numero, s.tipo, s.situacao, s.solicitado_em, s.valor_estimado, p.numero AS processo,
            o.descricao AS fonte
       FROM solicitacao_compra s
       LEFT JOIN processo_licitatorio p ON p.id = s.processo_licitatorio_id
       LEFT JOIN origem_recurso_compra o ON o.id = s.origem_recurso_compra_id
      WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND s.origem_recurso_compra_id IS NOT NULL
      ORDER BY s.id DESC LIMIT 100`,
    [est],
  );
  if (cab.length === 0) return [];
  const ids = cab.map((r) => n(r['id']));
  const marcas = ids.map(() => '?').join(',');
  const itens = await l.consultar<Linha>(
    `SELECT i.id, i.solicitacao_compra_id, i.sequencia, ins.nome AS insumo_nome, i.quantidade_solicitada,
            i.valor_unitario_estimado
       FROM solicitacao_compra_item i JOIN insumo ins ON ins.id = i.insumo_id
      WHERE i.solicitacao_compra_id IN (${marcas}) AND i.excluido_em IS NULL ORDER BY i.sequencia`,
    ids,
  );
  const fontes = await l.consultar<Linha>(
    `SELECT f.solicitacao_compra_item_id, f.origem_recurso_compra_id, o.codigo, o.descricao, f.quantidade, f.percentual
       FROM solicitacao_compra_fonte_recurso f
       JOIN solicitacao_compra_item i ON i.id = f.solicitacao_compra_item_id
       JOIN origem_recurso_compra o ON o.id = f.origem_recurso_compra_id
      WHERE i.solicitacao_compra_id IN (${marcas}) AND f.excluido_em IS NULL ORDER BY f.id`,
    ids,
  );
  return cab.map((s) => ({
    id: n(s['id']),
    numero: n(s['numero']),
    tipo: t(s['tipo']),
    situacao: t(s['situacao']),
    solicitadoEm:
      s['solicitado_em'] instanceof Date ? s['solicitado_em'].toISOString() : t(s['solicitado_em']),
    processo: tn(s['processo']),
    fontePrincipal: tn(s['fonte']),
    valorEstimado: nn(s['valor_estimado']),
    itens: itens
      .filter((i) => n(i['solicitacao_compra_id']) === n(s['id']))
      .map((i) => ({
        sequencia: n(i['sequencia']),
        insumoNome: t(i['insumo_nome']),
        quantidade: n(i['quantidade_solicitada']),
        valorUnitarioEstimado: nn(i['valor_unitario_estimado']),
        fontes: fontes
          .filter((f) => n(f['solicitacao_compra_item_id']) === n(i['id']))
          .map((f) => ({
            origem: n(f['origem_recurso_compra_id']),
            codigo: t(f['codigo']),
            descricao: t(f['descricao']),
            quantidade: nn(f['quantidade']),
            percentual: nn(f['percentual']),
          })),
      })),
  }));
}
