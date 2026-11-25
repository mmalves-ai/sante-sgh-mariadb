// F3.8, 07-FIN linha 63: a prévia da baixa do título a pagar na tela (sem rede nem estado). O pagador informa quanto
// saiu da conta e, quando houver, o desconto, os juros, a multa e o acréscimo; a prévia mostra na hora quanto do saldo
// é liquidado e quanto fica em aberto. Em branco, a baixa quita o saldo. O servidor confere de novo (regra no domínio).
export interface CamposBaixa {
  valorPago: string | number;
  desconto: string | number;
  juros: string | number;
  multa: string | number;
  acrescimo: string | number;
}

export const camposBaixaVazios = (): CamposBaixa => ({
  valorPago: '',
  desconto: '',
  juros: '',
  multa: '',
  acrescimo: '',
});

export type AvisoBaixa = 'valorInvalido' | 'descontoTotal' | 'soEncargos' | 'acimaDoSaldo';

export interface PreviaBaixa {
  /** O que sai da conta. */
  readonly desembolso: number;
  /** Quanto do saldo da parcela é liquidado (o desconto conta). */
  readonly liquida: number;
  /** O saldo que fica em aberto. */
  readonly resta: number;
  readonly aviso: AvisoBaixa | null;
  /** Só os campos preenchidos, como o servidor espera (vazio: quita o saldo). */
  readonly corpo: Partial<Record<keyof CamposBaixa, number>>;
}

const c = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const lido = (v: string | number): number | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? c(n) : Number.NaN;
};

export function previaBaixa(saldo: number, campos: CamposBaixa): PreviaBaixa {
  const corpo: Partial<Record<keyof CamposBaixa, number>> = {};
  let invalido = false;
  for (const k of ['valorPago', 'desconto', 'juros', 'multa', 'acrescimo'] as const) {
    const n = lido(campos[k]);
    if (n === null) continue;
    if (Number.isNaN(n) || n < 0 || (k === 'valorPago' && n === 0)) invalido = true;
    else if (n > 0) corpo[k] = n;
  }
  const desconto = corpo.desconto ?? 0;
  const encargos = c((corpo.juros ?? 0) + (corpo.multa ?? 0) + (corpo.acrescimo ?? 0));
  const desembolso = corpo.valorPago ?? c(saldo + encargos - desconto);
  const liquida = c(desembolso + desconto - encargos);
  const resta = c(saldo - liquida);
  const aviso: AvisoBaixa | null = invalido
    ? 'valorInvalido'
    : !(desembolso > 0)
      ? 'descontoTotal'
      : !(liquida > 0)
        ? 'soEncargos'
        : resta < 0
          ? 'acimaDoSaldo'
          : null;
  return { desembolso, liquida, resta, aviso, corpo };
}
