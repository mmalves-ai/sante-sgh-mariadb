// F3.8, 07-FIN linha 85: fechamento e reabertura do período financeiro (a competência mensal do estabelecimento) e o
// saldo diário por conta bancária gravado no fechamento. Regra pura, sem banco.
// Desenho: o fechamento é sequencial (não fecha um mês com outro anterior ainda aberto) e só de mês terminado; fechado,
// o período recusa todo lançamento com data dentro dele (movimento, baixa, transferência). A reabertura é a exceção:
// só do último mês fechado, com justificativa e pela permissão de quem autoriza; o fechamento anterior fica no registro
// (quando, quem e quantos movimentos), e o novo fechamento regrava os saldos daquele mês.
import { type RecusaFinanceiro, recusaFin } from '@sgh/contratos/regras-financeiro';

export type SituacaoPeriodo = 'aberto' | 'fechado' | 'reaberto';

/** A justificativa mínima da reabertura: o motivo tem de ficar claro no registro (não só "erro"). */
export const JUSTIFICATIVA_REABERTURA_MINIMA = 15;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** A competência (primeiro dia do mês) de uma data AAAA-MM-DD. */
export const competenciaDe = (data: string): string => `${data.slice(0, 7)}-01`;

/** O último dia do mês da competência (AAAA-MM-DD). */
export function fimDaCompetencia(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** O período como lido do banco (nulo: a competência ainda não tem registro, vale como aberta). */
export interface PeriodoLido {
  readonly competencia: string;
  readonly situacao: SituacaoPeriodo;
}

/**
 * Confere o fechamento: competência no formato do primeiro dia do mês, mês já terminado (antes do mês de hoje), ainda
 * não fechado, e nenhuma competência anterior registrada e não fechada (o fechamento segue a ordem dos meses).
 */
export function conferirFechamentoPeriodo(
  competencia: string,
  atual: PeriodoLido | null,
  hoje: string,
  anterioresNaoFechadas: readonly string[],
): RecusaFinanceiro | null {
  if (!DATA.test(competencia) || competencia.slice(8) !== '01')
    return recusaFin('competencia-invalida', 'Informe a competência pelo primeiro dia do mês.', [
      'competencia',
    ]);
  if (competencia >= competenciaDe(hoje))
    return recusaFin(
      'periodo-em-curso',
      'Só se fecha um mês já terminado: o mês de hoje e os seguintes continuam abertos.',
      ['competencia'],
    );
  if (atual?.situacao === 'fechado')
    return recusaFin('periodo-ja-fechado', 'Esta competência já está fechada.', ['competencia']);
  const pendente = [...anterioresNaoFechadas].filter((c) => c < competencia).sort()[0];
  if (pendente)
    return recusaFin(
      'periodo-anterior-aberto',
      `Feche antes a competência ${pendente.slice(5, 7)}/${pendente.slice(0, 4)}: o fechamento segue a ordem dos meses.`,
      ['competencia'],
    );
  return null;
}

/**
 * Confere a reabertura: só o período fechado, só o último fechado (os posteriores ainda abertos) e com justificativa.
 */
export function conferirReaberturaPeriodo(
  atual: PeriodoLido | null,
  posterioresFechadas: readonly string[],
  justificativa: string,
): RecusaFinanceiro | null {
  if (!atual || atual.situacao !== 'fechado')
    return recusaFin('periodo-nao-fechado', 'Só se reabre uma competência fechada.', ['competencia']);
  const depois = posterioresFechadas.filter((c) => c > atual.competencia).sort();
  if (depois.length > 0) {
    const ultimo = depois[depois.length - 1] as string;
    return recusaFin(
      'periodo-posterior-fechado',
      `Reabra antes a competência ${ultimo.slice(5, 7)}/${ultimo.slice(0, 4)}: só o último mês fechado pode ser reaberto.`,
      ['competencia'],
    );
  }
  if (justificativa.trim().length < JUSTIFICATIVA_REABERTURA_MINIMA)
    return recusaFin(
      'justificativa-obrigatoria',
      `Diga por que a competência é reaberta (ao menos ${JUSTIFICATIVA_REABERTURA_MINIMA} letras).`,
      ['justificativa'],
    );
  return null;
}

/** Confere um lançamento datado: a competência da data não pode estar fechada (o retroativo fica travado). */
export function conferirLancamentoNoPeriodo(
  data: string,
  situacaoDaCompetencia: SituacaoPeriodo | null,
  campo = 'data',
): RecusaFinanceiro | null {
  if (situacaoDaCompetencia !== 'fechado') return null;
  const c = competenciaDe(data);
  return recusaFin(
    'periodo-fechado',
    `A competência ${c.slice(5, 7)}/${c.slice(0, 4)} está fechada: lance numa data de período aberto ou peça a reabertura.`,
    [campo],
  );
}

/** Um movimento da conta para o saldo: crédito entra, débito sai. */
export interface MovimentoDoSaldo {
  readonly data: string;
  readonly natureza: 'credito' | 'debito';
  readonly valor: number;
}

export interface SaldoDoDia {
  readonly data: string;
  readonly saldoAnterior: number;
  readonly entradas: number;
  readonly saidas: number;
  readonly saldoFinal: number;
}

const c = (v: number) => Math.round(v * 100);
const r = (v: number) => v / 100;

/**
 * Os saldos diários de uma conta no período: um dia por data com movimento, em ordem, encadeados a partir do saldo de
 * abertura (o saldo final de um dia é o anterior do próximo). Conta em centavos, sem erro de arredondamento.
 */
export function calcularSaldosDiarios(
  saldoAbertura: number,
  movimentos: readonly MovimentoDoSaldo[],
): SaldoDoDia[] {
  const porDia = new Map<string, { e: number; s: number }>();
  for (const m of movimentos) {
    const d = porDia.get(m.data) ?? { e: 0, s: 0 };
    if (m.natureza === 'credito') d.e += c(m.valor);
    else d.s += c(m.valor);
    porDia.set(m.data, d);
  }
  let saldo = c(saldoAbertura);
  return [...porDia.keys()].sort().map((data) => {
    const d = porDia.get(data) as { e: number; s: number };
    const anterior = saldo;
    saldo = anterior + d.e - d.s;
    return { data, saldoAnterior: r(anterior), entradas: r(d.e), saidas: r(d.s), saldoFinal: r(saldo) };
  });
}

/** O resumo da conta no período (saldo inicial, entradas, saídas e final), conferido contra os dias. */
export function resumoDoPeriodo(
  saldoAbertura: number,
  dias: readonly SaldoDoDia[],
): { saldoInicial: number; entradas: number; saidas: number; saldoFinal: number } {
  const e = dias.reduce((s, d) => s + c(d.entradas), 0);
  const s = dias.reduce((t, d) => t + c(d.saidas), 0);
  return {
    saldoInicial: saldoAbertura,
    entradas: r(e),
    saidas: r(s),
    saldoFinal: r(c(saldoAbertura) + e - s),
  };
}
