// Situação da conta (ficha do M30, regras 2 e 3; Anexo A, A.5). Marca de fechamento: N aberta, S fechada e não
// apresentada, A apresentada à operadora; F é uma conta anômala (erro de dado, 1 linha na cópia), só mostrada. O novo
// grava só N e S neste marco. A situação da tela é DERIVADA de FECHADA, IND_EMI, do vínculo com o lote TISS, do
// protocolo, dos valores de retorno e de recurso dos itens e das etapas do novo (SGH_FAT_CONTA_ETAPA); o que só o outro
// sistema move depois do envio (lote, protocolo, retorno, recurso) aparece como "inferida".

export const CODIGOS_FECHADA = ['N', 'S', 'A', 'F'] as const;
export type CodigoFechada = (typeof CODIGOS_FECHADA)[number];

export type SituacaoConta = 'aberta' | 'fechada' | 'apresentada' | 'erro-de-dado';

/** Regra 2: o significado de FECHADA (vazio e desconhecido viram erro de dado, nunca "aberta" por engano). */
export function situacaoDaConta(fechada: string | null | undefined): SituacaoConta {
  switch ((fechada ?? '').trim().toUpperCase()) {
    case 'N':
      return 'aberta';
    case 'S':
      return 'fechada';
    case 'A':
      return 'apresentada';
    default:
      return 'erro-de-dado';
  }
}

/** O que o novo grava em FECHADA (regra 2): só N (reabrir) e S (fechar). */
export const FECHADA_GRAVAVEL: readonly CodigoFechada[] = ['N', 'S'];

export const SITUACOES_DERIVADAS = [
  'aberta',
  'em-conferencia',
  'em-auditoria',
  'emitida',
  'fechada',
  'em-lote',
  'apresentada',
  'protocolada',
  'com-retorno',
  'em-recurso',
  'erro-de-dado',
] as const;
export type SituacaoDerivada = (typeof SITUACOES_DERIVADAS)[number];

/**
 * As situações que a lista de contas filtra no banco (total e páginas coerentes). Protocolada, com retorno e em
 * recurso dependem do protocolo e dos valores de retorno e recurso, lidos a partir do M31: até lá, não são filtro.
 */
export const SITUACOES_FILTRAVEIS = [
  'aberta',
  'em-conferencia',
  'em-auditoria',
  'emitida',
  'fechada',
  'em-lote',
  'apresentada',
  'erro-de-dado',
] as const satisfies readonly SituacaoDerivada[];

export const ROTULO_SITUACAO: Readonly<Record<SituacaoDerivada, string>> = {
  aberta: 'Aberta',
  'em-conferencia': 'Em conferência',
  'em-auditoria': 'Em auditoria',
  emitida: 'Emitida, pronta para fechar',
  fechada: 'Fechada',
  'em-lote': 'Fechada, em lote',
  apresentada: 'Apresentada à operadora',
  protocolada: 'Protocolada na operadora',
  'com-retorno': 'Com retorno da operadora',
  'em-recurso': 'Em recurso de glosa',
  'erro-de-dado': 'Situação inválida (erro de dado)',
};

export interface FatosSituacao {
  readonly fechada: string | null;
  readonly indEmi: string | null;
  /** A conta está em algum lote TISS. */
  readonly emLote: boolean;
  /** O lote da conta tem protocolo da operadora. */
  readonly protocolada: boolean;
  /** Soma dos valores pagos/glosados no retorno (VLR_PG) e de recurso (VLR_RE) dos itens. */
  readonly valorRetorno: number;
  readonly valorRecurso: number;
  /** A etapa em andamento registrada pelo novo (SGH_FAT_CONTA_ETAPA), se houver. */
  readonly etapaNovo: 'conferencia' | 'auditoria' | null;
}

export interface SituacaoCalculada {
  readonly situacao: SituacaoDerivada;
  readonly rotulo: string;
  /** Situação movida só pelo outro sistema depois do envio (lote, protocolo, retorno, recurso): "inferida". */
  readonly inferida: boolean;
  readonly base: SituacaoConta;
}

/** Regra 3: a situação na tela, derivada dos fatos da conta. */
export function situacaoDerivada(f: FatosSituacao): SituacaoCalculada {
  const base = situacaoDaConta(f.fechada);
  const r = (situacao: SituacaoDerivada, inferida = false): SituacaoCalculada => ({
    situacao,
    rotulo: ROTULO_SITUACAO[situacao] + (inferida ? ' (inferida)' : ''),
    inferida,
    base,
  });
  if (base === 'erro-de-dado') return r('erro-de-dado');
  if (base === 'aberta') {
    if (f.etapaNovo === 'auditoria') return r('em-auditoria');
    if (f.etapaNovo === 'conferencia') return r('em-conferencia');
    return (f.indEmi ?? '').trim().toUpperCase() === 'T' ? r('emitida') : r('aberta');
  }
  if (base === 'fechada') return f.emLote ? r('em-lote', true) : r('fechada');
  // Apresentada: o que vem depois só o outro sistema registra (lote, protocolo, retorno, recurso).
  if (f.valorRecurso > 0) return r('em-recurso', true);
  if (f.valorRetorno > 0) return r('com-retorno', true);
  if (f.protocolada) return r('protocolada', true);
  return r('apresentada');
}

/** A conta aceita lançamento? (regra 5: aberta e não emitida; senão o item vai para a fila). */
export function aceitaLancamento(fechada: string | null, indEmi: string | null): boolean {
  return situacaoDaConta(fechada) === 'aberta' && (indEmi ?? '').trim().toUpperCase() !== 'T';
}
