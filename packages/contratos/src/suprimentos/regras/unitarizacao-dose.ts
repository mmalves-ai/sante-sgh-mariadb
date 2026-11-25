// C2-092 (05-SUP linha 11): fracionamento e unitarização de dose com rastreio do lote de origem até a dose. Regras
// puras da ordem pela regra de fracionamento do insumo (insumo de origem, insumo resultante, rendimento, validade em
// horas e capela):
//   - a conferência da ordem: a regra ativa, o lote de origem obrigatório (o rastreio dose → lote começa nele), o lote
//     liberado e dentro da validade, a capela quando a regra exige, as doses inteiras e o rendimento previsto;
//   - a validade da dose fracionada pela RDC 67/2007 da ANVISA (boas práticas de manipulação, anexo de fracionamento):
//     até 25% do prazo remanescente da embalagem original, nunca acima de 6 meses, nunca depois da validade original e,
//     quando a regra dá a validade depois da abertura (em horas), nunca depois dela. Percentual acima de 25% só com o
//     estudo de estabilidade justificado na ordem;
//   - o rótulo de cada dose: nome, quantidade e unidade, lote de origem, validade original e nova, data do
//     fracionamento e o farmacêutico responsável, com o código da etiqueta (identificador único da dose).
import { montarEtiqueta } from './identificacao-estoque.js';
import { qtd3, type RecusaSuprimentos, recusa } from './recusa.js';

export const TIPOS_ORDEM_UNITARIZACAO = ['fracionamento', 'unitarizacao', 'reembalagem'] as const;
export type TipoOrdemUnitarizacao = (typeof TIPOS_ORDEM_UNITARIZACAO)[number];

/** Quantas doses (etiquetas) uma ordem produz de uma vez: a unitarização é de bancada. */
export const MAXIMO_DOSES_POR_ORDEM = 500;
/** RDC 67/2007: a validade da dose fracionada é de até 25% do prazo remanescente da embalagem original. */
export const PERCENTUAL_VALIDADE_PADRAO = 25;
/** RDC 67/2007: e nunca acima de 6 meses (180 dias) a partir do fracionamento. */
export const TETO_VALIDADE_DOSE_DIAS = 180;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DIA_MS = 86_400_000;

const diaUtc = (d: string): number => Date.parse(`${d}T00:00:00Z`);
const somarDias = (d: string, dias: number): string =>
  new Date(diaUtc(d) + dias * DIA_MS).toISOString().slice(0, 10);

export interface RegraFracionamentoParaConferir {
  readonly ativa: boolean;
  /** Quantidade do insumo de origem consumida num fracionamento. */
  readonly quantidadeOrigem: number;
  /** Doses do insumo resultante obtidas dessa quantidade. */
  readonly rendimento: number;
  readonly validadeHoras: number | null;
  readonly exigeCapela: boolean;
  /** A sobra do que foi aberto (rendimento previsto menos doses e perda) pode ser reaproveitada. Sem isso, é descarte. */
  readonly reaproveitaSobra: boolean;
}

/** As doses que a quantidade de origem rende pela regra (sem contar a perda). */
export function rendimentoPrevisto(
  regra: Pick<RegraFracionamentoParaConferir, 'quantidadeOrigem' | 'rendimento'>,
  quantidadeOrigem: number,
): number {
  if (!(regra.quantidadeOrigem > 0) || !(quantidadeOrigem > 0)) return 0;
  return qtd3((quantidadeOrigem / regra.quantidadeOrigem) * regra.rendimento);
}

/**
 * A sobra da ordem: o rendimento previsto do que foi aberto menos as doses e a perda (nunca negativa). Nada some do
 * inventário (RDC 67/2007): sem reaproveitamento pela regra, a sobra é descarte e entra na perda; com reaproveitamento,
 * fica registrada na ordem com a validade dela.
 */
export function sobraDaOrdem(
  regra: Pick<RegraFracionamentoParaConferir, 'quantidadeOrigem' | 'rendimento'>,
  quantidadeOrigem: number,
  doses: number,
  perda: number,
): number {
  const previsto = rendimentoPrevisto(regra, quantidadeOrigem);
  const usado =
    (Number.isFinite(doses) ? Math.max(0, doses) : 0) + (Number.isFinite(perda) ? Math.max(0, perda) : 0);
  const sobra = qtd3(previsto - usado);
  return sobra > 0.0005 ? sobra : 0;
}

export interface UnitarizacaoParaConferir {
  readonly regra: RegraFracionamentoParaConferir | null;
  readonly tipo: string;
  readonly quantidadeOrigem: number;
  readonly doses: number;
  readonly perda: number;
  readonly capela: number | null;
  /** O lote de origem no local (nulo: não informado ou fora do local). */
  readonly lote: {
    readonly validade: string;
    readonly situacao: string;
    readonly bloqueado: boolean;
    readonly saldo: number;
  } | null;
  /** AAAA-MM-DD do estabelecimento. */
  readonly hoje: string;
  readonly percentualEstabilidade: number | null;
  readonly observacao: string | null;
}

/** As recusas da ordem de unitarização (lista vazia: pode gravar). */
export function conferirUnitarizacao(x: UnitarizacaoParaConferir): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (!(TIPOS_ORDEM_UNITARIZACAO as readonly string[]).includes(x.tipo))
    out.push(
      recusa('tipo-invalido', 'O tipo da ordem é fracionamento, unitarização ou reembalagem.', ['tipo']),
    );
  if (!x.regra) {
    out.push(recusa('regra-inexistente', 'Escolha a regra de fracionamento do insumo.', ['regra']));
    return out;
  }
  if (!x.regra.ativa) out.push(recusa('regra-inativa', 'A regra de fracionamento está inativa.', ['regra']));
  if (!(x.quantidadeOrigem > 0))
    out.push(
      recusa('quantidade-origem-invalida', 'Informe quanto da embalagem original será aberto.', [
        'quantidadeOrigem',
      ]),
    );
  if (!x.lote)
    out.push(
      recusa(
        'lote-origem-obrigatorio',
        'Informe o lote de origem no local: cada dose leva o lote da embalagem original.',
        ['lote'],
      ),
    );
  else {
    if (x.lote.situacao !== 'liberado' || x.lote.bloqueado)
      out.push(recusa('lote-bloqueado', 'O lote de origem não está liberado para uso.', ['lote']));
    if (!DATA.test(x.lote.validade) || x.lote.validade < x.hoje)
      out.push(recusa('lote-vencido', 'O lote de origem está vencido.', ['lote']));
    if (x.quantidadeOrigem > 0 && x.lote.saldo < x.quantidadeOrigem)
      out.push(
        recusa('saldo-insuficiente', `Saldo do lote de origem insuficiente no local (há ${x.lote.saldo}).`, [
          'quantidadeOrigem',
        ]),
      );
  }
  if (x.regra.exigeCapela && x.capela === null)
    out.push(recusa('capela-obrigatoria', 'A regra exige capela ou área de manipulação.', ['capela']));
  if (!Number.isInteger(x.doses) || x.doses < 1 || x.doses > MAXIMO_DOSES_POR_ORDEM)
    out.push(
      recusa('doses-invalidas', `Informe de 1 a ${MAXIMO_DOSES_POR_ORDEM} doses inteiras.`, ['doses']),
    );
  if (!(x.perda >= 0)) out.push(recusa('perda-invalida', 'A perda não pode ser negativa.', ['perda']));
  const previsto = rendimentoPrevisto(x.regra, x.quantidadeOrigem);
  if (x.quantidadeOrigem > 0 && x.doses + Math.max(0, x.perda) > previsto + 0.0005)
    out.push(
      recusa(
        'rendimento-acima',
        `As doses mais a perda passam do rendimento da regra (${previsto} doses para ${x.quantidadeOrigem}).`,
        ['doses', 'perda'],
      ),
    );
  else if (x.quantidadeOrigem > 0 && !x.regra.reaproveitaSobra) {
    const sobra = sobraDaOrdem(x.regra, x.quantidadeOrigem, x.doses, x.perda);
    if (sobra > 0)
      out.push(
        recusa(
          'sobra-sem-destino',
          `A regra não reaproveita a sobra: lance as ${sobra} dose(s) que sobram como perda (descarte).`,
          ['perda'],
        ),
      );
  }
  if (x.percentualEstabilidade !== null) {
    if (!(x.percentualEstabilidade > 0) || x.percentualEstabilidade > 100)
      out.push(
        recusa('estabilidade-invalida', 'O percentual de estabilidade vai de 0 a 100.', [
          'percentualEstabilidade',
        ]),
      );
    else if (x.percentualEstabilidade > PERCENTUAL_VALIDADE_PADRAO && !x.observacao?.trim())
      out.push(
        recusa(
          'estabilidade-sem-justificativa',
          `Acima de ${PERCENTUAL_VALIDADE_PADRAO}% do prazo remanescente, justifique pelo estudo de estabilidade.`,
          ['observacao'],
        ),
      );
  }
  return out;
}

export interface ValidadeParaCalcular {
  /** AAAA-MM-DDTHH:mm do fracionamento. */
  readonly executadaEm: string;
  /** AAAA-MM-DD da embalagem original. */
  readonly validadeOriginal: string;
  readonly validadeHoras: number | null;
  readonly percentual: number | null;
}

/** A validade da dose (AAAA-MM-DD), a menor entre os limites da RDC 67/2007 e a da regra (nula: já esgotada). */
export function validadeDaDose(v: ValidadeParaCalcular): string | null {
  if (!INSTANTE.test(v.executadaEm) || !DATA.test(v.validadeOriginal)) return null;
  const hoje = v.executadaEm.slice(0, 10);
  if (v.validadeOriginal < hoje) return null;
  const restante = Math.round((diaUtc(v.validadeOriginal) - diaUtc(hoje)) / DIA_MS);
  const pct = v.percentual ?? PERCENTUAL_VALIDADE_PADRAO;
  const limites = [
    v.validadeOriginal,
    somarDias(hoje, Math.floor((restante * pct) / 100)),
    somarDias(hoje, TETO_VALIDADE_DOSE_DIAS),
  ];
  if (v.validadeHoras !== null && v.validadeHoras > 0) {
    const fim = new Date(Date.parse(`${v.executadaEm}:00Z`) + v.validadeHoras * 3_600_000);
    limites.push(fim.toISOString().slice(0, 10));
  }
  return limites.sort()[0] as string;
}

export interface DoseParaRotular {
  readonly identificador: string;
  readonly insumo: string;
  readonly quantidade: number;
  readonly unidade: string;
  readonly loteOrigem: string;
  readonly validadeOriginal: string;
  readonly validadeNova: string;
  /** AAAA-MM-DDTHH:mm */
  readonly fracionadoEm: string;
  readonly farmaceutico: string;
  readonly gtin?: string | null;
}

export interface RotuloDose {
  readonly identificador: string;
  readonly linhas: readonly string[];
  readonly datamatrix: string;
  readonly barras: string;
  readonly legivel: string;
}

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** O rótulo da dose fracionada (RDC 67/2007): o que se imprime e o código que a dispensação lê. */
export function rotuloDaDose(d: DoseParaRotular): RotuloDose {
  const m = montarEtiqueta({
    identificador: d.identificador,
    gtin: d.gtin ?? null,
    lote: d.loteOrigem,
    validade: d.validadeNova,
  });
  return {
    identificador: d.identificador,
    linhas: [
      d.insumo,
      `${qtd3(d.quantidade)} ${d.unidade}`.trim(),
      `Lote de origem ${d.loteOrigem} · val. original ${br(d.validadeOriginal)}`,
      `Fracionado em ${br(d.fracionadoEm.slice(0, 10))} ${d.fracionadoEm.slice(11, 16)} · validade ${br(d.validadeNova)}`,
      `Farm. resp.: ${d.farmaceutico}`,
    ],
    ...m,
  };
}

/** Validade depois da abertura aceita na regra: até um ano em horas. */
export const TETO_VALIDADE_HORAS = 8760;

export interface RegraFracionamentoParaSalvar {
  readonly origem: number;
  readonly resultante: number;
  readonly quantidadeOrigem: number;
  readonly rendimento: number;
  readonly validadeHoras: number | null;
}

/** As recusas do cadastro da regra de fracionamento do insumo. */
export function conferirRegraFracionamento(x: RegraFracionamentoParaSalvar): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (x.origem === x.resultante)
    out.push(
      recusa('insumos-iguais', 'O insumo resultante (a dose) tem de ser outro que o de origem.', [
        'resultante',
      ]),
    );
  if (!(x.quantidadeOrigem > 0))
    out.push(
      recusa('quantidade-origem-invalida', 'A quantidade de origem é maior que zero.', ['quantidadeOrigem']),
    );
  if (!(x.rendimento > 0))
    out.push(recusa('rendimento-invalido', 'O rendimento é maior que zero.', ['rendimento']));
  if (
    x.validadeHoras !== null &&
    (!Number.isInteger(x.validadeHoras) || x.validadeHoras < 1 || x.validadeHoras > TETO_VALIDADE_HORAS)
  )
    out.push(
      recusa(
        'validade-horas-invalida',
        `A validade depois da abertura vai de 1 a ${TETO_VALIDADE_HORAS} horas.`,
        ['validadeHoras'],
      ),
    );
  return out;
}
