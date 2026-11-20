// Gestão documental da qualidade (M48, etapa 5; manual m17 "Indicadores e gestão da qualidade (ONA)"; cap-13
// §13.3.12): o documento tem código, revisão numerada, elaboração e aprovação por pessoas diferentes, vigência (data
// da próxima revisão) e ciência por usuário. A revisão nova torna a anterior obsoleta na mesma transação; nada se apaga.
import type { PublicarDocumentoEntrada, SituacaoDocumentoQualidade } from '@sgh/contratos';
import { MESES_REVISAO_DOCUMENTO_PADRAO } from '@sgh/contratos';
import { somarMeses } from './comum.js';

/** Vigência máxima de uma revisão (cinco anos: depois disso o documento volta à revisão). */
export const MESES_VIGENCIA_MAXIMA_DOCUMENTO = 60;

export type RecusaDocumento =
  | 'aprovador-e-elaborador'
  | 'revisor-e-elaborador'
  | 'vigencia-no-passado'
  | 'vigencia-longa'
  | 'codigo-ja-vigente'
  | 'substituta-de-outro-codigo'
  | 'substituta-nao-vigente'
  | 'documento-nao-vigente'
  | 'ciencia-ja-registrada'
  | 'versao-desatualizada';

/** A data da próxima revisão sugerida (a padrão é dois anos depois da publicação). */
export function vigenciaPadraoDocumento(publicadoEm: string): string {
  return somarMeses(publicadoEm.slice(0, 10), MESES_REVISAO_DOCUMENTO_PADRAO);
}

export interface DocumentoExistente {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly revisao: number;
  readonly situacao: SituacaoDocumentoQualidade;
}

/**
 * A publicação: o aprovador (a sessão) não é o elaborador, nem o revisor; a vigência é futura e de até cinco anos; um
 * código novo não pode já ter revisão vigente; a revisão substitui a vigente do mesmo código, na versão lida.
 * Devolve a recusa ou o número da revisão nova.
 */
export function conferirPublicacao(e: {
  readonly entrada: Pick<
    PublicarDocumentoEntrada,
    'codigo' | 'elaboradoPor' | 'revisadoPor' | 'vigenciaAte' | 'substitui'
  >;
  readonly aprovador: string;
  readonly hoje: string;
  /** As revisões do código já publicadas (de qualquer situação). */
  readonly doCodigo: readonly DocumentoExistente[];
}): { recusa: RecusaDocumento } | { revisao: number } {
  const { entrada: d, aprovador, hoje } = e;
  const aprov = aprovador.trim().toUpperCase();
  if (d.elaboradoPor.toUpperCase() === aprov) return { recusa: 'aprovador-e-elaborador' };
  if (d.revisadoPor && d.revisadoPor.toUpperCase() === d.elaboradoPor.toUpperCase())
    return { recusa: 'revisor-e-elaborador' };
  if (d.vigenciaAte <= hoje) return { recusa: 'vigencia-no-passado' };
  if (d.vigenciaAte > somarMeses(hoje, MESES_VIGENCIA_MAXIMA_DOCUMENTO)) return { recusa: 'vigencia-longa' };
  const vigente = e.doCodigo.find((x) => x.situacao === 'vigente');
  const ultima = Math.max(0, ...e.doCodigo.map((x) => x.revisao));
  if (d.substitui === null) return vigente ? { recusa: 'codigo-ja-vigente' } : { revisao: ultima + 1 };
  const alvo = e.doCodigo.find((x) => x.id === d.substitui?.id);
  if (!alvo) return { recusa: 'substituta-de-outro-codigo' };
  if (alvo.situacao !== 'vigente') return { recusa: 'substituta-nao-vigente' };
  if (alvo.versao !== d.substitui.versao) return { recusa: 'versao-desatualizada' };
  return { revisao: ultima + 1 };
}

/** A retirada de uso: só da revisão vigente, na versão lida. */
export function recusaRetirada(
  doc: Pick<DocumentoExistente, 'versao' | 'situacao'>,
  versao: number,
): RecusaDocumento | null {
  if (doc.situacao !== 'vigente') return 'documento-nao-vigente';
  if (doc.versao !== versao) return 'versao-desatualizada';
  return null;
}

/** A ciência: só da revisão vigente e uma vez por usuário. */
export function recusaCiencia(
  doc: Pick<DocumentoExistente, 'situacao'>,
  jaCiente: boolean,
): RecusaDocumento | null {
  if (doc.situacao !== 'vigente') return 'documento-nao-vigente';
  if (jaCiente) return 'ciencia-ja-registrada';
  return null;
}

/** A revisão passou da data de revisão (vigente e vencida: a tela destaca; o documento segue valendo). */
export function revisaoVencida(
  doc: { readonly situacao: SituacaoDocumentoQualidade; readonly vigenciaAte: string },
  hoje: string,
): boolean {
  return doc.situacao === 'vigente' && doc.vigenciaAte < hoje;
}

/** O texto do documento normalizado para o resumo (o mesmo conteúdo dá o mesmo resumo). */
export function textoParaResumoDocumento(d: {
  readonly codigo: string;
  readonly revisao: number;
  readonly titulo: string;
  readonly conteudo: string;
}): string {
  return [d.codigo, String(d.revisao), d.titulo.trim(), d.conteudo.replace(/\r\n/g, '\n').trim()].join('\n');
}
