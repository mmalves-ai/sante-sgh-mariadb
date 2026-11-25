// F3.8, 07-FIN linha 100: o de-para contábil por evento, mantido pela tela. Cada fato do financeiro (a despesa
// reconhecida na emissão, o retido apropriado, o pagamento do título, o pagamento da guia) vira uma partida; a conta externa de cada
// lado vem da regra mais específica: evento + natureza vence evento sozinho, e o lado exato vence a regra "ambos". O
// centro de custo e o credor saem com o código do escritório contábil, quando mapeados. Sem conta num dos lados, o fato
// não entra no lote e fica na lista "sem de-para" (montarLoteContabil).
import { centavos, type RecusaFinanceiro } from '@sgh/contratos/regras-financeiro';
import type { DePara, EventoFinanceiro } from './lote-contabil.js';

/** Os eventos que o financeiro publica para a contabilização (catálogo nativo, código estável). */
// Partidas por fato (prática de mercado, regime de competência): a emissão debita a despesa pelo valor do documento e
// credita o fornecedor pelo líquido e o tributo a recolher pelo retido; o pagamento debita o fornecedor e credita o
// banco; o pagamento da guia debita o tributo a recolher e credita o banco. No regime de caixa a despesa entra no
// pagamento da parcela (débito despesa, crédito banco) e o retido da parcela vai ao tributo a recolher na mesma data.
// O débito do pagamento e o da guia herdam a conta do crédito da emissão e da retenção (`debitoDe`): o passivo que
// nasce numa partida é o mesmo que a outra baixa, sem cadastrar a mesma conta duas vezes.
export const EVENTOS_CONTABEIS_FINANCEIRO = {
  fin_despesa_reconhecida: 'Despesa reconhecida na emissão (débito despesa; crédito fornecedor pelo líquido)',
  fin_retencao_apropriada:
    'Tributo retido a recolher (débito: a despesa do título; crédito: tributo a recolher, pela natureza do tributo)',
  fin_pagamento_titulo: 'Pagamento ao fornecedor (débito: o fornecedor da emissão; crédito: banco)',
  fin_despesa_paga: 'Despesa paga, regime de caixa (débito despesa; crédito banco)',
  fin_recolhimento_retencao: 'Pagamento da guia do retido (débito: o tributo a recolher; crédito: banco)',
  fin_adiantamento_concedido:
    'Adiantamento pago ao fornecedor ou ao médico (débito: adiantamento a fornecedor; crédito: banco)',
  fin_adiantamento_compensado:
    'Adiantamento compensado na baixa do título (débito: o fornecedor da emissão ou a despesa paga; crédito: o adiantamento da concessão)',
  fin_adiantamento_devolvido:
    'Sobra do adiantamento devolvida (débito: banco; crédito: o adiantamento da concessão)',
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
  /** O credor médico (profissional), quando o credor não é fornecedor: o participante externo sai pelo de-para dele. */
  readonly profissional?: number | null;
  /** O débito herdado de outra regra (a conta do passivo que este fato baixa, ou a despesa do título na retenção). */
  readonly debitoDe?: {
    readonly evento: string;
    readonly lado: 'debito' | 'credito';
    readonly natureza: number | null;
  };
  /** O crédito herdado de outra regra (a conta do adiantamento da concessão, que a compensação e a devolução baixam). */
  readonly creditoDe?: {
    readonly evento: string;
    readonly lado: 'debito' | 'credito';
    readonly natureza: number | null;
  };
}

/** A regra que dá a conta de cada lado do fato (o débito pode vir de outra regra, `debitoDe`). */
function origemDoLado(f: FatoContabil, lado: 'debito' | 'credito') {
  if (lado === 'debito' && f.debitoDe) return f.debitoDe;
  if (lado === 'credito' && f.creditoDe) return f.creditoDe;
  return { evento: f.evento, lado, natureza: f.natureza };
}
function contaDoLado(regras: readonly RegraDeParaConta[], f: FatoContabil, lado: 'debito' | 'credito') {
  const o = origemDoLado(f, lado);
  return contaExterna(regras, o.evento, o.lado, o.natureza);
}

export interface TituloParaContabil {
  readonly data: string;
  /** O valor do documento (bruto menos desconto mais acréscimo): a despesa reconhecida. */
  readonly valorDespesa: number;
  readonly historico: string;
  readonly documento: string;
  readonly natureza: number | null;
  readonly centro: number | null;
  readonly credor: number | null;
  readonly profissional?: number | null;
  /** O retido de cada tributo (não dispensado), com a natureza do tributo (a conta do tributo a recolher). */
  readonly retencoes: readonly {
    readonly tributo: string;
    readonly natureza: number | null;
    readonly valor: number;
  }[];
}

/**
 * A apropriação da despesa em partidas: competência na emissão (débito despesa, crédito fornecedor pelo líquido) ou
 * caixa no pagamento (débito despesa, crédito banco pelo pago), mais uma partida por tributo retido (débito a mesma
 * despesa, crédito o tributo a recolher). A soma das partidas é o valor da despesa.
 */
export function fatosDaApropriacao(t: TituloParaContabil, regua: 'competencia' | 'caixa'): FatoContabil[] {
  const principal = regua === 'competencia' ? 'fin_despesa_reconhecida' : 'fin_despesa_paga';
  const base = {
    data: t.data,
    documento: t.documento,
    centro: t.centro,
    credor: t.credor,
    ...(t.profissional != null ? { profissional: t.profissional } : {}),
  };
  const retidos = t.retencoes.filter((r) => r.valor > 0);
  const liquido = centavos(t.valorDespesa - retidos.reduce((s, r) => s + r.valor, 0));
  const fatos: FatoContabil[] = [];
  if (liquido > 0)
    fatos.push({ ...base, evento: principal, valor: liquido, historico: t.historico, natureza: t.natureza });
  for (const r of retidos)
    fatos.push({
      ...base,
      evento: 'fin_retencao_apropriada',
      valor: centavos(r.valor),
      historico: `${t.historico} RETIDO ${r.tributo}`,
      natureza: r.natureza,
      debitoDe: { evento: principal, lado: 'debito', natureza: t.natureza },
    });
  return fatos;
}

/**
 * O pagamento de uma parcela que baixa um passivo: ao fornecedor (débito a conta do fornecedor da emissão) ou a guia do
 * retido (débito a conta do tributo a recolher, pela natureza do tributo); crédito o banco, pelo evento do fato.
 */
export function fatoDoPagamento(p: {
  readonly data: string;
  readonly valor: number;
  readonly historico: string;
  readonly documento: string;
  readonly natureza: number | null;
  readonly centro: number | null;
  readonly credor: number | null;
  readonly profissional?: number | null;
  /** A guia do retido: a natureza do tributo recolhido; nulo: pagamento ao fornecedor. */
  readonly recolhimento: { readonly naturezaTributo: number | null } | null;
}): FatoContabil {
  const { recolhimento, ...f } = p;
  return recolhimento
    ? {
        ...f,
        evento: 'fin_recolhimento_retencao',
        debitoDe: {
          evento: 'fin_retencao_apropriada',
          lado: 'credito',
          natureza: recolhimento.naturezaTributo,
        },
      }
    : {
        ...f,
        evento: 'fin_pagamento_titulo',
        debitoDe: { evento: 'fin_despesa_reconhecida', lado: 'credito', natureza: p.natureza },
      };
}

/** O adiantamento na contabilização: a concessão (saída do banco), a compensação e a devolução (baixas dele). */
export interface AdiantamentoParaContabil {
  readonly data: string;
  readonly valor: number;
  readonly historico: string;
  readonly documento: string;
  readonly natureza: number | null;
  readonly centro: number | null;
  readonly credor: number | null;
  /** O adiantamento a médico: o profissional credor (o fornecedor fica nulo). */
  readonly profissional?: number | null;
}
/** A conta do adiantamento é uma só: o débito da concessão, que a compensação e a devolução creditam. */
const CONTA_DO_ADIANTAMENTO = {
  evento: 'fin_adiantamento_concedido',
  lado: 'debito',
  natureza: null,
} as const;

/** A concessão paga: débito o adiantamento a fornecedor, crédito o banco. */
export function fatoDaConcessao(a: AdiantamentoParaContabil): FatoContabil {
  return { ...a, evento: 'fin_adiantamento_concedido', natureza: null };
}

/**
 * A compensação na baixa do título: crédito o adiantamento (a conta da concessão); débito o fornecedor da emissão
 * (competência: baixa o passivo que a emissão criou) ou a despesa paga, pela natureza do título (caixa).
 */
export function fatoDaCompensacao(c: AdiantamentoParaContabil, regua: 'competencia' | 'caixa'): FatoContabil {
  return {
    ...c,
    evento: 'fin_adiantamento_compensado',
    debitoDe:
      regua === 'competencia'
        ? { evento: 'fin_despesa_reconhecida', lado: 'credito', natureza: c.natureza }
        : { evento: 'fin_despesa_paga', lado: 'debito', natureza: c.natureza },
    creditoDe: CONTA_DO_ADIANTAMENTO,
  };
}

/** A sobra devolvida: débito o banco (regra do evento), crédito o adiantamento (a conta da concessão). */
export function fatoDaDevolucao(d: AdiantamentoParaContabil): FatoContabil {
  return { ...d, evento: 'fin_adiantamento_devolvido', natureza: null, creditoDe: CONTA_DO_ADIANTAMENTO };
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
  /** O código externo do credor médico, pelo profissional (o par tipo e código do credor não se mistura). */
  profissionais: ReadonlyMap<number, string> = new Map(),
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
      participanteExterno:
        f.credor !== null
          ? (credores.get(f.credor) ?? '')
          : f.profissional != null
            ? (profissionais.get(f.profissional) ?? '')
            : '',
    });
    depara.push({
      evento: chave,
      contaDebito: contaDoLado(regras, f, 'debito') ?? '',
      contaCredito: contaDoLado(regras, f, 'credito') ?? '',
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
      if (!contaDoLado(regras, f, lado)) {
        // A falta aponta a regra que dá a conta (no débito herdado, a regra de origem).
        const o = origemDoLado(f, lado);
        const k = `${o.evento}|${o.natureza}|${o.lado}`;
        const x = mapa.get(k) ?? { evento: o.evento, natureza: o.natureza, lado: o.lado, fatos: 0 };
        x.fatos += 1;
        mapa.set(k, x);
      }
  return [...mapa.values()];
}
