// Cancelamento de guia enviada (CANCELA_GUIA) e envio de documentos anexos (ENVIO_DOCUMENTO) no TISS 04.03.00
// (06-FAT linha 28). Regras puras: quem pode ser cancelado, a leitura do recibo de cancelamento guia a guia, o formato e
// o tipo do documento anexo, a leitura do recibo do documento e a montagem das duas mensagens no esquema oficial.
// Nada aqui lê banco: a porta própria lê as guias e os arquivos e grava o pedido, o envio e o recibo.
import {
  contratadoDadosXml,
  type Cabecalho,
  ErroLoteTiss,
  type MensagemTiss,
  montarMensagemTiss,
} from './lote.js';
import { el, opcional } from './xml.js';

export interface ProblemaCancelamentoDocumento {
  readonly campo: string;
  readonly mensagem: string;
}

type Problemas = ProblemaCancelamentoDocumento[];

// ---------------------------------------------------------------- cancelamento de guia

/** A guia só é cancelada junto à operadora depois de enviada e antes do pagamento. */
export const SITUACOES_GUIA_CANCELAVEIS = ['enviada', 'aceita', 'glosada'] as const;
export const MAXIMO_GUIAS_CANCELAMENTO = 100;
export const MINIMO_MOTIVO_CANCELAMENTO = 10;

export interface GuiaParaCancelar {
  readonly id: number;
  readonly numeroGuiaPrestador: string;
  readonly situacao: string;
  readonly fontePagadora: number;
  /** Já está num pedido de cancelamento vivo (rascunho, enviado ou processado sem resposta negativa). */
  readonly emPedidoVivo: boolean;
}

export function conferirPedidoCancelamento(p: {
  readonly guias: readonly GuiaParaCancelar[];
  readonly motivo: string;
}): Problemas {
  const problemas: Problemas = [];
  if (p.motivo.trim().length < MINIMO_MOTIVO_CANCELAMENTO)
    problemas.push({
      campo: 'motivo',
      mensagem: `Descreva o motivo do cancelamento (mínimo de ${MINIMO_MOTIVO_CANCELAMENTO} caracteres).`,
    });
  if (p.guias.length === 0) problemas.push({ campo: 'guias', mensagem: 'Escolha ao menos uma guia.' });
  if (p.guias.length > MAXIMO_GUIAS_CANCELAMENTO)
    problemas.push({
      campo: 'guias',
      mensagem: `Um pedido leva no máximo ${MAXIMO_GUIAS_CANCELAMENTO} guias.`,
    });
  if (new Set(p.guias.map((g) => g.id)).size !== p.guias.length)
    problemas.push({ campo: 'guias', mensagem: 'A mesma guia aparece mais de uma vez.' });
  if (new Set(p.guias.map((g) => g.fontePagadora)).size > 1)
    problemas.push({
      campo: 'guias',
      mensagem: 'Um pedido de cancelamento vai a uma só operadora: separe as guias por convênio.',
    });
  for (const g of p.guias) {
    if (g.emPedidoVivo)
      problemas.push({
        campo: 'guias',
        mensagem: `A guia ${g.numeroGuiaPrestador} já está num pedido de cancelamento em andamento.`,
      });
    else if (!(SITUACOES_GUIA_CANCELAVEIS as readonly string[]).includes(g.situacao))
      problemas.push({
        campo: 'guias',
        mensagem:
          g.situacao === 'paga'
            ? `A guia ${g.numeroGuiaPrestador} já foi paga: o acerto é pelo recurso ou pela devolução.`
            : g.situacao === 'cancelada'
              ? `A guia ${g.numeroGuiaPrestador} já está cancelada.`
              : `A guia ${g.numeroGuiaPrestador} ainda não foi enviada à operadora: retire-a do lote em vez de cancelar.`,
      });
  }
  return problemas;
}

/** Situação do item pelo statusCancelamento do recibo (dm_statusCancelamento). */
export type SituacaoItemCancelamento = 'pendente' | 'cancelada' | 'nao_cancelada' | 'em_analise';
export const SITUACAO_DO_STATUS_CANCELAMENTO: Readonly<
  Record<string, Exclude<SituacaoItemCancelamento, 'pendente'>>
> = {
  '1': 'cancelada',
  '2': 'nao_cancelada',
  '3': 'nao_cancelada',
  '4': 'em_analise',
  '5': 'nao_cancelada',
  '6': 'nao_cancelada',
};
export const DESCRICAO_STATUS_CANCELAMENTO: Readonly<Record<string, string>> = {
  '1': 'Cancelado com sucesso',
  '2': 'Não cancelado',
  '3': 'Guia inexistente',
  '4': 'Em processamento',
  '5': 'Lote inexistente',
  '6': 'Protocolo inexistente',
};

export interface ItemCancelamentoAtual {
  readonly id: number;
  readonly situacao: SituacaoItemCancelamento;
}

export interface ReciboCancelamento {
  /** A operadora recusou a mensagem inteira (mensagemErro com o código da tabela de glosas). */
  readonly erro: { readonly codigo: string; readonly descricao: string | null } | null;
  readonly guias: readonly { readonly item: number; readonly status: string }[];
}

/**
 * Confere o recibo contra o pedido: só o pedido enviado recebe recibo, e o processado só recebe o retorno das guias
 * que ficaram em processamento (retorno complementar). Sem erro, cada guia pendente precisa do status.
 */
export function conferirReciboCancelamento(
  situacao: string,
  itens: readonly ItemCancelamentoAtual[],
  r: ReciboCancelamento,
): { readonly problemas: Problemas; readonly situacao: 'processado' | 'recusado' | null } {
  const problemas: Problemas = [];
  const emAnalise = itens.filter((i) => i.situacao === 'em_analise').map((i) => i.id);
  const complementar = situacao === 'processado' && emAnalise.length > 0;
  if (situacao !== 'enviado' && !complementar)
    return {
      problemas: [
        {
          campo: 'situacao',
          mensagem:
            situacao === 'rascunho'
              ? 'O pedido ainda não foi enviado.'
              : 'O pedido já tem o recibo da operadora.',
        },
      ],
      situacao: null,
    };
  if (r.erro) {
    if (complementar)
      problemas.push({ campo: 'erro', mensagem: 'O retorno complementar traz o status de cada guia.' });
    if (!r.erro.codigo.trim()) problemas.push({ campo: 'erro', mensagem: 'Informe o código do erro.' });
    return { problemas, situacao: problemas.length ? null : 'recusado' };
  }
  const aceitos = new Set(complementar ? emAnalise : itens.map((i) => i.id));
  const informados = new Set<number>();
  for (const g of r.guias) {
    if (!aceitos.has(g.item))
      problemas.push({
        campo: 'guias',
        mensagem: complementar
          ? 'No retorno complementar só entram as guias em processamento.'
          : 'Guia fora deste pedido.',
      });
    if (!SITUACAO_DO_STATUS_CANCELAMENTO[g.status])
      problemas.push({ campo: 'guias', mensagem: `Status de cancelamento inválido: ${g.status}.` });
    if (informados.has(g.item)) problemas.push({ campo: 'guias', mensagem: 'Guia informada duas vezes.' });
    informados.add(g.item);
  }
  if (!complementar && informados.size !== aceitos.size)
    problemas.push({ campo: 'guias', mensagem: 'Informe o status de todas as guias do pedido.' });
  if (complementar && informados.size === 0)
    problemas.push({ campo: 'guias', mensagem: 'Informe o status de ao menos uma guia em processamento.' });
  return { problemas, situacao: problemas.length ? null : 'processado' };
}

export interface GuiaCancelamentoTiss {
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaOperadora?: string | null;
  readonly numeroProtocolo?: string | null;
}

/** CANCELA_GUIA por guia (guias de faturamento: tipoGuia 2). */
export function mensagemCancelaGuia(cab: Cabecalho, guias: readonly GuiaCancelamentoTiss[]): MensagemTiss {
  if (guias.length === 0 || guias.length > MAXIMO_GUIAS_CANCELAMENTO)
    throw new ErroLoteTiss(`O cancelamento leva de 1 a ${MAXIMO_GUIAS_CANCELAMENTO} guias.`);
  const corpo = el(
    'prestadorParaOperadora',
    el(
      'cancelaGuia',
      el('dadosPrestador', contratadoDadosXml(cab)),
      el(
        'tipoCancelamento',
        ...guias.map((g) =>
          el(
            'tipoCancelamentoGuia',
            el('tipoGuia', '2'),
            el('numeroGuiaPrestador', g.numeroGuiaPrestador),
            opcional('numeroGuiaOperadora', g.numeroGuiaOperadora),
            opcional('numeroProtocolo', g.numeroProtocolo),
          ),
        ),
      ),
    ),
  );
  return montarMensagemTiss(cab, 'CANCELA_GUIA', corpo);
}

// ---------------------------------------------------------------- envio de documentos anexos

/** dm_formatoDocumento pelo tipo do arquivo (sem assinatura CAdES/PAdES). */
export const FORMATO_DOCUMENTO_POR_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': '01',
  'application/pdf': '02',
  'image/png': '03',
  'image/tiff': '04',
};

/** dm_tipoDocumento (terminologia do padrão). */
export const TIPOS_DOCUMENTO_TISS: Readonly<Record<string, string>> = {
  '01': 'Comprovante de elegibilidade',
  '02': 'Laudo do profissional de saúde',
  '03': 'Pedido do profissional de saúde',
  '04': 'Relatório do profissional de saúde',
  '05': 'Prescrição do profissional de saúde',
  '06': 'Comprovante de comparecimento',
  '07': 'Embalagem ou rótulo de materiais e medicamentos',
  '08': 'Comprovante de entrega de medicamentos',
  '09': 'Nota fiscal',
  '10': 'Boletim anestésico',
  '11': 'Selos hemoterápicos',
  '12': 'Exames de imagem',
  '13': 'Exames de análises clínicas',
  '14': 'Termo de consentimento',
  '15': 'Guia de cobrança de taxa',
  '16': 'Autorização prévia',
  '17': 'Relatório de auditoria',
};

export const MAXIMO_DOCUMENTOS_ENVIO = 20;
/** Limite por documento (o conteúdo vai em base64 dentro da mensagem). */
export const TAMANHO_MAXIMO_DOCUMENTO = 10 * 1024 * 1024;

export function formatoDocumentoTiss(tipoMime: string): string | null {
  return FORMATO_DOCUMENTO_POR_MIME[tipoMime.trim().toLowerCase()] ?? null;
}

export interface DocumentoParaEnvio {
  readonly tipoMime: string;
  readonly tamanho: number;
  readonly tipoDocumento: string;
}

export function conferirEnvioDocumentos(p: {
  readonly situacaoGuia: string;
  readonly documentos: readonly DocumentoParaEnvio[];
}): Problemas {
  const problemas: Problemas = [];
  if (p.situacaoGuia === 'cancelada')
    problemas.push({ campo: 'guia', mensagem: 'A guia está cancelada: não recebe documentos.' });
  if (p.documentos.length === 0)
    problemas.push({ campo: 'documentos', mensagem: 'Anexe ao menos um documento.' });
  if (p.documentos.length > MAXIMO_DOCUMENTOS_ENVIO)
    problemas.push({
      campo: 'documentos',
      mensagem: `Um envio leva no máximo ${MAXIMO_DOCUMENTOS_ENVIO} documentos.`,
    });
  p.documentos.forEach((d, i) => {
    const n = i + 1;
    if (!formatoDocumentoTiss(d.tipoMime))
      problemas.push({
        campo: `documentos.${i}`,
        mensagem: `Documento ${n}: o padrão aceita PDF, JPEG, PNG ou TIFF.`,
      });
    if (d.tamanho <= 0 || d.tamanho > TAMANHO_MAXIMO_DOCUMENTO)
      problemas.push({ campo: `documentos.${i}`, mensagem: `Documento ${n}: vazio ou acima de 10 MB.` });
    if (!TIPOS_DOCUMENTO_TISS[d.tipoDocumento])
      problemas.push({ campo: `documentos.${i}`, mensagem: `Documento ${n}: escolha o tipo do documento.` });
  });
  return problemas;
}

export type SituacaoItemDocumento = 'pendente' | 'enviado' | 'aceito' | 'rejeitado';

export interface ReciboDocumento {
  readonly item: number;
  /** protocoloDoc devolvido (aceito) ou o erro da operadora (rejeitado). */
  readonly protocolo: string | null;
  readonly erro: string | null;
}

/**
 * Confere o recibo dos documentos: o envio precisa estar enviado, cada documento informado uma vez e já enviado, com o
 * protocolo ou com o erro. O envio fica recebido quando todos foram respondidos e algum aceito; rejeitado quando todos
 * foram recusados; enviado enquanto falta resposta.
 */
export function conferirReciboDocumentos(
  situacao: string,
  itens: readonly { readonly id: number; readonly situacao: SituacaoItemDocumento }[],
  recibos: readonly ReciboDocumento[],
): { readonly problemas: Problemas; readonly situacao: 'enviado' | 'recebido' | 'rejeitado' | null } {
  const problemas: Problemas = [];
  if (situacao !== 'enviado')
    return {
      problemas: [
        {
          campo: 'situacao',
          mensagem:
            situacao === 'rascunho' ? 'O envio ainda não saiu.' : 'O envio já tem a resposta da operadora.',
        },
      ],
      situacao: null,
    };
  if (recibos.length === 0)
    problemas.push({ campo: 'documentos', mensagem: 'Informe o recibo de um documento.' });
  const porId = new Map(itens.map((i) => [i.id, i.situacao]));
  const vistos = new Set<number>();
  for (const r of recibos) {
    if (porId.get(r.item) !== 'enviado')
      problemas.push({ campo: 'documentos', mensagem: 'Documento fora do envio ou já respondido.' });
    if (vistos.has(r.item))
      problemas.push({ campo: 'documentos', mensagem: 'Documento informado duas vezes.' });
    vistos.add(r.item);
    const comProtocolo = !!r.protocolo?.trim();
    const comErro = !!r.erro?.trim();
    if (comProtocolo === comErro)
      problemas.push({
        campo: 'documentos',
        mensagem: 'Cada documento leva o protocolo da operadora ou o motivo da recusa.',
      });
  }
  if (problemas.length) return { problemas, situacao: null };
  const depois = itens.map((i) => {
    const r = recibos.find((x) => x.item === i.id);
    return r ? (r.protocolo?.trim() ? 'aceito' : 'rejeitado') : i.situacao;
  });
  const situacaoNova = depois.some((s) => s === 'enviado' || s === 'pendente')
    ? 'enviado'
    : depois.some((s) => s === 'aceito')
      ? 'recebido'
      : 'rejeitado';
  return { problemas, situacao: situacaoNova };
}

export interface DocumentoTiss {
  readonly numeroLote?: string | null;
  readonly numeroProtocolo?: string | null;
  readonly numeroGuiaPrestador?: string | null;
  readonly numeroGuiaOperadora?: string | null;
  readonly numeroDocumento: string;
  /** dm_tipoGuia: 1 solicitação, 2 faturamento, 3 recurso de glosa. */
  readonly naturezaGuia: '1' | '2' | '3';
  readonly formatoDocumento: string;
  readonly conteudo: Uint8Array;
  readonly tipoDocumento: string;
  readonly observacao?: string | null;
}

const ALFABETO_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 sem depender do ambiente (Node ou navegador). */
export function base64Documento(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += ALFABETO_BASE64[(n >> 18) & 63]! + ALFABETO_BASE64[(n >> 12) & 63]!;
    s += i + 1 < b.length ? ALFABETO_BASE64[(n >> 6) & 63]! : '=';
    s += i + 2 < b.length ? ALFABETO_BASE64[n & 63]! : '=';
  }
  return s;
}

/** ENVIO_DOCUMENTO: um documento por mensagem (ct_envioDocumentos), conteúdo em base64. */
export function mensagemEnvioDocumento(cab: Cabecalho, d: DocumentoTiss): MensagemTiss {
  if (!d.numeroGuiaPrestador?.trim() && !d.numeroLote?.trim())
    throw new ErroLoteTiss('O documento precisa da guia ou do lote a que se refere.');
  if (!Object.values(FORMATO_DOCUMENTO_POR_MIME).includes(d.formatoDocumento))
    throw new ErroLoteTiss('Formato de documento fora do padrão.');
  if (!TIPOS_DOCUMENTO_TISS[d.tipoDocumento]) throw new ErroLoteTiss('Tipo de documento fora do padrão.');
  if (d.conteudo.length === 0) throw new ErroLoteTiss('O documento está vazio.');
  const corpo = el(
    'prestadorParaOperadora',
    el(
      'envioDocumentos',
      opcional('numeroLote', d.numeroLote),
      opcional('numeroProtocolo', d.numeroProtocolo),
      opcional('numeroGuiaPrestador', d.numeroGuiaPrestador),
      opcional('numeroGuiaOperadora', d.numeroGuiaOperadora),
      el('numeroDocumento', d.numeroDocumento),
      el('naturezaGuia', d.naturezaGuia),
      el('formatoDocumento', d.formatoDocumento),
      el('documento', base64Documento(d.conteudo)),
      el('tipoDocumento', d.tipoDocumento),
      opcional('observacao', d.observacao),
    ),
  );
  return montarMensagemTiss(cab, 'ENVIO_DOCUMENTO', corpo);
}
