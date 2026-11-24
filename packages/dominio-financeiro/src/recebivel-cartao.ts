// F3.8, 07-FIN linha 89: recebimento em cartão de débito e crédito. Regra pura, sem banco.
// Desenho: quem recebe escolhe só a administradora, a bandeira, a modalidade e o número de parcelas; a taxa vigente
// (por bandeira e faixa de parcelas, com vigência) é achada sozinha e as parcelas a receber da administradora saem
// já líquidas da taxa e com a data prevista do crédito, prontas para o fluxo de caixa e para a baixa na conciliação.
// Dinheiro em centavos inteiros: a soma das parcelas brutas fecha com o valor recebido e a soma das taxas fecha com a
// taxa total (o resto do arredondamento vai à primeira parcela).
import { recusaFin, type RecusaFinanceiro, somarDias } from '@sgh/contratos/regras-financeiro';

export type ModalidadeCartao = 'debito' | 'credito' | 'pre_pago' | 'voucher';

/** Uma linha da tabela de taxas da administradora (cadastro com vigência). */
export interface TaxaAdministradora {
  readonly id: number;
  readonly administradora: number;
  /** Nula: vale para todas as bandeiras da administradora. */
  readonly bandeira: number | null;
  readonly modalidade: ModalidadeCartao;
  readonly parcelaInicial: number;
  readonly parcelaFinal: number;
  readonly tipo: 'percentual' | 'valor';
  /** Percentual sobre o valor bruto (0 a 100), quando o tipo é percentual. */
  readonly percentual: number | null;
  /** Valor fixo por transação, em reais, quando o tipo é valor. */
  readonly valor: number | null;
  /** Dias entre a venda e o crédito da primeira parcela. */
  readonly diasRepasse: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

export interface PedidoTaxa {
  readonly administradora: number;
  readonly bandeira: number;
  readonly modalidade: ModalidadeCartao;
  readonly parcelas: number;
  /** A data da venda (AAAA-MM-DD). */
  readonly data: string;
}

/** O teto de parcelas aceito num recebimento em cartão. */
export const PARCELAS_CARTAO_MAXIMO = 24;

/** Intervalo entre os créditos das parcelas do crédito parcelado, em dias. */
export const INTERVALO_PARCELA_DIAS = 30;

const vigente = (t: TaxaAdministradora, data: string): boolean =>
  t.ativo && t.vigenciaInicio <= data && (t.vigenciaFim === null || t.vigenciaFim >= data);

/**
 * A taxa vigente para a venda: a da bandeira vence a geral da administradora; entre as que servem, a de vigência mais
 * recente. Sem taxa cadastrada a venda é recusada (o recebível sem taxa daria o fluxo de caixa errado).
 */
export function escolherTaxa(
  taxas: readonly TaxaAdministradora[],
  p: PedidoTaxa,
): { taxa: TaxaAdministradora } | { recusa: RecusaFinanceiro } {
  const recusa = conferirParcelas(p.modalidade, p.parcelas);
  if (recusa) return { recusa };
  const servem = taxas.filter(
    (t) =>
      t.administradora === p.administradora &&
      t.modalidade === p.modalidade &&
      (t.bandeira === null || t.bandeira === p.bandeira) &&
      t.parcelaInicial <= p.parcelas &&
      t.parcelaFinal >= p.parcelas &&
      vigente(t, p.data),
  );
  if (servem.length === 0)
    return {
      recusa: recusaFin(
        'taxa-cartao-ausente',
        `Não há taxa vigente da administradora para ${p.modalidade} em ${p.parcelas}x nesta bandeira em ${p.data}.`,
        ['administradora', 'bandeira', 'parcelas'],
      ),
    };
  const ordenadas = [...servem].sort(
    (a, b) =>
      Number(b.bandeira !== null) - Number(a.bandeira !== null) ||
      b.vigenciaInicio.localeCompare(a.vigenciaInicio) ||
      b.parcelaInicial - a.parcelaInicial,
  );
  return { taxa: ordenadas[0] as TaxaAdministradora };
}

/** Débito, pré-pago e voucher são à vista; o crédito aceita de 1 ao teto de parcelas. */
export function conferirParcelas(modalidade: ModalidadeCartao, parcelas: number): RecusaFinanceiro | null {
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > PARCELAS_CARTAO_MAXIMO)
    return recusaFin(
      'parcelas-cartao-invalidas',
      `O número de parcelas vai de 1 a ${PARCELAS_CARTAO_MAXIMO}.`,
      ['parcelas'],
    );
  if (modalidade !== 'credito' && parcelas !== 1)
    return recusaFin(
      'parcelas-cartao-a-vista',
      'Débito, pré-pago e voucher são recebidos em parcela única.',
      ['parcelas'],
    );
  return null;
}

/** Uma parcela a receber da administradora. Valores em reais, já fechados em centavos. */
export interface ParcelaRecebivel {
  readonly sequencia: number;
  readonly dataPrevista: string;
  readonly bruto: number;
  readonly percentualTaxa: number;
  readonly taxa: number;
  readonly liquido: number;
}

const emCentavos = (reais: number): number => Math.round((reais + Number.EPSILON) * 100);

/** Reparte um total em centavos em n partes; o resto vai à primeira. */
function repartir(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const partes = Array.from({ length: n }, () => base);
  partes[0] = (partes[0] as number) + (total - base * n);
  return partes;
}

/**
 * As parcelas a receber da administradora: bruto repartido, taxa aplicada (percentual sobre o bruto da venda ou valor
 * fixo por transação), líquido de cada uma e a data prevista (venda + dias de repasse; no crédito parcelado, mais 30
 * dias por parcela). A taxa nunca passa do bruto.
 */
export function gerarParcelasRecebivel(p: {
  readonly valor: number;
  readonly parcelas: number;
  readonly dataVenda: string;
  readonly taxa: TaxaAdministradora;
}): { parcelas: ParcelaRecebivel[] } | { recusa: RecusaFinanceiro } {
  const recusa = conferirParcelas(p.taxa.modalidade, p.parcelas);
  if (recusa) return { recusa };
  const bruto = emCentavos(p.valor);
  if (bruto <= 0)
    return {
      recusa: recusaFin('valor-cartao-invalido', 'O valor recebido em cartão tem de ser positivo.', [
        'valor',
      ]),
    };
  const taxaTotal =
    p.taxa.tipo === 'percentual'
      ? Math.round((bruto * (p.taxa.percentual ?? 0)) / 100)
      : emCentavos(p.taxa.valor ?? 0);
  if (taxaTotal < 0 || taxaTotal > bruto)
    return {
      recusa: recusaFin('taxa-cartao-maior-que-valor', 'A taxa da administradora passa do valor recebido.', [
        'valor',
      ]),
    };
  const brutos = repartir(bruto, p.parcelas);
  const taxas = repartir(taxaTotal, p.parcelas);
  const percentual = Math.round((taxaTotal / bruto) * 1_000_000) / 10_000;
  return {
    parcelas: brutos.map((b, i) => {
      const t = taxas[i] as number;
      return {
        sequencia: i + 1,
        dataPrevista: somarDias(p.dataVenda, p.taxa.diasRepasse + i * INTERVALO_PARCELA_DIAS),
        bruto: b / 100,
        percentualTaxa: percentual,
        taxa: t / 100,
        liquido: (b - t) / 100,
      };
    }),
  };
}
