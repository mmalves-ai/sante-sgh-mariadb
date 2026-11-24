// F3.8, 07-FIN linha 100: o de-para contábil por evento, mantido pela tela. Cada fato do financeiro (a despesa
// reconhecida na emissão, o pagamento do título, o recolhimento do retido) vira uma partida; a conta externa de cada
// lado vem da regra mais específica: evento + natureza vence evento sozinho, e o lado exato vence a regra "ambos". O
// centro de custo e o credor saem com o código do escritório contábil, quando mapeados. Sem conta num dos lados, o fato
// não entra no lote e fica na lista "sem de-para" (montarLoteContabil).
import { type RecusaFinanceiro } from '@sgh/contratos/regras-financeiro';
import type { DePara, EventoFinanceiro } from './lote-contabil.js';

/** Os eventos que o financeiro publica para a contabilização (catálogo nativo, código estável). */
export const EVENTOS_CONTABEIS_FINANCEIRO = {
  fin_despesa_reconhecida: 'Despesa reconhecida na emissão do título a pagar',
  fin_pagamento_titulo: 'Pagamento do título a pagar',
  fin_recolhimento_retencao: 'Recolhimento do tributo retido na fonte',
} as const;
export type EventoContabilFinanceiro = keyof typeof EVENTOS_CONTABEIS_FINANCEIRO;
export type LadoDePara = 'debito' | 'credito' | 'ambos';

export interface RegraDeParaConta {
  readonly id: number;
  readonly evento: string;
  readonly lado: LadoDePara;
  /** Natureza financeira; nulo: vale para todas as naturezas do evento. */
  readonly natureza: number | null;
  readonly conta: string;
  readonly ativo: boolean;
}

export interface FatoContabil {
  readonly evento: string;
  readonly data: string;
  readonly valor: number;
  readonly historico: string;
  readonly documento: string;
  readonly natureza: number | null;
  readonly centro: number | null;
  readonly credor: number | null;
}

const CONTA_EXTERNA = /^[0-9A-Za-z][0-9A-Za-z.-]{0,49}$/;
const rec = (codigo: string, mensagem: string, campos: string[]): RecusaFinanceiro => ({
  codigo,
  mensagem,
  campos,
});

/** A conta externa do lado da partida, pela regra ativa mais específica; nulo: sem de-para. */
export function contaExterna(
  regras: readonly RegraDeParaConta[],
  evento: string,
  lado: 'debito' | 'credito',
  natureza: number | null,
): string | null {
  let melhor: { conta: string; peso: number } | null = null;
  for (const r of regras) {
    if (!r.ativo || r.evento !== evento) continue;
    if (r.lado !== lado && r.lado !== 'ambos') continue;
    if (r.natureza !== null && r.natureza !== natureza) continue;
    const peso = (r.natureza !== null ? 2 : 0) + (r.lado === lado ? 1 : 0);
    if (!melhor || peso > melhor.peso) melhor = { conta: r.conta, peso };
  }
  return melhor?.conta ?? null;
}

/** Confere a regra antes de gravar: evento do catálogo, conta no formato do plano externo, sem duplicar a ativa. */
export function conferirRegraDePara(
  e: {
    readonly id: number | null;
    readonly evento: string;
    readonly lado: LadoDePara;
    readonly natureza: number | null;
    readonly conta: string;
  },
  existentes: readonly RegraDeParaConta[],
): RecusaFinanceiro | null {
  if (!(e.evento in EVENTOS_CONTABEIS_FINANCEIRO))
    return rec('evento-desconhecido', 'Escolha um evento do financeiro.', ['evento']);
  if (!CONTA_EXTERNA.test(e.conta.trim()))
    return rec(
      'conta-externa-invalida',
      'A conta do escritório contábil aceita letras, números, ponto e hífen (até 50).',
      ['conta'],
    );
  const igual = existentes.find(
    (r) =>
      r.ativo &&
      r.id !== e.id &&
      r.evento === e.evento &&
      r.natureza === e.natureza &&
      (r.lado === e.lado || r.lado === 'ambos' || e.lado === 'ambos'),
  );
  if (igual)
    return rec(
      'de-para-duplicado',
      `Já há conta ativa para este evento, lado e natureza (${igual.conta}): altere a existente.`,
      ['lado', 'natureza'],
    );
  return null;
}

/** Os fatos com as contas, o centro e o credor externos, prontos para montarLoteContabil. */
export function dePararFatos(
  fatos: readonly FatoContabil[],
  regras: readonly RegraDeParaConta[],
  centros: ReadonlyMap<number, string>,
  credores: ReadonlyMap<number, string>,
): { readonly eventos: EventoFinanceiro[]; readonly depara: DePara[] } {
  const eventos: EventoFinanceiro[] = [];
  const depara: DePara[] = [];
  fatos.forEach((f, i) => {
    const chave = `${f.evento}#${i}`;
    eventos.push({
      data: f.data,
      evento: chave,
      valor: f.valor,
      historico: f.historico,
      documento: f.documento,
      centroExterno: f.centro !== null ? (centros.get(f.centro) ?? '') : '',
      participanteExterno: f.credor !== null ? (credores.get(f.credor) ?? '') : '',
    });
    depara.push({
      evento: chave,
      contaDebito: contaExterna(regras, f.evento, 'debito', f.natureza) ?? '',
      contaCredito: contaExterna(regras, f.evento, 'credito', f.natureza) ?? '',
    });
  });
  return { eventos, depara };
}

/** Os eventos sem conta em algum lado, para o aviso da tela (o que falta mapear antes de exportar). */
export function eventosSemDePara(
  fatos: readonly FatoContabil[],
  regras: readonly RegraDeParaConta[],
): {
  readonly evento: string;
  readonly natureza: number | null;
  readonly lado: 'debito' | 'credito';
  readonly fatos: number;
}[] {
  const mapa = new Map<
    string,
    { evento: string; natureza: number | null; lado: 'debito' | 'credito'; fatos: number }
  >();
  for (const f of fatos)
    for (const lado of ['debito', 'credito'] as const)
      if (!contaExterna(regras, f.evento, lado, f.natureza)) {
        const k = `${f.evento}|${f.natureza}|${lado}`;
        const x = mapa.get(k) ?? { evento: f.evento, natureza: f.natureza, lado, fatos: 0 };
        x.fatos += 1;
        mapa.set(k, x);
      }
  return [...mapa.values()];
}
