// Adesão à ata de registro de preços (C2-017, 09-AREA linha 81; Lei 14.133/2021, art. 86) sobre o MariaDB do cliente,
// pela mesma porta da ata e do empenho (Executor do núcleo: trilha na mesma transação, versão conferida,
// Idempotency-Key). A regra pura mora em `@sgh/contratos/regras-suprimentos` (adesao-ata); aqui fica a gravação:
//   - solicitar: a adesão (participante ou carona) a uma ata do próprio cliente (o item pelo insumo e pelo fornecedor,
//     com a quantidade registrada e o preço da ata relidos) ou de outro órgão (o gerenciador, o pregão e a quantidade
//     registrada informados); os limites do art. 86, § 4º e § 5º, contam as adesões que já ocupam o item;
//   - decidir: autorizar (aceite do gerenciador pelo ofício, aceite do fornecedor, documentação conferida, quantidade
//     aderida dentro dos limites, relidos na transação) ou negar com motivo; quem avaliou e quando ficam gravados.
import {
  conferirAdesao,
  conferirDecisaoAdesao,
  quantidadeOcupada,
  type QuantidadesDoItem,
  type RecusaSuprimentos,
  type TipoAdesao,
} from '@sgh/contratos/regras-suprimentos';
import { type Linha, recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { insumoAtivo } from './porta-propria.js';

export const OPERACAO_SOLICITAR_ADESAO = 'suprimentos.adesao-ata.solicitar';
export const OPERACAO_DECIDIR_ADESAO = 'suprimentos.adesao-ata.decidir';
export const TABELAS_ADESAO = ['adesao_ata_registro_preco'] as const;

const id = z.number().int().positive();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const texto = (max: number) => z.string().trim().max(max).nullable().optional();
export const esquemaAdesao = z
  .object({
    numero: z.string().trim().min(1).max(30),
    tipo: z.enum(['participante', 'carona']),
    ata: id.nullable(),
    orgaoGerenciador: texto(150),
    numeroProcesso: texto(30),
    numeroPregao: texto(20),
    insumo: id,
    fornecedor: id,
    quantidadeRegistrada: z.number().positive().max(999_999_999).nullable().optional(),
    quantidadeSolicitada: z.number().positive().max(999_999_999),
    valorUnitario: z.number().nonnegative().max(999_999_999).nullable().optional(),
    dataSolicitacao: dataIso,
    justificativa: texto(2000),
  })
  .strict();
export type EntradaAdesao = z.infer<typeof esquemaAdesao>;

export const esquemaDecisaoAdesao = z
  .object({
    decisao: z.enum(['autorizar', 'negar']),
    versao: z.number().int().positive(),
    quantidadeAderida: z.number().positive().max(999_999_999).nullable().optional(),
    numeroOficio: texto(15),
    aceiteGerenciador: z.boolean().optional(),
    aceiteFornecedor: z.boolean().optional(),
    aceiteFornecedorEm: dataIso.nullable().optional(),
    documentacaoConferida: z.boolean().optional(),
    motivo: texto(500),
  })
  .strict();
export type EntradaDecisaoAdesao = z.infer<typeof esquemaDecisaoAdesao>;

export interface AdesaoVisao {
  readonly id: number;
  readonly numero: string;
  readonly tipo: TipoAdesao;
  readonly ata: string | null;
  readonly orgaoGerenciador: string | null;
  readonly numeroPregao: string | null;
  readonly insumoNome: string;
  readonly fornecedorNome: string;
  readonly quantidadeRegistrada: number | null;
  readonly quantidadeSolicitada: number;
  readonly quantidadeAderida: number | null;
  readonly valorUnitario: number;
  readonly dataSolicitacao: string;
  readonly situacao: string;
  readonly numeroOficio: string | null;
  readonly aceiteFornecedor: boolean;
  readonly motivoDecisao: string | null;
  readonly versao: number;
}
export type ResultadoAdesao = {
  readonly id: number;
  readonly numero: string;
  readonly itens: number;
  readonly valorTotal: number;
};

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const vazio = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
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

interface ChaveItem {
  readonly ata: number | null;
  readonly orgaoGerenciador: string | null;
  readonly numeroPregao: string | null;
  readonly insumo: number;
  readonly fornecedor: number;
}

/** O que já ocupa o item (do mesmo órgão e no total), sem a adesão em exame. Ata própria: todas as adesões do cliente
 *  ao item; ata de outro órgão: as deste cliente ao mesmo gerenciador, pregão, insumo e fornecedor. */
async function ocupado(
  tx: TxOperacao,
  est: number,
  k: ChaveItem,
  semAdesao: number | null,
): Promise<{ jaDoOrgao: number; jaTotal: number }> {
  const filtro =
    k.ata !== null
      ? 'ata_registro_preco_id = ?'
      : 'ata_registro_preco_id IS NULL AND orgao_gerenciador = ? AND numero_pregao <=> ?';
  const p: unknown[] = k.ata !== null ? [k.ata] : [k.orgaoGerenciador, k.numeroPregao];
  const linhas = await tx.consultar<Linha>(
    `SELECT estabelecimento_id, situacao, quantidade_solicitada, quantidade_aderida FROM adesao_ata_registro_preco
      WHERE ${filtro} AND insumo_id = ? AND empresa_fornecedora_id = ? AND excluido_em IS NULL AND id <> ?`,
    [...p, k.insumo, k.fornecedor, semAdesao ?? 0],
  );
  let jaDoOrgao = 0;
  let jaTotal = 0;
  for (const l of linhas) {
    const q = quantidadeOcupada({
      situacao: t(l['situacao']),
      solicitada: n(l['quantidade_solicitada']),
      aderida: nn(l['quantidade_aderida']),
    });
    jaTotal += q;
    if (n(l['estabelecimento_id']) === est) jaDoOrgao += q;
  }
  return { jaDoOrgao, jaTotal };
}

/** O item da ata do próprio cliente pelo insumo e pelo fornecedor, com a ata. */
async function itemAtaPropria(tx: TxOperacao, ata: number, insumo: number, fornecedor: number) {
  const r = await tx.uma<Linha>(
    `SELECT a.situacao, a.vigencia_inicio, a.vigencia_fim, i.quantidade_registrada, i.valor_unitario
       FROM ata_registro_preco a JOIN ata_registro_preco_item i ON i.ata_registro_preco_id = a.id
      WHERE a.id = ? AND i.insumo_id = ? AND i.empresa_fornecedora_id = ? AND a.excluido_em IS NULL
        AND i.excluido_em IS NULL AND i.situacao <> 'cancelado'`,
    [ata, insumo, fornecedor],
  );
  if (!r)
    throw recusa('ata-item-inexistente', 'A ata não tem este insumo deste fornecedor.', {
      campos: ['ata', 'insumo'],
    });
  return {
    situacao: t(r['situacao']),
    vigenciaInicio: dia(r['vigencia_inicio']),
    vigenciaFim: dia(r['vigencia_fim']),
    valorRegistrado: n(r['valor_unitario']),
    registrada: n(r['quantidade_registrada']),
  };
}

export async function solicitarAdesao(
  tx: TxOperacao,
  est: number,
  e: EntradaAdesao,
  hoje: string,
): Promise<ResultadoAdesao> {
  exigirUsuario(tx);
  const insumo = await insumoAtivo(tx, e.insumo);
  const f = await tx.uma(
    "SELECT id FROM empresa_fornecedora WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
    [e.fornecedor],
  );
  if (!f)
    throw recusa('fornecedor-inativo', 'O fornecedor não está ativo no cadastro.', {
      campos: ['fornecedor'],
    });
  const propria = e.ata === null ? null : await itemAtaPropria(tx, e.ata, e.insumo, e.fornecedor);
  const orgao = propria ? null : vazio(e.orgaoGerenciador);
  const pregao = vazio(e.numeroPregao);
  const registrada = propria ? propria.registrada : (e.quantidadeRegistrada ?? null);
  const valor = e.valorUnitario ?? propria?.valorRegistrado ?? 0;
  const ja = await ocupado(
    tx,
    est,
    { ata: e.ata, orgaoGerenciador: orgao, numeroPregao: pregao, insumo: e.insumo, fornecedor: e.fornecedor },
    null,
  );
  recusar(
    conferirAdesao({
      numero: e.numero,
      tipo: e.tipo,
      hoje,
      dataSolicitacao: e.dataSolicitacao,
      quantidadeSolicitada: e.quantidadeSolicitada,
      valorUnitario: valor,
      justificativa: e.justificativa ?? null,
      ataPropria: propria,
      orgaoGerenciador: orgao,
      quantidades: { registrada, ...ja },
    })[0],
  );
  if (
    await tx.uma(
      'SELECT id FROM adesao_ata_registro_preco WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL',
      [est, e.numero],
    )
  )
    throw recusa('adesao-numero-repetido', 'Já existe uma adesão com este número.', { campos: ['numero'] });
  const idAdesao = await tx.incluir('adesao_ata_registro_preco', {
    estabelecimento_id: est,
    numero: e.numero,
    tipo: e.tipo,
    ata_registro_preco_id: e.ata,
    orgao_gerenciador: orgao,
    numero_processo: vazio(e.numeroProcesso),
    numero_pregao: pregao,
    empresa_fornecedora_id: e.fornecedor,
    insumo_id: e.insumo,
    unidade_medida_id: insumo['estoque_unidade_medida_id'] ?? null,
    quantidade_registrada: registrada,
    quantidade_solicitada: e.quantidadeSolicitada,
    valor_unitario: valor,
    data_solicitacao: e.dataSolicitacao,
    situacao: 'solicitada',
    observacao: vazio(e.justificativa),
  });
  return {
    id: idAdesao,
    numero: e.numero,
    itens: 1,
    valorTotal: Math.round(e.quantidadeSolicitada * valor * 100) / 100,
  };
}

export async function decidirAdesao(
  tx: TxOperacao,
  est: number,
  adesao: number,
  e: EntradaDecisaoAdesao,
): Promise<ResultadoAdesao> {
  const usuario = exigirUsuario(tx);
  const a = await tx.uma<Linha>(
    `SELECT id, numero, tipo, situacao, ata_registro_preco_id, orgao_gerenciador, numero_pregao, insumo_id,
            empresa_fornecedora_id, quantidade_registrada, quantidade_solicitada, valor_unitario, versao
       FROM adesao_ata_registro_preco WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [adesao, est],
  );
  if (!a) throw recusa('adesao-inexistente', 'A adesão não existe neste estabelecimento.');
  if (n(a['versao']) !== e.versao)
    throw recusa('versao-desatualizada', 'A adesão mudou desde a leitura: atualize a tela.');
  const ataId = nn(a['ata_registro_preco_id']);
  const k: ChaveItem = {
    ata: ataId,
    orgaoGerenciador: tn(a['orgao_gerenciador']),
    numeroPregao: tn(a['numero_pregao']),
    insumo: n(a['insumo_id']),
    fornecedor: n(a['empresa_fornecedora_id']),
  };
  const registrada =
    ataId !== null
      ? (await itemAtaPropria(tx, ataId, k.insumo, k.fornecedor)).registrada
      : nn(a['quantidade_registrada']);
  const quantidades: QuantidadesDoItem = { registrada, ...(await ocupado(tx, est, k, adesao)) };
  recusar(
    conferirDecisaoAdesao({
      situacao: t(a['situacao']),
      tipo: t(a['tipo']) as TipoAdesao,
      decisao: e.decisao,
      quantidadeSolicitada: n(a['quantidade_solicitada']),
      quantidadeAderida: e.quantidadeAderida ?? null,
      numeroOficio: vazio(e.numeroOficio),
      aceiteGerenciador: e.aceiteGerenciador === true,
      aceiteFornecedor: e.aceiteFornecedor === true,
      documentacaoConferida: e.documentacaoConferida === true,
      motivo: vazio(e.motivo),
      quantidades,
    })[0],
  );
  const agora = new Date();
  const dados: Record<string, unknown> =
    e.decisao === 'autorizar'
      ? {
          situacao: 'autorizada',
          quantidade_aderida: e.quantidadeAderida,
          numero_oficio: vazio(e.numeroOficio),
          oficio_autorizado: true,
          aceite_fornecedor: true,
          aceite_fornecedor_em: e.aceiteFornecedorEm ?? null,
          documentacao_conferida: true,
          documentacao_conferida_por_usuario_id: usuario,
          documentacao_conferida_em: agora,
          avaliador_usuario_id: usuario,
          avaliado_em: agora,
        }
      : {
          situacao: 'negada',
          motivo_decisao: vazio(e.motivo),
          avaliador_usuario_id: usuario,
          avaliado_em: agora,
        };
  await tx.alterar('adesao_ata_registro_preco', adesao, e.versao, dados);
  const q = e.decisao === 'autorizar' ? (e.quantidadeAderida ?? 0) : 0;
  return {
    id: adesao,
    numero: t(a['numero']),
    itens: 1,
    valorTotal: Math.round(q * n(a['valor_unitario']) * 100) / 100,
  };
}

export async function lerAdesoes(
  l: { consultar: TxOperacao['consultar'] },
  est: number,
): Promise<AdesaoVisao[]> {
  const linhas = await l.consultar<Linha>(
    `SELECT d.id, d.numero, d.tipo, a.numero AS ata, d.orgao_gerenciador, d.numero_pregao, ins.nome AS insumo_nome,
            COALESCE(ef.nome_fantasia, ef.razao_social) AS fornecedor_nome, d.quantidade_registrada,
            d.quantidade_solicitada, d.quantidade_aderida, d.valor_unitario, d.data_solicitacao, d.situacao,
            d.numero_oficio, d.aceite_fornecedor, d.motivo_decisao, d.versao
       FROM adesao_ata_registro_preco d
       JOIN insumo ins ON ins.id = d.insumo_id
       JOIN empresa_fornecedora ef ON ef.id = d.empresa_fornecedora_id
       LEFT JOIN ata_registro_preco a ON a.id = d.ata_registro_preco_id
      WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL
      ORDER BY d.data_solicitacao DESC, d.id DESC LIMIT 100`,
    [est],
  );
  return linhas.map((r) => ({
    id: n(r['id']),
    numero: t(r['numero']),
    tipo: t(r['tipo']) as TipoAdesao,
    ata: tn(r['ata']),
    orgaoGerenciador: tn(r['orgao_gerenciador']),
    numeroPregao: tn(r['numero_pregao']),
    insumoNome: t(r['insumo_nome']),
    fornecedorNome: t(r['fornecedor_nome']),
    quantidadeRegistrada: nn(r['quantidade_registrada']),
    quantidadeSolicitada: n(r['quantidade_solicitada']),
    quantidadeAderida: nn(r['quantidade_aderida']),
    valorUnitario: n(r['valor_unitario']),
    dataSolicitacao: dia(r['data_solicitacao']),
    situacao: t(r['situacao']),
    numeroOficio: tn(r['numero_oficio']),
    aceiteFornecedor: Boolean(Number(r['aceite_fornecedor'] ?? 0)),
    motivoDecisao: tn(r['motivo_decisao']),
    versao: n(r['versao']),
  }));
}
