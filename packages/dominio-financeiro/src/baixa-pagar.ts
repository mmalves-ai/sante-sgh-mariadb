// F3.8, 07-FIN linha 63: a baixa do título a pagar com valor informado. O pagador diz quanto saiu da conta e, quando
// houver, o desconto obtido e os juros, a multa e os outros acréscimos cobrados pelo credor; a regra tira daí quanto do
// saldo da parcela foi liquidado (o principal) e o que sobra em aberto. Sem valor informado, a baixa quita o saldo.
// A conta é uma só: desembolso = principal + juros + multa + acréscimo − desconto. Regra pura, em centavos.
import { type RecusaFinanceiro, recusaFin } from '@sgh/contratos/regras-financeiro';

export interface EntradaBaixaPagar {
  /** Saldo em aberto da parcela antes da baixa. */
  readonly saldo: number;
  /** Quanto saiu da conta nesta baixa; nulo quita o saldo (com o desconto e os acréscimos informados). */
  readonly valorPago: number | null;
  readonly desconto: number;
  readonly juros: number;
  readonly multa: number;
  readonly acrescimo: number;
}

export interface BaixaPagarCalculada {
  /** Parte do saldo da parcela liquidada por esta baixa (o desconto conta como liquidado). */
  readonly principal: number;
  readonly desconto: number;
  readonly juros: number;
  readonly multa: number;
  readonly acrescimo: number;
  /** O que sai da conta. */
  readonly desembolso: number;
  /** O saldo que fica em aberto na parcela. */
  readonly saldo: number;
  readonly quita: boolean;
}

const c = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const valido = (n: number): boolean => Number.isFinite(n) && n >= 0;

/** A baixa calculada (sem conferir): use depois de `conferirBaixaPagar` devolver nulo. */
export function calcularBaixaPagar(e: EntradaBaixaPagar): BaixaPagarCalculada {
  const desconto = c(e.desconto);
  const juros = c(e.juros);
  const multa = c(e.multa);
  const acrescimo = c(e.acrescimo);
  const encargos = c(juros + multa + acrescimo);
  const desembolso = e.valorPago === null ? c(e.saldo + encargos - desconto) : c(e.valorPago);
  const principal = c(desembolso + desconto - encargos);
  const saldo = c(e.saldo - principal);
  return { principal, desconto, juros, multa, acrescimo, desembolso, saldo, quita: saldo === 0 };
}

/**
 * Confere a baixa: a parcela tem saldo; nenhum valor negativo; sai dinheiro da conta (desconto que zera o desembolso é
 * abatimento, não pagamento); o valor pago cobre pelo menos os juros, a multa e o acréscimo informados (senão nada do
 * título foi liquidado); e o liquidado não passa do saldo (pagar a mais é adiantamento, não baixa).
 */
export function conferirBaixaPagar(e: EntradaBaixaPagar): RecusaFinanceiro | null {
  if (!(e.saldo > 0)) return recusaFin('titulo-ja-baixado', 'A parcela não tem saldo em aberto: releia.');
  for (const campo of ['desconto', 'juros', 'multa', 'acrescimo'] as const)
    if (!valido(e[campo]))
      return recusaFin('valor-invalido', 'Desconto, juros, multa e acréscimo não podem ser negativos.', [
        campo,
      ]);
  if (e.valorPago !== null && !(Number.isFinite(e.valorPago) && e.valorPago > 0))
    return recusaFin('valor-invalido', 'Informe o valor pago, maior que zero.', ['valorPago']);
  const b = calcularBaixaPagar(e);
  if (!(b.desembolso > 0))
    return recusaFin(
      'desconto-acima-do-valor',
      'O desconto cobre o valor inteiro: nada sairia da conta. Desconto total é abatimento do título, não pagamento.',
      ['desconto'],
    );
  if (!(b.principal > 0))
    return recusaFin(
      'pagamento-so-de-encargos',
      'O valor pago não cobre os juros, a multa e o acréscimo informados: nada do título seria liquidado.',
      ['valorPago'],
    );
  if (b.saldo < 0)
    return recusaFin(
      'valor-acima-do-saldo',
      'O valor liquidado passa do saldo da parcela: confira o valor pago, o desconto e os acréscimos.',
      ['valorPago'],
    );
  return null;
}
