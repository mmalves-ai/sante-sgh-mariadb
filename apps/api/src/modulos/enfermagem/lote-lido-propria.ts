// Produto e lote lidos à beira do leito na administração (03-PEP L113), no banco PRÓPRIO: a checagem administrada com a
// leitura da etiqueta (código do produto, lote, validade) grava administracao_lote_lido na mesma transação, ligada ao
// insumo e ao lote do estoque quando existem, com o resultado da conferência pelo domínio (resultadoLeituraLote). O que
// não confere só segue com a justificativa de quem administra (a observação da checagem); sem ela, nada é gravado.
import { justificativaDaLeitura, resultadoLeituraLote } from '@sgh/dominio-enfermagem';
import { recusa, type TxOperacao } from '@sgh/nucleo';

export interface LeituraDaChecagem {
  readonly horario: number;
  readonly gtin: string | null | undefined;
  readonly lote: string | null | undefined;
  readonly validade: string | null | undefined;
  readonly quantidade: number | null;
  readonly observacao: string | null | undefined;
  readonly ocorrido: Date;
  readonly fuso: string;
}

const dataCivil = (d: Date, fuso: string): string =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

const dataDe = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

/** Grava a leitura do produto e do lote (quando houve) e devolve o resultado; sem leitura, nada grava. */
export async function gravarLoteLido(
  tx: TxOperacao,
  est: number,
  l: LeituraDaChecagem,
): Promise<{ id: number; resultado: string } | null> {
  const gtin = (l.gtin ?? '').trim();
  const numero = (l.lote ?? '').trim();
  if (!gtin && !numero) return null;
  const insumo = gtin
    ? await tx.uma<{ id: number }>(
        'SELECT id FROM insumo WHERE codigo_gtin = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
        [gtin],
      )
    : null;
  const insumoId = insumo ? Number(insumo.id) : null;
  const lote = numero
    ? await tx.uma<Record<string, unknown>>(
        `SELECT id, insumo_id, validade, situacao FROM lote_insumo
          WHERE estabelecimento_id = ? AND numero_lote = ? AND excluido_em IS NULL
          ORDER BY insumo_id = ? DESC, id DESC LIMIT 1`,
        [est, numero, insumoId ?? 0],
      )
    : null;
  const resultado = resultadoLeituraLote({
    insumoDoCodigo: insumoId,
    lote: lote
      ? {
          insumo: Number(lote['insumo_id']),
          validade: dataDe(lote['validade']),
          situacao: String(lote['situacao']),
        }
      : null,
    validadeLida: l.validade ? l.validade.slice(0, 10) : null,
    dataAdministracao: dataCivil(l.ocorrido, l.fuso),
  });
  const j = justificativaDaLeitura(resultado, l.observacao ?? null);
  if ('recusa' in j) throw recusa('leitura-nao-conforme', j.recusa);
  const seq = await tx.uma<{ n: number }>(
    'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM administracao_lote_lido WHERE horario_administracao_id = ?',
    [l.horario],
  );
  const id = await tx.incluir('administracao_lote_lido', {
    horario_administracao_id: l.horario,
    sequencia: Number(seq?.n ?? 1),
    codigo_lido: (gtin || numero).slice(0, 100),
    meio_leitura: gtin ? 'codigo_barras' : 'digitado',
    insumo_id: insumoId ?? (lote ? Number(lote['insumo_id']) : null),
    lote_insumo_id: lote ? Number(lote['id']) : null,
    quantidade_confirmada: l.quantidade !== null && l.quantidade > 0 ? l.quantidade : null,
    resultado,
    lido_em: l.ocorrido,
    lido_por_usuario_id: tx.contexto.usuario,
    justificativa: j.justificativa,
  });
  return { id, resultado };
}
