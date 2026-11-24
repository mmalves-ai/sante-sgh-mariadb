// F3.8, 07-FIN linha 85: fechamento e reabertura do período financeiro (a competência mensal do estabelecimento) e o
// saldo diário por conta bancária gravado no fechamento. Regra pura, sem banco.
// Desenho: o fechamento é sequencial pelo que existe no banco (os meses abertos antes da competência pedida, desde a
// última fechada ou o primeiro movimento, fecham juntos em cadeia) e só de mês terminado; fechado, todo lançamento com
// data até o fim do último mês fechado é recusado (movimento, baixa, transferência). A reabertura é a exceção: só do
// último mês fechado, pedida com justificativa por um usuário e autorizada (ou recusada) por outro; cada fechamento,
// pedido e decisão vira um evento consultável, e o novo fechamento regrava os saldos daquele mês.
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

/** A competência seguinte (AAAA-MM-01). */
export function proximaCompetencia(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
}

/** O teto de meses fechados de uma vez (a cadeia do primeiro fechamento de um hospital com anos de movimento). */
export const MESES_POR_FECHAMENTO = 120;

/** O que o fechamento conhece do estabelecimento, lido sob a trava do período. */
export interface SituacaoDoFechamento {
  /** A competência pedida (AAAA-MM-01). */
  readonly competencia: string;
  /** O registro dela (nulo: ainda sem registro). */
  readonly atual: PeriodoLido | null;
  readonly hoje: string;
  /** A última competência fechada do estabelecimento (nulo: nenhuma). */
  readonly ultimaFechada: string | null;
  /** A competência do primeiro movimento ou saldo inicial de conta do estabelecimento (nulo: nenhum). */
  readonly primeiraComMovimento: string | null;
}

/**
 * O plano do fechamento: os meses a fechar, em ordem, até a competência pedida. O fechamento segue a ordem dos meses
 * pelo que existe no banco (não só pelos registros do período): os meses entre a última fechada (ou o primeiro mês com
 * movimento, no primeiro fechamento) e a pedida são fechados juntos, em cadeia, cada um com o seu saldo; assim nenhum
 * mês anterior fica aberto atrás de um fechado. Recusa: competência fora do primeiro dia, mês em curso ou futuro, já
 * fechada (ou anterior à última fechada) e cadeia acima do teto.
 */
export function planejarFechamentoPeriodo(
  s: SituacaoDoFechamento,
): { readonly recusa: RecusaFinanceiro } | { readonly competencias: readonly string[] } {
  const comp = s.competencia;
  if (!DATA.test(comp) || comp.slice(8) !== '01')
    return {
      recusa: recusaFin('competencia-invalida', 'Informe a competência pelo primeiro dia do mês.', [
        'competencia',
      ]),
    };
  if (comp >= competenciaDe(s.hoje))
    return {
      recusa: recusaFin(
        'periodo-em-curso',
        'Só se fecha um mês já terminado: o mês de hoje e os seguintes continuam abertos.',
        ['competencia'],
      ),
    };
  if (s.atual?.situacao === 'fechado' || (s.ultimaFechada !== null && comp <= s.ultimaFechada))
    return { recusa: recusaFin('periodo-ja-fechado', 'Esta competência já está fechada.', ['competencia']) };
  const inicio =
    s.ultimaFechada !== null
      ? proximaCompetencia(s.ultimaFechada)
      : s.primeiraComMovimento !== null && s.primeiraComMovimento < comp
        ? s.primeiraComMovimento
        : comp;
  const competencias: string[] = [];
  for (let c = inicio; c <= comp; c = proximaCompetencia(c)) {
    competencias.push(c);
    if (competencias.length > MESES_POR_FECHAMENTO) {
      const limite = competencias[MESES_POR_FECHAMENTO - 1] as string;
      return {
        recusa: recusaFin(
          'periodo-cadeia-longa',
          `Há mais de ${MESES_POR_FECHAMENTO} meses abertos antes desta competência: feche antes até ${limite.slice(5, 7)}/${limite.slice(0, 4)}.`,
          ['competencia'],
        ),
      };
    }
  }
  return { competencias };
}

/** A justificativa da reabertura conferida (aparada, com o mínimo de letras). */
function conferirJustificativa(justificativa: string): RecusaFinanceiro | null {
  return justificativa.trim().length < JUSTIFICATIVA_REABERTURA_MINIMA
    ? recusaFin(
        'justificativa-obrigatoria',
        `Diga por que a competência é reaberta (ao menos ${JUSTIFICATIVA_REABERTURA_MINIMA} letras).`,
        ['justificativa'],
      )
    : null;
}

/**
 * Confere o pedido de reabertura: só a competência fechada, só a última fechada (os posteriores ainda abertos), com
 * justificativa e sem outro pedido à espera de decisão.
 */
export function conferirPedidoReabertura(
  atual: PeriodoLido | null,
  posterioresFechadas: readonly string[],
  justificativa: string,
  pedidoPendente: boolean,
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
  if (pedidoPendente)
    return recusaFin(
      'pedido-reabertura-pendente',
      'Já há um pedido de reabertura desta competência à espera da autorização.',
      ['competencia'],
    );
  return conferirJustificativa(justificativa);
}

/**
 * Confere a decisão sobre o pedido de reabertura (autorizar ou recusar): a competência continua fechada e sem posterior
 * fechado, há um pedido pendente, e quem decide não é quem pediu (segregação: um pede, outro autoriza).
 */
export function conferirDecisaoReabertura(d: {
  readonly atual: PeriodoLido | null;
  readonly posterioresFechadas: readonly string[];
  readonly solicitante: number | null;
  readonly decisor: number;
}): RecusaFinanceiro | null {
  if (!d.atual || d.atual.situacao !== 'fechado')
    return recusaFin('periodo-nao-fechado', 'Só se reabre uma competência fechada.', ['competencia']);
  if (d.posterioresFechadas.some((c) => c > (d.atual as PeriodoLido).competencia))
    return recusaFin(
      'periodo-posterior-fechado',
      'Só o último mês fechado pode ser reaberto: há competência posterior fechada.',
      ['competencia'],
    );
  if (d.solicitante === null)
    return recusaFin(
      'sem-pedido-reabertura',
      'Não há pedido de reabertura desta competência: a reabertura começa pelo pedido, com a justificativa.',
      ['competencia'],
    );
  if (d.solicitante === d.decisor)
    return recusaFin(
      'autorizador-igual-solicitante',
      'Quem pediu a reabertura não a autoriza: outro usuário com a permissão decide.',
      ['competencia'],
    );
  return null;
}

/**
 * Confere um lançamento datado: a data não pode cair em mês fechado. A trava vale para toda data até o fim da última
 * competência fechada do estabelecimento (os meses anteriores a ela também estão fechados, pela cadeia do fechamento).
 */
export function conferirLancamentoNoPeriodo(
  data: string,
  ultimaFechada: string | null,
  campo = 'data',
): RecusaFinanceiro | null {
  if (ultimaFechada === null || data > fimDaCompetencia(ultimaFechada)) return null;
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
