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

/** O horizonte máximo de ocorrências geradas de uma vez (a previsão sem fim é estendida por estenderPrevisao). */
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
  /** Gera até esta data (no lugar de 12 meses a partir do início); usado para estender a previsão. */
  readonly ate?: string;
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
  const teto = utc(e.ate ?? e.dataInicio);
  if (e.ate === undefined) teto.setUTCMonth(teto.getUTCMonth() + HORIZONTE_PREVISAO_MESES);
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

/**
 * Estender a previsão sem fim (ou com fim além do que já foi gerado): mais 12 meses depois da última ocorrência, com
 * as mesmas datas que a geração original daria (a sequência continua). Só a previsão ativa e recorrente.
 */
export function estenderPrevisao(
  e: EntradaPrevisao & {
    readonly ativa: boolean;
    readonly ultimaSequencia: number;
    readonly ultimaData: string;
  },
): RecusaFinanceiro | OcorrenciaPrevista[] {
  if (!e.ativa) return recusaFin('previsao-encerrada', 'A previsão está encerrada: não se estende.');
  if (e.periodicidade === 'unica')
    return recusaFin('previsao-unica', 'A previsão única não tem ocorrências adiante.');
  const ate = utc(e.ultimaData);
  ate.setUTCMonth(ate.getUTCMonth() + HORIZONTE_PREVISAO_MESES);
  const todas = gerarOcorrenciasPrevisao({ ...e, ate: iso(ate) });
  if (!Array.isArray(todas)) return todas;
  const novas = todas.filter((o) => o.sequencia > e.ultimaSequencia);
  if (novas.length === 0)
    return recusaFin('sem-ocorrencia-nova', 'A previsão já tem todas as ocorrências até o fim.', ['dataFim']);
  return novas;
}

/** Cancelar uma ocorrência prevista (não vai acontecer): só a aberta, com motivo; a linha fica. */
export function conferirCancelamentoOcorrencia(e: {
  readonly situacao: string;
  readonly motivo: string;
}): RecusaFinanceiro | null {
  if (e.situacao !== 'aberta')
    return recusaFin('previsao-fechada', 'A ocorrência já foi realizada ou cancelada: releia.');
  if (e.motivo.trim().length < 5)
    return recusaFin('motivo-obrigatorio', 'Diga o motivo do cancelamento.', ['motivo']);
  return null;
}

/** Encerrar a previsão numa data: só a ativa, com motivo, data não antes do início; as abertas depois dela caem. */
export function conferirEncerramentoPrevisao(e: {
  readonly ativa: boolean;
  readonly dataInicio: string;
  readonly data: string;
  readonly motivo: string;
}): RecusaFinanceiro | null {
  if (!e.ativa) return recusaFin('previsao-encerrada', 'A previsão já está encerrada.');
  if (e.data < e.dataInicio)
    return recusaFin('periodo-invalido', 'O encerramento não pode ser antes do início da previsão.', [
      'data',
    ]);
  if (e.motivo.trim().length < 5)
    return recusaFin('motivo-obrigatorio', 'Diga o motivo do encerramento.', ['motivo']);
  return null;
}

/** Credor esperado (da previsão ou da provisão) e o do título; nulo quando não foi informado. */
export interface CredorConciliacao {
  readonly fornecedor: number | null;
  readonly profissional: number | null;
}

/**
 * O título que realiza a previsão ou liquida a provisão: não pode já ter sido conciliado com outra previsão ou provisão
 * (o realizado contaria duas vezes) e, quando a previsão ou provisão tem credor, o título é do MESMO credor.
 */
export function conferirTituloConciliacao(e: {
  readonly jaConciliado: boolean;
  readonly esperado: CredorConciliacao;
  readonly titulo: CredorConciliacao;
}): RecusaFinanceiro | null {
  if (e.jaConciliado)
    return recusaFin(
      'titulo-ja-conciliado',
      'O título já realizou outra previsão ou liquidou outra provisão.',
      ['tituloPagar'],
    );
  const difere = (a: number | null, b: number | null) => a !== null && a !== b;
  if (
    difere(e.esperado.fornecedor, e.titulo.fornecedor) ||
    difere(e.esperado.profissional, e.titulo.profissional)
  )
    return recusaFin('credor-diferente', 'O título é de outro credor que não o da previsão ou provisão.', [
      'tituloPagar',
    ]);
  return null;
}

/**
 * O lado do título que realiza a ocorrência: a previsão de despesa se realiza pelo título a pagar e a de receita pelo
 * título a receber; um título só, nunca os dois.
 */
export function conferirLadoRealizacao(e: {
  readonly tipo: string;
  readonly tituloPagar: boolean;
  readonly tituloReceber: boolean;
}): RecusaFinanceiro | null {
  if (e.tituloPagar === e.tituloReceber)
    return recusaFin('titulo-obrigatorio', 'Informe um título: a pagar na despesa, a receber na receita.', [
      e.tipo === 'receita' ? 'tituloReceber' : 'tituloPagar',
    ]);
  if (e.tipo === 'receita' && e.tituloPagar)
    return recusaFin('titulo-de-outro-lado', 'A previsão de receita se realiza pelo título a receber.', [
      'tituloReceber',
    ]);
  if (e.tipo !== 'receita' && e.tituloReceber)
    return recusaFin('titulo-de-outro-lado', 'A previsão de despesa se realiza pelo título a pagar.', [
      'tituloPagar',
    ]);
  return null;
}

/**
 * O título a receber que realiza a previsão de receita: não pode já ter realizado outra ocorrência e, quando a previsão
 * tem fonte pagadora, o título é da MESMA fonte pagadora.
 */
export function conferirTituloReceberConciliacao(e: {
  readonly jaConciliado: boolean;
  readonly fonteEsperada: number | null;
  readonly fonteTitulo: number | null;
}): RecusaFinanceiro | null {
  if (e.jaConciliado)
    return recusaFin('titulo-ja-conciliado', 'O título a receber já realizou outra previsão.', [
      'tituloReceber',
    ]);
  if (e.fonteEsperada !== null && e.fonteEsperada !== e.fonteTitulo)
    return recusaFin('devedor-diferente', 'O título é de outra fonte pagadora que não a da previsão.', [
      'tituloReceber',
    ]);
  return null;
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
 * Liquidar a provisão pelo título que a paga: consome o saldo até o valor do título. Título menor que o saldo: a
 * provisão fica parcial, o previsto conciliado é o valor consumido e a diferença é zero (o resto segue provisionado).
 * Título igual ou maior: a provisão fecha, o previsto é o saldo e a diferença (realizado − previsto) vai à conciliação.
 */
export function liquidarProvisao(
  v: SaldoProvisao,
  valorTitulo: number,
):
  | RecusaFinanceiro
  | (MovimentoProvisao & {
      readonly consumido: number;
      readonly previsto: number;
      readonly diferenca: number;
    }) {
  const saldo = saldoDe(v);
  if (!['provisionada', 'parcial'].includes(v.situacao) || !(saldo > 0))
    return recusaFin('provisao-fechada', 'A provisão já foi liquidada ou revertida: releia.');
  if (!(valorTitulo > 0))
    return recusaFin('titulo-sem-valor', 'O título não tem valor para liquidar a provisão.');
  const consumido = centavos(Math.min(saldo, valorTitulo));
  const fecha = centavos(valorTitulo) >= saldo;
  return {
    ...fechar(v, v.valorBaixado + consumido, v.valorRevertido),
    consumido,
    previsto: consumido,
    diferenca: fecha ? centavos(valorTitulo - saldo) : 0,
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
