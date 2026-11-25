// Nova via de documento do prontuário no banco próprio (01-ADM L79 e L82): um só caminho de motivo. O motivo vem do
// catálogo de reimpressão (motivo_reimpressao), com o complemento quando o motivo pede; a via entra no registro de
// reimpressões (registro_reimpressao) e, com espelho no prontuário, também no documento (vias, evento na cadeia) e
// no registro único de impressões e exportações (exportacao_documento), tudo na mesma transação. Nada é apagado.
// A regra (motivo ativo, complemento, via crescente, texto da emissão) é de `@sgh/dominio-documento`.
import { MENSAGEM_NOVA_VIA, planoNovaViaProntuario, type MotivoCatalogo } from '@sgh/dominio-documento';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';

const num = (v: unknown): number => Number(v);
const bool = (v: unknown): boolean => v === true || num(v) === 1;

/** O que o documento reimpresso deixa: o espelho no prontuário (quando há) e a origem do documento. */
export interface NovaViaDocumento {
  /** Documento do prontuário (espelho); nulo quando o documento só existe na origem. */
  readonly documento: number | null;
  /** Tabela e id da origem do documento (lista fechada da rota de documentos). */
  readonly origem: { readonly tabela: string; readonly id: number };
  readonly motivo: number;
  readonly complemento: string | null;
  /**
   * A menor via que esta reimpressão pode ter (a via do registro nunca fica abaixo dela). A via é registrada ANTES
   * de emitir o PDF: nunca existe via emitida sem a linha em registro_reimpressao.
   */
  readonly viaMinima: number;
}

export interface NovaViaGravada {
  readonly registro: number;
  readonly via: number;
  readonly texto: string;
}

/** Recusa da nova via com o código do domínio (motivo ausente, inativo, complemento curto, nunca impresso). */
export const recusaNovaVia = (codigo: keyof typeof MENSAGEM_NOVA_VIA): ErroOperacao =>
  new ErroOperacao(
    codigo === 'documento-inexistente' ? 404 : 422,
    codigo,
    'Operação recusada',
    MENSAGEM_NOVA_VIA[codigo],
  );

/** Um motivo do catálogo pelo id (ativo ou não: a regra recusa o inativo com a mensagem certa). */
export async function lerMotivoReimpressao(
  l: Pick<Leitor, 'uma'>,
  id: number,
): Promise<MotivoCatalogo | null> {
  const m = await l.uma('SELECT descricao, ativo, exige_complemento FROM motivo_reimpressao WHERE id = ?', [
    id,
  ]);
  return m
    ? {
        descricao: String(m['descricao']),
        ativo: bool(m['ativo']),
        exigeComplemento: bool(m['exige_complemento']),
      }
    : null;
}

/** Os motivos ativos do catálogo, como a tela oferece ao reimprimir. */
export async function lerMotivosReimpressaoAtivos(l: Pick<Leitor, 'consultar'>) {
  const ls = await l.consultar(
    'SELECT id, codigo, descricao, exige_complemento FROM motivo_reimpressao WHERE ativo ORDER BY descricao LIMIT 200',
    [],
  );
  return ls.map((m) => ({
    id: num(m['id']),
    codigo: String(m['codigo']),
    descricao: String(m['descricao']),
    exigeComplemento: bool(m['exige_complemento']),
  }));
}

/** Grava a nova via (dentro da transação da porta): confere pela regra do domínio e registra. */
export async function gravarNovaVia(
  tx: TxOperacao,
  est: number,
  usuario: number,
  e: NovaViaDocumento,
): Promise<NovaViaGravada> {
  let doc: Record<string, unknown> | undefined;
  if (e.documento !== null) {
    [doc] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao_documento_prontuario_id, vias_impressas, paciente_id, atendimento_id
         FROM documento_prontuario
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.documento, est],
    );
    if (!doc) throw recusaNovaVia('documento-inexistente');
  }
  const entidade = doc ? 'documento_prontuario' : e.origem.tabela;
  const entidadeId = doc ? num(doc['id']) : e.origem.id;
  const [ultima] = await tx.consultarParaAtualizar(
    `SELECT MAX(via) AS via FROM registro_reimpressao
      WHERE entidade = ? AND entidade_id = ? AND estabelecimento_id = ?`,
    [entidade, entidadeId, est],
  );
  const viasAnteriores = Math.max(
    ultima && ultima['via'] !== null ? num(ultima['via']) : 0,
    doc ? num(doc['vias_impressas']) : 0,
    e.viaMinima - 1,
  );
  const p = planoNovaViaProntuario({
    viasAnteriores,
    motivoInformado: true,
    motivo: await lerMotivoReimpressao(tx, e.motivo),
    complemento: e.complemento,
  });
  if ('recusa' in p) throw recusaNovaVia(p.recusa);
  const agora = new Date();
  if (doc) {
    await tx.alterar('documento_prontuario', num(doc['id']), num(doc['versao']), {
      impresso_em: agora,
      vias_impressas: Math.max(num(doc['vias_impressas']) + 1, p.via),
    });
    await tx.incluir('documento_prontuario_evento', {
      documento_prontuario_id: num(doc['id']),
      operacao: 'alteracao',
      acao: 'impressao',
      situacao_documento_prontuario_id: num(doc['situacao_documento_prontuario_id']),
      justificativa: p.textoEmissao,
      evento_em: agora,
      dados: JSON.stringify({ tipo: 'segunda-via', via: p.via, motivoReimpressao: e.motivo }),
      ocorrido_em: agora,
      usuario_id: usuario,
    });
    await tx.incluir('exportacao_documento', {
      estabelecimento_id: est,
      documento_prontuario_id: num(doc['id']),
      paciente_id: num(doc['paciente_id']),
      atendimento_id: doc['atendimento_id'] === null ? null : num(doc['atendimento_id']),
      tipo_operacao: 'reimpressao',
      formato: 'pdf',
      destino: 'download',
      motivo_reimpressao_id: e.motivo,
      justificativa: p.textoEmissao,
      ocorrido_em: agora,
      usuario_id: usuario,
    });
  }
  const registro = await tx.incluir('registro_reimpressao', {
    estabelecimento_id: est,
    documento_emitido_id: null,
    entidade,
    entidade_id: entidadeId,
    motivo_reimpressao_id: e.motivo,
    motivo_texto: p.complemento,
    via: p.via,
    quantidade: 1,
    destino: 'pdf',
    estacao_trabalho_id: null,
    impressora_id: null,
    operacao: 'inclusao',
    dados: JSON.stringify({ origem: e.origem.tabela, origemId: e.origem.id, emissao: 'pendente' }),
    ocorrido_em: agora,
    usuario_id: usuario,
  });
  return { registro, via: p.via, texto: p.textoEmissao };
}

/** O desfecho da emissão do PDF depois de registrada a via: emitida (com a via que o PDF levou) ou não emitida. */
export interface DesfechoNovaVia {
  readonly emitida: boolean;
  /** A via que o PDF levou (só quando emitida). */
  readonly viaEmitida: number | null;
}

/**
 * Fecha o registro da reimpressão com o desfecho da emissão (dentro da transação da porta). Nunca apaga: a linha
 * fica, com `dados.emissao` = 'emitida' (e a via do PDF, quando outra emissão concorrente numerou diferente) ou
 * 'nao-emitida' (a via foi pedida e registrada, mas o PDF não saiu).
 */
export async function fecharNovaVia(
  tx: TxOperacao,
  est: number,
  registro: number,
  d: DesfechoNovaVia,
): Promise<{ registro: number; via: number }> {
  const [r] = await tx.consultarParaAtualizar(
    'SELECT id, versao, via, dados FROM registro_reimpressao WHERE id = ? AND estabelecimento_id = ?',
    [registro, est],
  );
  if (!r)
    throw new ErroOperacao(404, 'registro-inexistente', 'Operação recusada', 'Reimpressão não registrada.');
  const bruto = r['dados'];
  const antes =
    typeof bruto === 'string' ? (JSON.parse(bruto) as Record<string, unknown>) : ((bruto ?? {}) as object);
  const via = d.emitida && d.viaEmitida !== null && d.viaEmitida >= 2 ? d.viaEmitida : num(r['via']);
  await tx.alterar('registro_reimpressao', num(r['id']), num(r['versao']), {
    via,
    dados: JSON.stringify({
      ...antes,
      emissao: d.emitida ? 'emitida' : 'nao-emitida',
      viaRegistrada: num(r['via']),
      ...(d.emitida ? { viaEmitida: via } : {}),
    }),
  });
  return { registro: num(r['id']), via };
}
