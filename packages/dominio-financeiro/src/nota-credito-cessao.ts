// F8, 07-FIN linhas 70 e 79: nota de crédito e de débito com tributos (fornecedor e cliente) e portador do título a
// receber com desconto e cessão de recebíveis. Regras puras.
// Desenho da nota: o usuário escolhe o título (a pagar ou a receber), e a contraparte, o lado e o saldo vêm dele; o
// sistema diz na hora se a nota ABATE ou ACRESCE o título (pela direção e natureza, do ponto de vista do hospital),
// calcula os tributos pela base e alíquota e recusa a nota maior que o saldo que ela abate. A nota nasce emitida e é
// aplicada ao título num passo só; cancelar exige motivo e desfaz o ajuste da aplicada, sem apagar nada.
// Desenho da cessão: o usuário escolhe o portador (banco do desconto ou cessionário), marca as parcelas em aberto e vê
// na hora o deságio de cada uma (desconto comercial simples: face × taxa ao mês × dias / 30), o líquido a creditar e o
// limite do portador. Com coobrigação a parcela continua do hospital, sob o portador, até o sacado pagar ou o hospital
// recomprar; sem coobrigação a parcela sai da carteira (abatida pela cessão) no ato.
import { centavos, type RecusaFinanceiro, recusaFin } from '@sgh/contratos/regras-financeiro';

// ── Nota de crédito e de débito ──────────────────────────────────────────────────────────────────────────────────

export type DirecaoNota = 'emitida' | 'recebida';
export type NaturezaNota = 'credito' | 'debito';
export type LadoNota = 'pagar' | 'receber';
export type EfeitoNota = 'abate' | 'acresce';

/**
 * O efeito da nota no título. A nota a favor do hospital é a de débito que ele emite (cobra a contraparte) ou a de
 * crédito que ele recebe (a contraparte credita o hospital): no título a receber ela ACRESCE, no a pagar ela ABATE.
 * A nota contra o hospital faz o contrário.
 */
export function efeitoNota(direcao: DirecaoNota, natureza: NaturezaNota, lado: LadoNota): EfeitoNota {
  const aFavor = (direcao === 'emitida') === (natureza === 'debito');
  return (lado === 'receber') === aFavor ? 'acresce' : 'abate';
}

export interface TributoNota {
  readonly tributo: number;
  readonly base: number;
  /** Alíquota em percentual. */
  readonly aliquota: number;
  /** Retido pela fonte: não soma ao total da nota, reduz o efeito no título. */
  readonly retido: boolean;
}

export interface EntradaNota {
  readonly direcao: DirecaoNota;
  readonly natureza: NaturezaNota;
  readonly lado: LadoNota;
  /** Natureza aceita pelo motivo escolhido. */
  readonly naturezaMotivo: 'credito' | 'debito' | 'ambos';
  readonly motivoAtivo: boolean;
  readonly valorItens: number;
  readonly valorDesconto: number;
  readonly valorOutros: number;
  readonly tributos: readonly TributoNota[];
  readonly dataEmissao: string;
  readonly dataVencimento: string | null;
  /** O título ajustado: situação e saldo em aberto. */
  readonly situacaoTitulo: string;
  readonly saldoTitulo: number;
}

export interface TributoCalculado extends TributoNota {
  readonly sequencia: number;
  readonly valor: number;
}

export interface PlanoNota {
  readonly efeito: EfeitoNota;
  readonly tributos: readonly TributoCalculado[];
  /** Tributos destacados (não retidos): somam ao total. */
  readonly valorImpostos: number;
  readonly valorRetido: number;
  readonly valorTotal: number;
  /** O quanto o título muda: total menos o retido. */
  readonly valorAjuste: number;
}

const TITULO_ENCERRADO = new Set(['cancelado', 'renegociado', 'pago', 'recebido']);

export function planejarNota(e: EntradaNota): PlanoNota | RecusaFinanceiro {
  if (!e.motivoAtivo) return recusaFin('motivo-inativo', 'O motivo da nota está inativo.', ['motivo']);
  if (e.naturezaMotivo !== 'ambos' && e.naturezaMotivo !== e.natureza)
    return recusaFin(
      'motivo-natureza',
      `O motivo escolhido só vale para nota de ${e.naturezaMotivo === 'credito' ? 'crédito' : 'débito'}.`,
      ['motivo', 'natureza'],
    );
  if (e.dataVencimento !== null && e.dataVencimento < e.dataEmissao)
    return recusaFin('vencimento-antes-emissao', 'O vencimento não pode ser antes da emissão.', [
      'dataVencimento',
    ]);
  if (e.valorItens <= 0) return recusaFin('valor-invalido', 'Informe o valor da nota.', ['valorItens']);
  if (e.valorDesconto < 0 || e.valorOutros < 0)
    return recusaFin('valor-invalido', 'Desconto e outros valores não podem ser negativos.', [
      'valorDesconto',
    ]);
  if (e.valorDesconto > e.valorItens)
    return recusaFin('desconto-maior', 'O desconto não pode passar do valor da nota.', ['valorDesconto']);
  if (TITULO_ENCERRADO.has(e.situacaoTitulo))
    return recusaFin('titulo-encerrado', 'O título já está encerrado: a nota não pode ajustá-lo.', [
      'titulo',
    ]);
  const vistos = new Set<number>();
  const tributos: TributoCalculado[] = [];
  for (const [i, t] of e.tributos.entries()) {
    if (vistos.has(t.tributo))
      return recusaFin('tributo-repetido', 'O mesmo tributo aparece duas vezes na nota.', ['tributos']);
    vistos.add(t.tributo);
    if (t.base < 0 || t.aliquota < 0 || t.aliquota > 100)
      return recusaFin('tributo-invalido', 'Base e alíquota do tributo têm de ficar entre zero e 100%.', [
        'tributos',
      ]);
    tributos.push({ ...t, sequencia: i + 1, valor: centavos((t.base * t.aliquota) / 100) });
  }
  const valorImpostos = centavos(tributos.filter((t) => !t.retido).reduce((s, t) => s + t.valor, 0));
  const valorRetido = centavos(tributos.filter((t) => t.retido).reduce((s, t) => s + t.valor, 0));
  const valorTotal = centavos(e.valorItens - e.valorDesconto + e.valorOutros + valorImpostos);
  const valorAjuste = centavos(valorTotal - valorRetido);
  if (valorAjuste <= 0)
    return recusaFin('retido-maior', 'Os tributos retidos não podem passar do total da nota.', ['tributos']);
  const efeito = efeitoNota(e.direcao, e.natureza, e.lado);
  if (efeito === 'abate' && valorAjuste > centavos(e.saldoTitulo))
    return recusaFin(
      'nota-maior-que-saldo',
      `A nota abate ${valorAjuste.toFixed(2)}, mais que o saldo em aberto do título (${centavos(e.saldoTitulo).toFixed(2)}).`,
      ['valorItens'],
    );
  return { efeito, tributos, valorImpostos, valorRetido, valorTotal, valorAjuste };
}

/** A nota se cancela com motivo; a aplicada só enquanto o título ainda comporta desfazer o ajuste. */
export function conferirCancelamentoNota(n: {
  readonly situacao: string;
  readonly efeito: EfeitoNota;
  readonly valorAjuste: number;
  readonly saldoTitulo: number;
}): RecusaFinanceiro | null {
  if (n.situacao === 'cancelada') return recusaFin('nota-cancelada', 'A nota já está cancelada.');
  if (
    n.situacao === 'aplicada' &&
    n.efeito === 'acresce' &&
    centavos(n.saldoTitulo) < centavos(n.valorAjuste)
  )
    return recusaFin(
      'titulo-ja-baixado',
      'O acréscimo da nota já foi pago ou recebido no título: estorne a baixa antes de cancelar a nota.',
    );
  return null;
}

// ── Portador, desconto e cessão de recebíveis ─────────────────────────────────────────────────────────────────

export type TipoOperacaoCessao = 'desconto_duplicata' | 'cessao' | 'antecipacao_cartao' | 'fomento';

export interface ParcelaCessao {
  readonly parcela: number;
  readonly situacao: string;
  readonly saldo: number;
  readonly vencimento: string;
  /** A parcela já está cedida noutra operação viva. */
  readonly jaCedida: boolean;
}

export interface EntradaCessao {
  readonly tipo: TipoOperacaoCessao;
  readonly comCoobrigacao: boolean;
  readonly dataOperacao: string;
  readonly taxaMensal: number;
  readonly valorTarifas: number;
  readonly valorIof: number;
  readonly parcelas: readonly ParcelaCessao[];
  /** Limite de crédito vigente do portador (nulo: sem limite). */
  readonly limitePortador: number | null;
  /** Face já tomada no portador por operações contratadas e não liquidadas. */
  readonly utilizadoPortador: number;
}

export interface ItemCessao {
  readonly parcela: number;
  readonly vencimento: string;
  readonly dias: number;
  readonly valorFace: number;
  readonly valorDesagio: number;
}

export interface PlanoCessao {
  readonly itens: readonly ItemCessao[];
  readonly valorFace: number;
  readonly valorDesagio: number;
  readonly valorLiquido: number;
}

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/** Deságio por desconto comercial simples: face × (taxa ao mês / 100) × dias / 30. */
export const desagio = (face: number, taxaMensal: number, dias: number): number =>
  centavos((face * taxaMensal * Math.max(0, dias)) / 3000);

export function planejarCessao(e: EntradaCessao): PlanoCessao | RecusaFinanceiro {
  if (e.tipo === 'antecipacao_cartao')
    return recusaFin('tipo-cartao', 'A antecipação do cartão é feita pela agenda de recebíveis do cartão.', [
      'tipo',
    ]);
  if (e.parcelas.length === 0) return recusaFin('sem-parcelas', 'Marque ao menos uma parcela.', ['parcelas']);
  if (e.taxaMensal < 0 || e.taxaMensal > 100)
    return recusaFin('taxa-invalida', 'A taxa ao mês tem de ficar entre zero e 100%.', ['taxaMensal']);
  if (e.valorTarifas < 0 || e.valorIof < 0)
    return recusaFin('valor-invalido', 'Tarifas e IOF não podem ser negativos.', ['valorTarifas']);
  if (e.tipo === 'desconto_duplicata' && !e.comCoobrigacao)
    return recusaFin(
      'desconto-sem-coobrigacao',
      'No desconto de duplicata o hospital responde pelo título não pago: marque a coobrigação.',
      ['comCoobrigacao'],
    );
  const itens: ItemCessao[] = [];
  for (const p of e.parcelas) {
    if (p.jaCedida)
      return recusaFin('parcela-ja-cedida', `A parcela ${p.parcela} já está noutra operação.`, ['parcelas']);
    if (p.situacao !== 'aberta' && p.situacao !== 'parcial')
      return recusaFin('parcela-fechada', `A parcela ${p.parcela} não está em aberto.`, ['parcelas']);
    if (p.saldo <= 0)
      return recusaFin('parcela-sem-saldo', `A parcela ${p.parcela} não tem saldo.`, ['parcelas']);
    const dias = diasEntre(e.dataOperacao, p.vencimento);
    if (dias < 0)
      return recusaFin('parcela-vencida', `A parcela ${p.parcela} já venceu: não se cede título vencido.`, [
        'parcelas',
      ]);
    itens.push({
      parcela: p.parcela,
      vencimento: p.vencimento,
      dias,
      valorFace: centavos(p.saldo),
      valorDesagio: desagio(p.saldo, e.taxaMensal, dias),
    });
  }
  const valorFace = centavos(itens.reduce((s, i) => s + i.valorFace, 0));
  const valorDesagio = centavos(itens.reduce((s, i) => s + i.valorDesagio, 0));
  const valorLiquido = centavos(valorFace - valorDesagio - e.valorTarifas - e.valorIof);
  if (valorLiquido <= 0)
    return recusaFin('liquido-invalido', 'Deságio, tarifas e IOF consomem todo o valor: revise a operação.', [
      'taxaMensal',
    ]);
  if (e.limitePortador !== null && centavos(e.utilizadoPortador + valorFace) > centavos(e.limitePortador))
    return recusaFin(
      'limite-portador',
      `A operação passa do limite do portador (disponível ${centavos(e.limitePortador - e.utilizadoPortador).toFixed(2)}).`,
      ['parcelas'],
    );
  return { itens, valorFace, valorDesagio, valorLiquido };
}

/** O que se faz com um item cedido: o sacado pagou ao portador, ou o hospital recomprou (só com coobrigação). */
export function conferirDesfechoItem(i: {
  readonly acao: 'liquidar' | 'recomprar';
  readonly situacaoOperacao: string;
  readonly situacaoItem: string;
  readonly comCoobrigacao: boolean;
  readonly valorRecompra?: number;
}): RecusaFinanceiro | null {
  if (i.situacaoOperacao !== 'contratada')
    return recusaFin('operacao-nao-contratada', 'A operação não está contratada.');
  if (i.situacaoItem !== 'cedida') return recusaFin('item-encerrado', 'Este recebível já teve desfecho.');
  if (i.acao === 'recomprar') {
    if (!i.comCoobrigacao)
      return recusaFin('sem-coobrigacao', 'Na cessão sem coobrigação o hospital não recompra o recebível.');
    if ((i.valorRecompra ?? -1) < 0)
      return recusaFin('valor-invalido', 'Informe o valor da recompra.', ['valorRecompra']);
  }
  return null;
}
