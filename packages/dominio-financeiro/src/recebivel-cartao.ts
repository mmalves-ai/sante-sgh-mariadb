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
  const recusa = conferirParcelasCartao(p.modalidade, p.parcelas);
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
export function conferirParcelasCartao(
  modalidade: ModalidadeCartao,
  parcelas: number,
): RecusaFinanceiro | null {
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

/** O comprovante do cartão cabe inteiro no código de autorização: nunca é cortado ao gravar. */
export const COMPROVANTE_CARTAO_MAXIMO = 20;

/**
 * Recebimento em cartão no caixa. Quando o estabelecimento trabalha com administradora de cartão (há alguma ativa), a
 * venda em cartão só é aceita com a administradora e a bandeira: é delas que saem a transação e as parcelas a receber.
 * Sem isso o dinheiro do cartão ficaria fora do fluxo de caixa projetado e da baixa do crédito. O comprovante digitado
 * identifica a venda na administradora e por isso não pode passar do tamanho guardado.
 */
export function conferirCartaoNoRecebimento(p: {
  readonly emCartao: boolean;
  readonly administradorasAtivas: number;
  readonly cartaoInformado: boolean;
  readonly comprovante?: string | null;
}): RecusaFinanceiro | null {
  if (!p.emCartao) return null;
  if (!p.cartaoInformado)
    return p.administradorasAtivas > 0
      ? recusaFin(
          'cartao-sem-administradora',
          'Escolha a administradora e a bandeira do cartão: sem elas a venda não entra no que a administradora tem a creditar.',
          ['cartao'],
        )
      : null;
  if ((p.comprovante ?? '').trim().length > COMPROVANTE_CARTAO_MAXIMO)
    return recusaFin(
      'comprovante-cartao-longo',
      `O comprovante do cartão (NSU ou autorização) tem até ${COMPROVANTE_CARTAO_MAXIMO} caracteres.`,
      ['comprovante'],
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
  const recusa = conferirParcelasCartao(p.taxa.modalidade, p.parcelas);
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

// ── Cadastro da taxa, com vigência (nada é apagado: a taxa nova encerra a anterior na véspera) ──

/** O que a tela manda para cadastrar uma taxa. */
export type NovaTaxaAdministradora = Omit<TaxaAdministradora, 'id' | 'vigenciaFim' | 'ativo'>;

/** O prazo máximo de repasse aceito, em dias. */
export const DIAS_REPASSE_MAXIMO = 400;

/** Confere a taxa antes de gravar: faixa de parcelas, percentual ou valor e prazo de repasse. */
export function conferirTaxaAdministradora(t: NovaTaxaAdministradora): RecusaFinanceiro | null {
  const faixa =
    Number.isInteger(t.parcelaInicial) &&
    Number.isInteger(t.parcelaFinal) &&
    t.parcelaInicial >= 1 &&
    t.parcelaFinal >= t.parcelaInicial &&
    t.parcelaFinal <= PARCELAS_CARTAO_MAXIMO;
  if (!faixa)
    return recusaFin(
      'taxa-cartao-faixa-invalida',
      `A faixa de parcelas vai de 1 a ${PARCELAS_CARTAO_MAXIMO}, com a final igual ou maior que a inicial.`,
      ['parcelaInicial', 'parcelaFinal'],
    );
  if (t.modalidade !== 'credito' && (t.parcelaInicial !== 1 || t.parcelaFinal !== 1))
    return recusaFin(
      'parcelas-cartao-a-vista',
      'Débito, pré-pago e voucher são recebidos em parcela única: a faixa é de 1 a 1.',
      ['parcelaInicial', 'parcelaFinal'],
    );
  if (t.tipo === 'percentual') {
    if (t.percentual === null || !(t.percentual >= 0) || t.percentual >= 100)
      return recusaFin('taxa-cartao-percentual-invalido', 'O percentual da taxa vai de 0 a menos de 100.', [
        'percentual',
      ]);
  } else if (t.valor === null || !(t.valor >= 0))
    return recusaFin('taxa-cartao-valor-invalido', 'O valor fixo da taxa não pode ser negativo.', ['valor']);
  if (!Number.isInteger(t.diasRepasse) || t.diasRepasse < 0 || t.diasRepasse > DIAS_REPASSE_MAXIMO)
    return recusaFin(
      'taxa-cartao-repasse-invalido',
      `O prazo de repasse vai de 0 a ${DIAS_REPASSE_MAXIMO} dias.`,
      ['diasRepasse'],
    );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.vigenciaInicio))
    return recusaFin('taxa-cartao-vigencia-invalida', 'Informe o início da vigência.', ['vigenciaInicio']);
  return null;
}

/**
 * A vigência da taxa nova contra as que já existem para a mesma administradora, bandeira e modalidade com faixa de
 * parcelas que se cruza: as que ainda valem no início da nova são encerradas na véspera (ficam no histórico e seguem
 * valendo para as vendas antigas); se já existe uma que começa no mesmo dia ou depois, a nova é recusada (a vigência
 * nova tem de começar depois da última).
 */
export function planejarVigenciaTaxa(
  existentes: readonly TaxaAdministradora[],
  nova: NovaTaxaAdministradora,
): { encerrar: { id: number; vigenciaFim: string }[] } | { recusa: RecusaFinanceiro } {
  const recusa = conferirTaxaAdministradora(nova);
  if (recusa) return { recusa };
  const mesmas = existentes.filter(
    (t) =>
      t.ativo &&
      t.administradora === nova.administradora &&
      t.bandeira === nova.bandeira &&
      t.modalidade === nova.modalidade &&
      t.parcelaInicial <= nova.parcelaFinal &&
      t.parcelaFinal >= nova.parcelaInicial &&
      (t.vigenciaFim === null || t.vigenciaFim >= nova.vigenciaInicio),
  );
  if (mesmas.some((t) => t.vigenciaInicio >= nova.vigenciaInicio))
    return {
      recusa: recusaFin(
        'taxa-cartao-vigencia-posterior',
        'Já existe taxa desta bandeira e faixa de parcelas com vigência no mesmo dia ou depois: a nova tem de começar depois dela.',
        ['vigenciaInicio'],
      ),
    };
  const vespera = somarDias(nova.vigenciaInicio, -1);
  return { encerrar: mesmas.map((t) => ({ id: t.id, vigenciaFim: vespera })) };
}

/** O crédito da administradora repartido entre as parcelas baixadas: a diferença para o previsto vai à primeira. */
export function repartirCreditoCartao(
  liquidos: readonly number[],
  creditado: number,
): { recebidos: number[]; diferenca: number } | { recusa: RecusaFinanceiro } {
  if (liquidos.length === 0)
    return {
      recusa: recusaFin('recebivel-cartao-vazio', 'Escolha ao menos uma parcela a receber.', ['parcelas']),
    };
  const previsto = liquidos.reduce((s, v) => s + emCentavos(v), 0);
  const credito = emCentavos(creditado);
  const primeira = emCentavos(liquidos[0] as number) + (credito - previsto);
  if (credito <= 0 || primeira < 0)
    return {
      recusa: recusaFin(
        'credito-cartao-invalido',
        'O valor creditado tem de ser positivo e não pode ficar abaixo do previsto em mais do que a primeira parcela.',
        ['valorCreditado'],
      ),
    };
  return {
    recebidos: liquidos.map((v, i) => (i === 0 ? primeira : emCentavos(v)) / 100),
    diferenca: (credito - previsto) / 100,
  };
}
