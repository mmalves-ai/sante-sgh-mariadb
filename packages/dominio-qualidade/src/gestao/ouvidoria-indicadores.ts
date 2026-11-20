// W0-04 (M4, mercado: ouvidoria/SAC hospitalar): as regras puras do canal de origem e dos indicadores da ouvidoria.
//   - O canal da Hal-AI só entra com o parâmetro ligado (até o dono configurar o canal, a API recusa).
//   - Indicadores da competência (mês do recebimento), sem as canceladas: respondidas no prazo sobre as de desfecho
//     conhecido (respondidas e as abertas ou encaminhadas de prazo vencido), por tipo, por área responsável e por canal,
//     sempre com a conta impressa.
import type { GrupoIndicadorOuvidoria, IndicadoresOuvidoria, ParcelaOuvidoria } from '@sgh/contratos';
import { msLocal } from '../nsp/prazos.js';
import { numeroBr } from './comum.js';

export type RecusaCanalOuvidoria = 'canal-halai-desligado';

export const MENSAGENS_CANAL_OUVIDORIA: Readonly<Record<RecusaCanalOuvidoria, string>> = {
  'canal-halai-desligado':
    'O atendimento digital (Hal-AI) ainda não foi configurado como canal da ouvidoria neste estabelecimento.',
};

/** O canal da Hal-AI só com o parâmetro ligado; os demais sempre. */
export function recusaCanalOuvidoria(canal: string, halaiLigada: boolean): RecusaCanalOuvidoria | null {
  return canal === 'halai' && !halaiLigada ? 'canal-halai-desligado' : null;
}

/** O que os indicadores precisam de cada manifestação. */
export interface ManifestacaoParaIndicador {
  readonly tipo: string;
  readonly area: string;
  readonly canal: string;
  readonly situacao: string;
  readonly recebidaEm: string;
  readonly prazoEm: string;
  readonly respondidaEm: string | null;
  readonly canceladaEm?: string | null;
}

/** numerador ÷ denominador × 100, com uma casa, e a conta impressa. */
export function parcelaOuvidoria(numerador: number, denominador: number): ParcelaOuvidoria {
  if (denominador === 0) return { numerador, denominador, valor: null, conta: null };
  const valor = Math.round((numerador / denominador) * 1000) / 10;
  return {
    numerador,
    denominador,
    valor,
    conta: `${numerador} ÷ ${denominador} × 100 = ${numeroBr(valor, 1)}%`,
  };
}

function grupo(
  chave: string,
  xs: readonly ManifestacaoParaIndicador[],
  agora: number,
): GrupoIndicadorOuvidoria {
  const respondidas = xs.filter((m) => m.situacao === 'respondida' && m.respondidaEm !== null);
  const noPrazo = respondidas.filter((m) => msLocal(m.respondidaEm as string) <= msLocal(m.prazoEm)).length;
  const vencidas = xs.filter((m) => m.situacao !== 'respondida' && agora > msLocal(m.prazoEm)).length;
  return {
    chave,
    total: xs.length,
    respondidas: respondidas.length,
    vencidas,
    noPrazo: parcelaOuvidoria(noPrazo, respondidas.length + vencidas),
  };
}

/**
 * Revisão do W0-04: a chave do agrupamento por área, que é texto livre na manifestação. "UTI", "uti", "U.T.I." e
 * "Uti " caem na mesma área: sem acento, sem pontuação, maiúsculas e espaços simples.
 */
export function chaveDeArea(area: string): string {
  return area
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\b([A-Z0-9])(?: (?=[A-Z0-9]\b))/g, '$1');
}

function porChave(
  xs: readonly ManifestacaoParaIndicador[],
  chave: (m: ManifestacaoParaIndicador) => string,
  agora: number,
  rotulo?: (m: ManifestacaoParaIndicador) => string,
): GrupoIndicadorOuvidoria[] {
  const m = new Map<string, ManifestacaoParaIndicador[]>();
  for (const x of xs) m.set(chave(x), [...(m.get(chave(x)) ?? []), x]);
  // O rótulo do grupo: a grafia mais usada (empate: a primeira em ordem alfabética).
  const rotuloDe = (k: string, v: readonly ManifestacaoParaIndicador[]) => {
    if (!rotulo) return k;
    const n = new Map<string, number>();
    for (const x of v) n.set(rotulo(x), (n.get(rotulo(x)) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))[0]?.[0] ?? k;
  };
  return [...m.entries()]
    .map(([k, v]) => grupo(rotuloDe(k, v), v, agora))
    .sort((a, b) => b.total - a.total || a.chave.localeCompare(b.chave, 'pt-BR'));
}

/** Os indicadores da ouvidoria na competência `AAAA-MM` (mês do recebimento). */
export function indicadoresOuvidoria(
  competencia: string,
  manifestacoes: readonly ManifestacaoParaIndicador[],
  agora: string,
  prazoDiasUteis: number,
): IndicadoresOuvidoria {
  const doMes = manifestacoes.filter((m) => m.recebidaEm.slice(0, 7) === competencia);
  const validas = doMes.filter((m) => !m.canceladaEm);
  const a = msLocal(agora);
  const geral = grupo('total', validas, a);
  return {
    competencia,
    prazoDiasUteis,
    total: validas.length,
    canceladas: doMes.length - validas.length,
    respondidas: geral.respondidas,
    vencidas: geral.vencidas,
    noPrazo: geral.noPrazo,
    porTipo: porChave(validas, (m) => m.tipo, a),
    porArea: porChave(
      validas,
      (m) => chaveDeArea(m.area),
      a,
      (m) => m.area.trim(),
    ),
    porCanal: porChave(validas, (m) => m.canal, a),
  };
}
