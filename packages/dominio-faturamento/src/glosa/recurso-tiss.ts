// F3.7 (06-FAT linha 34): o recurso de glosa vira a guia de recurso TISS 04.03.00 (RECURSO_GLOSA, ctm_recursoGlosa).
// Cada recurso gravado leva uma mensagem: o lote de origem e o protocolo que a operadora deu a ele, o cadastro TISS do
// convênio e, por guia de origem, os itens recorridos (itensGuia: procedimento ou despesa, código da glosa, valor
// pleiteado e justificativa). Regras puras: a operação confere as faltas, monta o recurso e o montador valida no XSD.
import type { RecursoGlosa } from '../tiss/lote.js';

/** O lote de origem e o cadastro TISS do convênio, como a porta os lê. */
export interface OrigemRecursoTiss {
  /** Número do lote em que a conta foi apresentada (null = conta fora de lote TISS). */
  readonly numeroLote: string | null;
  /** Protocolo devolvido pela operadora ao receber o lote de origem (null = ainda sem protocolo). */
  readonly numeroProtocolo: string | null;
  readonly registroAns: string;
  readonly codigoPrestador: string;
  readonly nomeOperadora: string;
}

/** Item recorrido como a porta o lê: a guia de origem e o item apresentado. */
export interface ItemRecursoTiss {
  readonly numeroGuia: string | null;
  readonly numeroGuiaOperadora: string | null;
  readonly senha: string | null;
  /** AAAA-MM-DD da realização. */
  readonly data: string | null;
  readonly codigoTabela: string;
  readonly codigo: string;
  readonly descricao: string;
  /** Código do motivo na terminologia de glosas (TUSS 38); null = sem motivo informado. */
  readonly codigoGlosa: string | null;
  readonly valorRecursado: number;
  readonly justificativa: string;
}

const limpo = (s: string, max: number) =>
  s
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Número sem os zeros à esquerda (como o lote foi enviado no XML). */
const semZeros = (s: string) => (/^\d+$/.test(s) ? String(Number(s)) : s);

/**
 * O que impede a guia de recurso TISS: o lote de origem com o protocolo (numérico, até 12 dígitos), o registro ANS e o
 * código do prestador, e, em cada item, a guia de origem, o motivo da glosa e o código do item. Lista vazia = pode montar.
 */
export function faltasDoRecursoTiss(o: OrigemRecursoTiss, itens: readonly ItemRecursoTiss[]): string[] {
  const f: string[] = [];
  if (!o.numeroLote?.trim()) f.push('o lote TISS em que a conta foi apresentada');
  else if (semZeros(o.numeroLote.trim()).length > 12)
    f.push('o número do lote de origem com até 12 caracteres');
  if (!o.numeroProtocolo?.trim()) f.push('o protocolo da operadora no lote de origem');
  else if (!/^\d{1,12}$/.test(o.numeroProtocolo.trim()))
    f.push('o protocolo do lote de origem numérico, com até 12 dígitos');
  if (!/^\d{6}$/.test(o.registroAns)) f.push('o registro ANS da operadora (6 dígitos)');
  if (!o.codigoPrestador.trim()) f.push('o código do prestador na operadora');
  if (itens.length === 0) f.push('ao menos um item recorrido');
  if (itens.some((i) => !i.numeroGuia?.trim())) f.push('o número da guia de origem de cada item');
  if (itens.some((i) => !i.codigoGlosa || !/^\d{4}$/.test(i.codigoGlosa)))
    f.push('o motivo da glosa (código de 4 dígitos da terminologia) de cada item');
  if (itens.some((i) => !i.codigo.trim())) f.push('o código do procedimento ou da despesa de cada item');
  if (itens.some((i) => !i.data)) f.push('a data de realização de cada item');
  return [...new Set(f)];
}

/**
 * A guia de recurso do lote: o número do recurso como número da guia do prestador, o lote e o protocolo de origem e,
 * por guia de origem (na ordem em que aparecem), os itens em sequência. Chamar só sem faltas (faltasDoRecursoTiss).
 */
export function recursoTissDoLote(
  numeroRecurso: string,
  dataRecurso: string,
  o: OrigemRecursoTiss,
  itens: readonly ItemRecursoTiss[],
): RecursoGlosa {
  const guias = new Map<string, ItemRecursoTiss[]>();
  for (const i of itens) {
    const k = i.numeroGuia!.trim();
    guias.set(k, [...(guias.get(k) ?? []), i]);
  }
  return {
    numeroGuiaRecurso: limpo(semZeros(numeroRecurso), 20),
    nomeOperadora: limpo(o.nomeOperadora, 70) || 'NAO INFORMADO',
    numeroLote: semZeros(o.numeroLote!.trim()),
    numeroProtocolo: o.numeroProtocolo!.trim(),
    data: dataRecurso,
    guias: [...guias.entries()].map(([numero, its]) => ({
      numeroGuiaOrigem: limpo(numero, 20),
      numeroGuiaOperadora: its[0]!.numeroGuiaOperadora ? limpo(its[0]!.numeroGuiaOperadora, 20) : null,
      senha: its[0]!.senha ? limpo(its[0]!.senha, 20) : null,
      codigoGlosa: its[0]!.codigoGlosa!,
      justificativa: limpo(its[0]!.justificativa, 500) || 'NAO INFORMADO',
      valorRecursado: Math.round(its.reduce((s, i) => s + Math.round(i.valorRecursado * 100), 0)) / 100,
      itens: its.map((i, k) => ({
        sequencial: k + 1,
        dataInicio: i.data!,
        codigoTabela: i.codigoTabela,
        codigoProcedimento: limpo(i.codigo, 10),
        descricaoProcedimento: limpo(i.descricao, 150) || 'NAO INFORMADO',
        codigoGlosa: i.codigoGlosa!,
        valorRecursado: i.valorRecursado,
        justificativa: limpo(i.justificativa, 500) || 'NAO INFORMADO',
      })),
    })),
  };
}
