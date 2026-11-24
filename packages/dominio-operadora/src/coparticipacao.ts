// F7 (08-SGO linha 98): a coparticipação do evento com os tetos da regra (por evento, no mês e no ano do beneficiário).
// A regra vale pela vigência; a do contrato prevalece sobre a do plano (a escolha é da porta). O teto mensal e o anual
// contam o que já foi lançado ao beneficiário na competência e no ano dela, para o beneficiário nunca pagar acima do
// limite contratado (RN 433: o fator moderador não pode impedir o acesso ao serviço).
import { centavos, valorCoparticipacao } from './cobranca.js';

export interface RegraCoparticipacaoComTetos {
  /** 1 nenhuma, 2 percentual, 3 valor fixo. */
  readonly tipo: number;
  readonly valor: number | null;
  readonly tetoEvento?: number | null;
  readonly tetoMensal?: number | null;
  readonly tetoAnual?: number | null;
}

/** O que o beneficiário já pagou de coparticipação na competência (mês) e no ano dela. */
export interface AcumuladoCoparticipacao {
  readonly mes: number;
  readonly ano: number;
}

export type LimiteCoparticipacao = 'evento' | 'mensal' | 'anual';

export interface CalculoCoparticipacao {
  /** Valor pela regra, antes dos tetos (null: sem coparticipação). */
  readonly calculado: number | null;
  /** Valor a lançar depois dos tetos (null: sem coparticipação). */
  readonly valor: number | null;
  /** O teto que reduziu o valor (o último que agiu), ou null. */
  readonly limitadoPor: LimiteCoparticipacao | null;
}

export type ProblemaCoparticipacao =
  | 'produto-sem-coparticipacao'
  | 'coparticipacao-zero'
  | 'coparticipacao-teto-atingido'
  | 'coparticipacao-teto-invalido';

/** Os tetos aceitos: nulos ou maiores que zero, e o do evento não acima do mensal nem o mensal acima do anual. */
export function problemasDosTetos(r: RegraCoparticipacaoComTetos): ProblemaCoparticipacao[] {
  const t = [r.tetoEvento, r.tetoMensal, r.tetoAnual];
  if (t.some((v) => v !== null && v !== undefined && !(v > 0))) return ['coparticipacao-teto-invalido'];
  const [e, m, a] = t;
  const acima = (x?: number | null, y?: number | null) => x != null && y != null && x > y;
  return acima(e, m) || acima(m, a) || acima(e, a) ? ['coparticipacao-teto-invalido'] : [];
}

/** A coparticipação do evento: o valor da regra limitado ao teto por evento e ao que falta do teto do mês e do ano. */
export function calcularCoparticipacao(
  regra: RegraCoparticipacaoComTetos,
  valorEvento: number,
  acumulado: AcumuladoCoparticipacao,
): CalculoCoparticipacao {
  const calculado = valorCoparticipacao(regra, valorEvento);
  if (calculado === null) return { calculado: null, valor: null, limitadoPor: null };
  let valor = calculado;
  let limitadoPor: LimiteCoparticipacao | null = null;
  const limites: [LimiteCoparticipacao, number | null | undefined, number][] = [
    ['evento', regra.tetoEvento, 0],
    ['mensal', regra.tetoMensal, acumulado.mes],
    ['anual', regra.tetoAnual, acumulado.ano],
  ];
  for (const [nome, teto, usado] of limites) {
    if (teto === null || teto === undefined) continue;
    const resta = Math.max(0, centavos(teto - usado));
    if (valor > resta) {
      valor = resta;
      limitadoPor = nome;
    }
  }
  return { calculado, valor: centavos(valor), limitadoPor };
}

/** As recusas do lançamento: sem regra, valor zero pela regra ou teto já atingido. */
export function problemasDaCoparticipacao(c: CalculoCoparticipacao): ProblemaCoparticipacao[] {
  if (c.valor === null) return ['produto-sem-coparticipacao'];
  if (c.calculado !== null && c.calculado <= 0) return ['coparticipacao-zero'];
  return c.valor <= 0 ? ['coparticipacao-teto-atingido'] : [];
}
