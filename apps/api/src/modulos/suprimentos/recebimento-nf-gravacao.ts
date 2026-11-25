// C2-038 (05-SUP linha 21): a gravação que a entrada por nota fiscal faz além da nota e dos itens. Os impostos de cada
// item em nota_entrada_imposto (tributo do catálogo pela sigla, base, alíquota, valor, CST e se compõe o custo ou é
// crédito, pela regra do domínio) e a conferência física validada desta entrega ligada à nota e a cada item. Sem
// importação da porta do estoque (a porta importa este arquivo). Nada é apagado.
import {
  conferirNotaComRecebimento,
  type ImpostoCalculado,
  type SituacaoConferencia,
  type TributoNota,
} from '@sgh/contratos/regras-suprimentos';
import { type Linha, recusa, type TxOperacao } from '@sgh/nucleo';

export const TABELAS_RECEBIMENTO_NF = [
  'nota_entrada_imposto',
  'tributo',
  'conferencia_recebimento',
  'conferencia_recebimento_item',
] as const;

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** O catálogo do tributo da NF-e de compra (esfera e descrição pública), criado na primeira nota que o destaca. */
const CATALOGO_TRIBUTO: Readonly<Record<TributoNota, { descricao: string; esfera: string }>> = {
  ICMS: { descricao: 'ICMS próprio destacado na nota de entrada', esfera: 'estadual' },
  ICMS_ST: { descricao: 'ICMS por substituição tributária na nota de entrada', esfera: 'estadual' },
  FCP_ST: { descricao: 'Fundo de combate à pobreza retido por substituição', esfera: 'estadual' },
  IPI: { descricao: 'IPI destacado na nota de entrada', esfera: 'federal' },
  PIS: { descricao: 'PIS destacado na nota de entrada', esfera: 'federal' },
  COFINS: { descricao: 'COFINS destacado na nota de entrada', esfera: 'federal' },
};

async function tributoId(tx: TxOperacao, codigo: TributoNota): Promise<number> {
  const r = await tx.uma<Linha>('SELECT id FROM tributo WHERE codigo = ?', [codigo]);
  if (r) return n(r['id']);
  const c = CATALOGO_TRIBUTO[codigo];
  return tx.incluir('tributo', {
    codigo,
    descricao: c.descricao,
    esfera: c.esfera,
    forma_apuracao: 'por_operacao',
    incidencia: 'proprio',
  });
}

/** Um registro por tributo do item, na ordem do XML. */
export async function gravarImpostosItem(
  tx: TxOperacao,
  notaItem: number,
  impostos: readonly ImpostoCalculado[],
): Promise<void> {
  for (const [k, i] of impostos.entries())
    await tx.incluir('nota_entrada_imposto', {
      nota_entrada_item_id: notaItem,
      sequencia: k + 1,
      tributo_id: await tributoId(tx, i.tributo),
      situacao_tributaria: i.cst ?? null,
      base_calculo: i.base,
      aliquota_percentual: i.aliquota,
      valor: i.valor,
      compoe_custo: i.compoeCusto,
      recuperavel: i.recuperavel,
    });
}

export interface ConferenciaDaNota {
  readonly id: number;
  readonly versao: number;
  readonly itens: Map<number, { id: number; versao: number }>;
}

/** A conferência validada desta entrega, travada, conferida pela regra do domínio contra a nota. */
export async function conferenciaParaNota(
  tx: TxOperacao,
  est: number,
  id: number,
  nota: { fornecedor: number; local: number; itens: readonly number[] },
): Promise<ConferenciaDaNota> {
  const c = (
    await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, situacao, empresa_fornecedora_id, local_estoque_id, nota_entrada_id
         FROM conferencia_recebimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est],
    )
  )[0];
  if (!c)
    throw recusa('conferencia-inexistente', 'A conferência física não existe neste estabelecimento.', {
      campos: ['conferencia'],
    });
  const itens = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, insumo_id FROM conferencia_recebimento_item
      WHERE conferencia_recebimento_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [id],
  );
  const r = conferirNotaComRecebimento(
    {
      situacao: String(c['situacao']) as SituacaoConferencia,
      fornecedor: n(c['empresa_fornecedora_id']),
      local: n(c['local_estoque_id']),
      notaLigada: c['nota_entrada_id'] !== null && c['nota_entrada_id'] !== undefined,
      itens: itens.map((i) => n(i['insumo_id'])),
    },
    nota,
  );
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : {});
  return {
    id,
    versao: n(c['versao']),
    itens: new Map(itens.map((i) => [n(i['insumo_id']), { id: n(i['id']), versao: n(i['versao']) }])),
  };
}

export async function ligarItemConferido(
  tx: TxOperacao,
  c: ConferenciaDaNota,
  insumo: number,
  notaItem: number,
): Promise<void> {
  const i = c.itens.get(insumo);
  if (i) await tx.alterar('conferencia_recebimento_item', i.id, i.versao, { nota_entrada_item_id: notaItem });
}

export async function ligarConferenciaNota(
  tx: TxOperacao,
  c: ConferenciaDaNota,
  nota: number,
): Promise<void> {
  await tx.alterar('conferencia_recebimento', c.id, c.versao, { nota_entrada_id: nota });
}
