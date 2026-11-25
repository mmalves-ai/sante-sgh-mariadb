// Laudo de solicitação de internação SUS (F7, 06-SUS linha 57): o laudo emitido junto com a solicitação da AIH, a
// devolução pelo gestor (o laudo volta ao hospital para correção, sem ser negado), o reenvio corrigido, o laudo especial
// (OPM, sangue, diárias de acompanhante e de UTI pedidos depois da autorização) e o lote de laudos enviado ao gestor.
// Regras puras: a porta própria lê, confere aqui e grava. Nada é apagado: o laudo cancelado ou devolvido fica com o
// motivo, e o lote cancelado libera os laudos para outro lote.
import type { SituacaoAih } from '@sgh/contratos';

/** As situações do laudo no banco. */
export const SITUACOES_LAUDO_INTERNACAO_SUS = [
  'rascunho',
  'emitido',
  'enviado',
  'autorizado',
  'negado',
  'devolvido',
  'cancelado',
] as const;
export type SituacaoLaudoInternacaoSus = (typeof SITUACOES_LAUDO_INTERNACAO_SUS)[number];

export const TIPOS_LAUDO_INTERNACAO_SUS = [
  'inicial',
  'mudanca_procedimento',
  'especial',
  'continuacao',
] as const;
export type TipoLaudoInternacaoSus = (typeof TIPOS_LAUDO_INTERNACAO_SUS)[number];

/** Os procedimentos especiais pedidos no laudo especial. */
export const TIPOS_ITEM_LAUDO_ESPECIAL = [
  'opm',
  'sangue',
  'diaria_acompanhante',
  'diaria_uti',
  'outro',
] as const;
export type TipoItemLaudoEspecial = (typeof TIPOS_ITEM_LAUDO_ESPECIAL)[number];

export const SITUACOES_LOTE_LAUDO_SUS = [
  'aberto',
  'fechado',
  'exportado',
  'enviado',
  'retornado',
  'cancelado',
] as const;
export type SituacaoLoteLaudoSus = (typeof SITUACOES_LOTE_LAUDO_SUS)[number];

/** Limites do formulário e do lote. */
export const MAXIMO_ITENS_LAUDO_ESPECIAL = 20;
export const MAXIMO_LAUDOS_POR_LOTE = 200;
export const MINIMO_MOTIVO_LAUDO = 10;

export interface ProblemaLaudo {
  readonly campo: string;
  readonly mensagem: string;
}

/**
 * A situação do laudo que acompanha a da autorização (a autorização é a raiz; o laudo é o documento enviado ao gestor).
 * O laudo de um lote já enviado continua "enviado" enquanto a autorização está solicitada.
 */
export function situacaoDoLaudoPelaAutorizacao(
  autorizacao: 'solicitada' | 'autorizada' | 'negada' | 'devolvida' | 'cancelada',
  emLoteEnviado: boolean,
): SituacaoLaudoInternacaoSus {
  switch (autorizacao) {
    case 'solicitada':
      return emLoteEnviado ? 'enviado' : 'emitido';
    case 'autorizada':
      return 'autorizado';
    case 'negada':
      return 'negado';
    case 'devolvida':
      return 'devolvido';
    case 'cancelada':
      return 'cancelado';
  }
}

const motivoCurto = (m: string | null | undefined) => (m ?? '').trim().length < MINIMO_MOTIVO_LAUDO;

/** A devolução pelo gestor: só da AIH solicitada (ainda sem número), com o motivo que o gestor deu. */
export function conferirDevolucaoLaudo(aih: SituacaoAih, motivo: string): ProblemaLaudo[] {
  const p: ProblemaLaudo[] = [];
  if (aih !== 'solicitada')
    p.push({
      campo: 'situacao',
      mensagem: 'Só a AIH solicitada (sem número) pode ser devolvida pelo gestor.',
    });
  if (motivoCurto(motivo))
    p.push({
      campo: 'motivo',
      mensagem: `O motivo da devolução precisa de ao menos ${MINIMO_MOTIVO_LAUDO} letras.`,
    });
  return p;
}

/** O reenvio corrigido: só da AIH devolvida, com a justificativa clínica refeita (e o que mais o gestor pediu). */
export function conferirReenvioLaudo(
  aih: SituacaoAih,
  correcao: { readonly justificativa: string; readonly mudouAlgo: boolean },
): ProblemaLaudo[] {
  const p: ProblemaLaudo[] = [];
  if (aih !== 'devolvida')
    p.push({ campo: 'situacao', mensagem: 'Só a AIH devolvida pelo gestor pode ser reenviada.' });
  if (motivoCurto(correcao.justificativa))
    p.push({
      campo: 'justificativa',
      mensagem: `A justificativa clínica precisa de ao menos ${MINIMO_MOTIVO_LAUDO} letras.`,
    });
  if (!correcao.mudouAlgo)
    p.push({
      campo: 'justificativa',
      mensagem: 'O laudo reenviado precisa da correção pedida: nada mudou em relação ao devolvido.',
    });
  return p;
}

export interface ItemLaudoEspecial {
  readonly tipo: TipoItemLaudoEspecial;
  /** Código SIGTAP (10 dígitos). */
  readonly procedimento: string;
  readonly quantidade: number;
  readonly justificativa?: string | null;
}

/**
 * O laudo especial: só da AIH autorizada e ainda aberta (antes do fechamento), de 1 a 20 itens; OPM só do grupo 07 da
 * SIGTAP; diárias em número inteiro; o mesmo procedimento não se repete; a justificativa do laudo é obrigatória.
 */
export function conferirLaudoEspecial(
  aih: SituacaoAih,
  itens: readonly ItemLaudoEspecial[],
  justificativa: string,
): ProblemaLaudo[] {
  const p: ProblemaLaudo[] = [];
  if (aih !== 'autorizada')
    p.push({
      campo: 'situacao',
      mensagem: 'O laudo especial só é emitido para a AIH autorizada e ainda não fechada.',
    });
  if (motivoCurto(justificativa))
    p.push({
      campo: 'justificativa',
      mensagem: `A justificativa do laudo especial precisa de ao menos ${MINIMO_MOTIVO_LAUDO} letras.`,
    });
  if (itens.length === 0) p.push({ campo: 'itens', mensagem: 'Informe ao menos um procedimento especial.' });
  if (itens.length > MAXIMO_ITENS_LAUDO_ESPECIAL)
    p.push({ campo: 'itens', mensagem: `O laudo especial aceita até ${MAXIMO_ITENS_LAUDO_ESPECIAL} itens.` });
  const vistos = new Set<string>();
  itens.forEach((x, i) => {
    const campo = `itens.${i}`;
    if (!TIPOS_ITEM_LAUDO_ESPECIAL.includes(x.tipo))
      p.push({ campo: `${campo}.tipo`, mensagem: 'Tipo de procedimento especial desconhecido.' });
    if (!/^\d{10}$/.test(x.procedimento))
      p.push({ campo: `${campo}.procedimento`, mensagem: 'O procedimento SIGTAP tem 10 dígitos.' });
    else if (x.tipo === 'opm' && !x.procedimento.startsWith('07'))
      p.push({
        campo: `${campo}.procedimento`,
        mensagem: 'Órtese, prótese ou material especial (OPM) é do grupo 07 da SIGTAP.',
      });
    if (!(x.quantidade > 0))
      p.push({ campo: `${campo}.quantidade`, mensagem: 'A quantidade precisa ser maior que zero.' });
    else if ((x.tipo === 'diaria_uti' || x.tipo === 'diaria_acompanhante') && !Number.isInteger(x.quantidade))
      p.push({ campo: `${campo}.quantidade`, mensagem: 'Diária é contada em número inteiro.' });
    const chave = `${x.tipo}:${x.procedimento}`;
    if (vistos.has(chave))
      p.push({ campo: `${campo}.procedimento`, mensagem: 'O mesmo procedimento já está no laudo.' });
    vistos.add(chave);
  });
  return p;
}

export interface LaudoParaLote {
  readonly id: number;
  readonly situacao: SituacaoLaudoInternacaoSus;
  /** O lote em que o laudo já está (não cancelado), se algum. */
  readonly lote: number | null;
}

/** O lote de laudos: de 1 a 200 laudos emitidos (ou corrigidos), nenhum já em outro lote, sem repetição. */
export function conferirLoteLaudos(
  pedidos: readonly number[],
  encontrados: readonly LaudoParaLote[],
): ProblemaLaudo[] {
  const p: ProblemaLaudo[] = [];
  if (pedidos.length === 0) p.push({ campo: 'laudos', mensagem: 'Escolha ao menos um laudo para o lote.' });
  if (pedidos.length > MAXIMO_LAUDOS_POR_LOTE)
    p.push({ campo: 'laudos', mensagem: `O lote aceita até ${MAXIMO_LAUDOS_POR_LOTE} laudos.` });
  if (new Set(pedidos).size !== pedidos.length)
    p.push({ campo: 'laudos', mensagem: 'O mesmo laudo foi escolhido duas vezes.' });
  for (const id of new Set(pedidos)) {
    const l = encontrados.find((x) => x.id === id);
    if (!l) p.push({ campo: 'laudos', mensagem: `O laudo ${id} não foi encontrado neste estabelecimento.` });
    else if (l.situacao !== 'emitido')
      p.push({ campo: 'laudos', mensagem: `O laudo ${id} não está emitido (está ${l.situacao}).` });
    else if (l.lote !== null)
      p.push({ campo: 'laudos', mensagem: `O laudo ${id} já está no lote ${l.lote}.` });
  }
  return p;
}

/** De que situação cada ação do lote parte. */
export const ORIGEM_DA_ACAO_LOTE_LAUDO: Readonly<
  Record<'enviar' | 'cancelar' | 'retornar', readonly SituacaoLoteLaudoSus[]>
> = {
  enviar: ['fechado', 'exportado'],
  cancelar: ['aberto', 'fechado'],
  retornar: ['enviado'],
};

export function acaoLotePermitida(
  acao: keyof typeof ORIGEM_DA_ACAO_LOTE_LAUDO,
  situacao: SituacaoLoteLaudoSus,
): boolean {
  return ORIGEM_DA_ACAO_LOTE_LAUDO[acao].includes(situacao);
}
