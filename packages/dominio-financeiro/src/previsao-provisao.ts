// F8, 07-FIN linha 68: previsão de pagamentos (despesa ou receita esperada, ainda sem título) e provisão de passivo
// (honorário, tributo, férias: o valor devido reconhecido na competência, antes do título). Regra pura.
// Desenho: a previsão gera as ocorrências na hora (até o fim ou 12 meses à frente), com a data esperada ajustada ao
// dia útil; quando o título chega, a ocorrência é realizada por ele e a diferença previsto × realizado fica gravada.
// A provisão nasce com o saldo igual ao valor; o título que a liquida e a reversão (parcial ou total, com motivo) baixam
// o saldo; nada se apaga, e o saldo nunca fica negativo.
import { type RecusaFinanceiro, recusaFin } from '@sgh/contratos/regras-financeiro';

export const PERIODICIDADES = [
  'unica',
  'semanal',
  'quinzenal',
  'mensal',
  'bimestral',
  'trimestral',
  'semestral',
  'anual',
] as const;
export type Periodicidade = (typeof PERIODICIDADES)[number];
export type AjusteDiaNaoUtil = 'antecipar' | 'postergar' | 'manter';

/** O horizonte máximo de ocorrências geradas de uma vez (a previsão sem fim é renovada adiante). */
export const HORIZONTE_PREVISAO_MESES = 12;

const centavos = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => {
  const [a, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d));
};
const MESES: Partial<Record<Periodicidade, number>> = {
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};
const DIAS: Partial<Record<Periodicidade, number>> = { semanal: 7, quinzenal: 14 };

/** Ajusta a data ao dia útil (sábado e domingo; feriado fica com o calendário do estabelecimento). */
export function ajustarDiaUtil(data: string, ajuste: AjusteDiaNaoUtil): string {
  if (ajuste === 'manter') return data;
  const d = utc(data);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
    d.setUTCDate(d.getUTCDate() + (ajuste === 'postergar' ? 1 : -1));
  return iso(d);
}

export interface OcorrenciaPrevista {
  readonly sequencia: number;
  readonly competencia: string;
  readonly dataEsperada: string;
  readonly valor: number;
}

export interface EntradaPrevisao {
  readonly periodicidade: Periodicidade;
  readonly dataInicio: string;
  readonly dataFim: string | null;
  readonly diaVencimento: number | null;
  readonly valor: number;
  readonly ajuste: AjusteDiaNaoUtil;
}

/** Confere a previsão e gera as ocorrências. */
export function gerarOcorrenciasPrevisao(e: EntradaPrevisao): RecusaFinanceiro | OcorrenciaPrevista[] {
  if (!(e.valor > 0))
    return recusaFin('valor-invalido', 'O valor previsto tem de ser maior que zero.', ['valor']);
  if (e.dataFim !== null && e.dataFim < e.dataInicio)
    return recusaFin('periodo-invalido', 'O fim da previsão não pode ser antes do início.', ['dataFim']);
  if (e.diaVencimento !== null && (e.diaVencimento < 1 || e.diaVencimento > 31))
    return recusaFin('dia-invalido', 'O dia do vencimento vai de 1 a 31.', ['diaVencimento']);
  const inicio = utc(e.dataInicio);
  const teto = utc(e.dataInicio);
  teto.setUTCMonth(teto.getUTCMonth() + HORIZONTE_PREVISAO_MESES);
  const limite = e.dataFim !== null && utc(e.dataFim) < teto ? utc(e.dataFim) : teto;
  const datas: Date[] = [];
  if (e.periodicidade === 'unica') datas.push(inicio);
  else if (DIAS[e.periodicidade]) {
    for (let d = new Date(inicio); d <= limite; d.setUTCDate(d.getUTCDate() + DIAS[e.periodicidade]!))
      datas.push(new Date(d));
  } else {
    const passo = MESES[e.periodicidade]!;
    for (let i = 0; ; i += passo) {
      const a = inicio.getUTCFullYear();
      const m = inicio.getUTCMonth() + i;
      const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
      const dia = Math.min(e.diaVencimento ?? inicio.getUTCDate(), ultimo);
      const d = new Date(Date.UTC(a, m, dia));
      if (d > limite) break;
      if (d >= inicio) datas.push(d);
    }
  }
  if (datas.length === 0)
    return recusaFin('sem-ocorrencia', 'O período não tem nenhuma ocorrência: confira o dia e as datas.', [
      'dataInicio',
    ]);
  return datas.map((d, i) => {
    const data = iso(d);
    return {
      sequencia: i + 1,
      competencia: `${data.slice(0, 7)}-01`,
      dataEsperada: ajustarDiaUtil(data, e.ajuste),
      valor: centavos(e.valor),
    };
  });
}

/** Realizar a ocorrência pelo título: só a aberta; a diferença é realizado menos previsto. */
export function conciliarPrevistoRealizado(e: {
  readonly situacao: string;
  readonly previsto: number;
  readonly realizado: number;
}): RecusaFinanceiro | { readonly diferenca: number } {
  if (e.situacao !== 'aberta')
    return recusaFin('previsao-fechada', 'A ocorrência já foi realizada ou cancelada: releia.');
  if (!(e.realizado > 0))
    return recusaFin('titulo-sem-valor', 'O título não tem valor para realizar a previsão.');
  return { diferenca: centavos(e.realizado - e.previsto) };
}

export const TIPOS_PROVISAO = [
  'honorario_medico',
  'tributo',
  'imposto_retido',
  'ferias',
  'decimo_terceiro',
  'contingencia',
  'outro',
] as const;
export type TipoProvisao = (typeof TIPOS_PROVISAO)[number];

export interface SaldoProvisao {
  readonly valorProvisionado: number;
  readonly valorBaixado: number;
  readonly valorRevertido: number;
  readonly situacao: string;
}

export interface MovimentoProvisao {
  readonly valorBaixado: number;
  readonly valorRevertido: number;
  readonly saldo: number;
  readonly situacao: 'provisionada' | 'parcial' | 'liquidada' | 'revertida';
}

function fechar(v: SaldoProvisao, baixado: number, revertido: number): MovimentoProvisao {
  const saldo = centavos(v.valorProvisionado - baixado - revertido);
  const situacao =
    saldo > 0
      ? baixado > 0 || revertido > 0
        ? 'parcial'
        : 'provisionada'
      : baixado > 0
        ? 'liquidada'
        : 'revertida';
  return { valorBaixado: centavos(baixado), valorRevertido: centavos(revertido), saldo, situacao };
}

const saldoDe = (v: SaldoProvisao) => centavos(v.valorProvisionado - v.valorBaixado - v.valorRevertido);

/**
 * Liquidar a provisão pelo título que a paga: consome o saldo até o valor do título. Título maior que o saldo: a
 * provisão fica liquidada e a diferença (realizado − previsto) vai à conciliação.
 */
export function liquidarProvisao(
  v: SaldoProvisao,
  valorTitulo: number,
): RecusaFinanceiro | (MovimentoProvisao & { readonly consumido: number; readonly diferenca: number }) {
  const saldo = saldoDe(v);
  if (!['provisionada', 'parcial'].includes(v.situacao) || !(saldo > 0))
    return recusaFin('provisao-fechada', 'A provisão já foi liquidada ou revertida: releia.');
  if (!(valorTitulo > 0))
    return recusaFin('titulo-sem-valor', 'O título não tem valor para liquidar a provisão.');
  const consumido = Math.min(saldo, valorTitulo);
  return {
    ...fechar(v, v.valorBaixado + consumido, v.valorRevertido),
    consumido,
    diferenca: centavos(valorTitulo - saldo),
  };
}

/** Reverter (parcial ou total) com motivo: nunca mais que o saldo. */
export function reverterProvisao(
  v: SaldoProvisao,
  valor: number,
  motivo: string,
): RecusaFinanceiro | MovimentoProvisao {
  const saldo = saldoDe(v);
  if (!['provisionada', 'parcial'].includes(v.situacao) || !(saldo > 0))
    return recusaFin('provisao-fechada', 'A provisão já foi liquidada ou revertida: releia.');
  if (motivo.trim().length < 5)
    return recusaFin('motivo-obrigatorio', 'Diga o motivo da reversão.', ['motivo']);
  if (!(valor > 0) || centavos(valor) > saldo)
    return recusaFin('valor-acima-do-saldo', `A reversão vai de 0,01 até o saldo (${saldo.toFixed(2)}).`, [
      'valor',
    ]);
  return fechar(v, v.valorBaixado, v.valorRevertido + valor);
}
