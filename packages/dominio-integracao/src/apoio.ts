// Retorno do laboratório de apoio (M34; ficha, regra 13; cap-12 §12.2, Laboratório de apoio): o resultado entra
// ESTRUTURADO, pelo de-para do estabelecimento (o mesmo cadastro que a interface em uso lê: o exame do laboratório
// em SITBEXHP, os elementos em SITBELHP pelo código do laboratório, ligados pelo nome ao elemento do exame do
// cadastro), é conferido e liberado pelo responsável técnico. Uma interface por estabelecimento de cada vez (a troca
// da interface em uso para o conector é liberação da Fase 4, reversível). Regras puras.
import type { ElementoApoio } from '@sgh/contratos';

export interface ValorRecebido {
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly valor: string;
  readonly unidade: string;
  readonly referencia: string;
}

export interface ElementoDePara {
  /** Código do elemento no laboratório (SITBELHP.COD). */
  readonly codigoLaboratorio: string;
  /** Nome do elemento no de-para (SITBELHP.ELEMENTO_NOME). */
  readonly nome: string | null;
}

export interface ElementoDoExame {
  /** Número do elemento no exame do cadastro (o resultado grava por ele). */
  readonly elemento: number;
  readonly nome: string;
}

/** Nome comparável: sem acento, sem pontuação, maiúsculo, espaços únicos. */
export function nomeComparavel(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Valor numérico do laboratório (vírgula ou ponto decimal); texto quando não é número. */
export function valorDoLaboratorio(
  tipo: string,
  valor: string,
): { numerico: number | null; alfa: string | null } {
  const t = valor.trim();
  if ((tipo === 'NM' || tipo === 'SN') && /^-?\d+(?:[.,]\d+)?$/.test(t))
    return { numerico: Number(t.replace(',', '.')), alfa: null };
  return { numerico: null, alfa: t === '' ? null : t.slice(0, 60) };
}

/**
 * Casa os valores recebidos com os elementos do exame pelo de-para: código do laboratório → nome do de-para → o
 * elemento do exame com o mesmo nome. Exame de um elemento só com um valor só casa direto (o elemento 0). O que não
 * casa vai para `semDePara` (a conferência mostra; nada é gravado no escuro).
 */
export function casarResultado(
  valores: readonly ValorRecebido[],
  dePara: readonly ElementoDePara[],
  elementos: readonly ElementoDoExame[],
): { elementos: ElementoApoio[]; semDePara: string[] } {
  const porCodigo = new Map(dePara.map((d) => [d.codigoLaboratorio.trim().toUpperCase(), d]));
  const porNome = new Map(elementos.map((e) => [nomeComparavel(e.nome), e]));
  const r: ElementoApoio[] = [];
  const semDePara: string[] = [];
  const usados = new Set<number>();
  const umSo = elementos.length === 1 && valores.length === 1;
  for (const v of valores) {
    const d = porCodigo.get(v.codigo.trim().toUpperCase());
    const alvo = umSo
      ? elementos[0]
      : d?.nome
        ? porNome.get(nomeComparavel(d.nome))
        : porNome.get(nomeComparavel(v.nome));
    if (!alvo || usados.has(alvo.elemento) || (!umSo && !d)) {
      semDePara.push(v.codigo || v.nome);
      continue;
    }
    usados.add(alvo.elemento);
    const { numerico, alfa } = valorDoLaboratorio(v.tipo, v.valor);
    r.push({
      elemento: alvo.elemento,
      codigoApoio: v.codigo.slice(0, 18),
      nome: alvo.nome.slice(0, 80),
      numerico,
      alfa,
      unidade: v.unidade ? v.unidade.slice(0, 20) : null,
      referencia: v.referencia ? v.referencia.slice(0, 80) : null,
    });
  }
  return { elementos: r.sort((a, b) => a.elemento - b.elemento), semDePara };
}

/**
 * A conferência pode aprovar? Só com todos os valores casados, ao menos um elemento e quem confere habilitado (o
 * responsável técnico da sessão, conferido no servidor).
 */
export function podeAprovar(c: {
  readonly elementos: number;
  readonly semDePara: number;
  readonly habilitado: boolean;
}): { pode: boolean; motivo: string | null } {
  if (!c.habilitado)
    return {
      pode: false,
      motivo: 'Só o responsável técnico habilitado aprova o resultado do laboratório de apoio.',
    };
  if (c.elementos === 0)
    return { pode: false, motivo: 'O retorno não trouxe nenhum valor que case com o exame.' };
  if (c.semDePara > 0)
    return {
      pode: false,
      motivo: 'Há valores sem de-para: corrija o de-para do laboratório de apoio antes de aprovar.',
    };
  return { pode: true, motivo: null };
}

/** Uma interface por estabelecimento de cada vez: o conector não liga com a interface em uso ligada. */
export function conectorPodeLigar(interfaceEmUsoLigada: boolean): { pode: boolean; motivo: string | null } {
  return interfaceEmUsoLigada
    ? {
        pode: false,
        motivo:
          'A interface em uso deste laboratório está ligada: o conector só liga depois de desligada (troca combinada com o laboratório e a TI; religar desfaz).',
      }
    : { pode: true, motivo: null };
}
