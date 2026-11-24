// Produto e lote lidos à beira do leito na administração (03-PEP L113), no banco PRÓPRIO: a checagem administrada com a
// leitura da etiqueta (código do produto, lote, validade) grava administracao_lote_lido na mesma transação, ligada ao
// insumo e ao lote do estoque quando existem, com o resultado da conferência pelo domínio (resultadoLeituraLote). O que
// não confere só segue com a justificativa de quem administra (a observação da checagem); sem ela, nada é gravado.
// O produto é achado pelo GTIN do cadastro ou por qualquer código da embalagem (insumo_codigo_barras: DataMatrix, código
// interno, embalagem fracionada, cuja quantidade representada vale como a quantidade confirmada quando a tela não a
// informa). A etiqueta GS1 (DataMatrix) traz também o lote e a validade; a validade desempata o lote, cuja chave inclui
// a validade.
import { justificativaDaLeitura, lerEtiqueta, resultadoLeituraLote } from '@sgh/dominio-enfermagem';
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
  const lido = (l.gtin ?? '').trim();
  const etiqueta = lido ? lerEtiqueta(lido) : null;
  const gtin = etiqueta?.codigo ?? '';
  const numero = ((l.lote ?? '').trim() || etiqueta?.lote) ?? '';
  const validadeLida = (l.validade ? l.validade.slice(0, 10) : null) ?? etiqueta?.validade ?? null;
  if (!gtin && !numero) return null;
  const doCadastro = gtin
    ? await tx.uma<{ id: number }>(
        'SELECT id FROM insumo WHERE codigo_gtin = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
        [gtin],
      )
    : null;
  const daEmbalagem =
    gtin && !doCadastro
      ? await tx.uma<{ insumo_id: number; quantidade_representada: unknown; unidade_medida_id: number }>(
          `SELECT b.insumo_id, b.quantidade_representada, b.unidade_medida_id
             FROM insumo_codigo_barras b JOIN insumo i ON i.id = b.insumo_id AND i.excluido_em IS NULL
            WHERE b.codigo_barras IN (?, ?) AND b.excluido_em IS NULL
            ORDER BY b.codigo_barras = ? DESC LIMIT 1`,
          [gtin, lido.slice(0, 60), gtin],
        )
      : null;
  const insumoId = doCadastro ? Number(doCadastro.id) : daEmbalagem ? Number(daEmbalagem.insumo_id) : null;
  const lote = numero
    ? await tx.uma<Record<string, unknown>>(
        `SELECT id, insumo_id, validade, situacao FROM lote_insumo
          WHERE estabelecimento_id = ? AND numero_lote = ? AND excluido_em IS NULL
          ORDER BY insumo_id = ? DESC, validade = ? DESC, id DESC LIMIT 1`,
        [est, numero, insumoId ?? 0, validadeLida ?? '0000-00-00'],
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
    validadeLida,
    dataAdministracao: dataCivil(l.ocorrido, l.fuso),
  });
  const j = justificativaDaLeitura(resultado, l.observacao ?? null);
  if ('recusa' in j) throw recusa('leitura-nao-conforme', j.recusa);
  const seq = await tx.uma<{ n: number }>(
    'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM administracao_lote_lido WHERE horario_administracao_id = ?',
    [l.horario],
  );
  const representada = daEmbalagem ? Number(daEmbalagem.quantidade_representada) : null;
  // A quantidade da tela vale na unidade da prescrição (sem unidade aqui); a da embalagem lida vale na unidade dela.
  const pelaEmbalagem = !(l.quantidade !== null && l.quantidade > 0) && representada !== null && representada > 0;
  const quantidade = pelaEmbalagem ? representada : l.quantidade !== null && l.quantidade > 0 ? l.quantidade : null;
  const id = await tx.incluir('administracao_lote_lido', {
    horario_administracao_id: l.horario,
    sequencia: Number(seq?.n ?? 1),
    codigo_lido: (lido || numero).slice(0, 100),
    meio_leitura: etiqueta ? etiqueta.meio : 'digitado',
    insumo_id: insumoId ?? (lote ? Number(lote['insumo_id']) : null),
    lote_insumo_id: lote ? Number(lote['id']) : null,
    quantidade_confirmada: quantidade,
    unidade_medida_id: pelaEmbalagem ? Number(daEmbalagem!.unidade_medida_id) : null,
    resultado,
    lido_em: l.ocorrido,
    lido_por_usuario_id: tx.contexto.usuario,
    justificativa: j.justificativa,
  });
  return { id, resultado };
}
