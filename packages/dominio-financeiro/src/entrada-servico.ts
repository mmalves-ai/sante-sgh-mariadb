// F7, 09-AREA linha 78 (C2-094): a entrada de serviço tomado. A nota de serviço (ou o recibo do prestador) entra contra
// o pedido de compra de serviço (ou avulsa, com o contrato), com os itens, o câmbio da moeda contratada e as retenções
// na fonte calculadas na hora pelas regras vigentes do estabelecimento (IN RFB 2.043/2021 para a EFD-REINF; Lei 9.430,
// art. 64; Lei 10.833, arts. 30 e 31; Lei 8.212, art. 31; LC 116, art. 6.º para o ISS do tomador). A retenção calculada
// na entrada é a fonte da R-2010 (INSS) e da R-4020 (IR, PIS, COFINS e CSLL) até o título a pagar confirmá-la: com o
// título ligado e retido, vale o título (fonte única, nada declarado em dobro).
import { centavos, type RecusaFinanceiro } from '@sgh/contratos/regras-financeiro';
import type { SugestaoRetencao } from './retencao-regra.js';

export const SITUACOES_ENTRADA_SERVICO = ['aberta', 'concluida', 'cancelada'] as const;
export type SituacaoEntradaServico = (typeof SITUACOES_ENTRADA_SERVICO)[number];
/** Situações do pedido de compra que aceitam entrada (aprovado e ainda não encerrado). */
export const PEDIDO_ACEITA_ENTRADA = ['aprovado', 'enviado', 'parcialmente_recebido'] as const;
/** Faixa da alíquota do ISS (LC 116, art. 8.º-A e art. 8.º, II). */
export const ISS_ALIQUOTA_MINIMA = 2;
export const ISS_ALIQUOTA_MAXIMA = 5;

/** O campo da EFD-REINF a que o tributo pertence (pela sigla do cadastro); nulo: o tributo não vai à REINF. */
export type CampoRetencao = 'inss' | 'ir' | 'pis' | 'cofins' | 'csll' | 'iss';
export function campoDoTributo(sigla: string): CampoRetencao | null {
  const s = sigla.toLowerCase();
  if (s.includes('inss') || s.includes('cprb')) return 'inss';
  if (s.includes('csll')) return 'csll';
  if (s.includes('cofins')) return 'cofins';
  if (s.includes('pis')) return 'pis';
  if (/(^|[^a-z])iss($|[^a-z])/.test(s)) return 'iss';
  if (/(^|[^a-z])ir(rf|pj|f)?($|[^a-z])/.test(s)) return 'ir';
  return null;
}

export interface ItemEntradaServico {
  readonly quantidade: number;
  readonly valorUnitario: number;
  readonly valorDesconto: number;
  readonly servico: number;
  /** Item do pedido de compra atendido; nulo na entrada avulsa. */
  readonly pedidoItem: number | null;
  /** Parte do INSS não retida por decisão judicial (com o número do processo). */
  readonly inssNaoRetido: number;
  readonly processoJudicial: string | null;
}
export interface ItemPedidoServico {
  readonly id: number;
  readonly servico: number | null;
  readonly quantidade: number;
  readonly recebida: number;
  readonly cancelada: number;
  readonly valorUnitario: number;
}
export interface PedidoServico {
  readonly id: number;
  readonly fornecedor: number;
  readonly situacao: string;
  readonly natureza: string;
  readonly itens: readonly ItemPedidoServico[];
}

/** O valor do item: quantidade x preço menos o desconto, em centavos. */
export const valorDoItem = (i: Pick<ItemEntradaServico, 'quantidade' | 'valorUnitario' | 'valorDesconto'>) =>
  centavos(i.quantidade * i.valorUnitario - i.valorDesconto);
/** O valor bruto da nota: a soma dos itens. */
export const valorBrutoEntrada = (itens: readonly ItemEntradaServico[]) =>
  centavos(itens.reduce((s, i) => s + valorDoItem(i), 0));
/** Saldo do item do pedido ainda não atendido. */
export const saldoDoItemPedido = (i: ItemPedidoServico) =>
  Math.max(0, i.quantidade - i.recebida - i.cancelada);
/** Valor convertido para o real pela taxa da cotação (unidades de real por unidade da moeda). */
export const converterMoeda = (valorMoeda: number, taxa: number) => centavos(valorMoeda * taxa);

const rec = (codigo: string, mensagem: string, campos: string[]): RecusaFinanceiro => ({
  codigo,
  mensagem,
  campos,
});

export interface EntradaServicoProposta {
  readonly fornecedor: number;
  readonly dataEmissao: string;
  readonly dataEntrada: string;
  /** AAAA-MM. */
  readonly competencia: string;
  readonly itens: readonly ItemEntradaServico[];
  readonly pedido: PedidoServico | null;
  readonly issRetido: boolean;
  readonly aliquotaIss: number | null;
  readonly cambio: { readonly taxa: number; readonly valorMoeda: number } | null;
}

/**
 * Confere a entrada antes de gravar: itens com quantidade e preço; datas; competência não anterior à emissão; contra o
 * pedido: do mesmo fornecedor, aprovado e aberto, de serviço, cada item ligado a um item de serviço dele, no saldo e no
 * preço do pedido (o pedido é o teto); ISS retido com alíquota na faixa da LC 116; câmbio com taxa e valor que fecham.
 */
export function conferirEntradaServico(p: EntradaServicoProposta): RecusaFinanceiro | null {
  if (p.itens.length === 0) return rec('sem-itens', 'Informe ao menos um serviço da nota.', ['itens']);
  for (const [n, i] of p.itens.entries()) {
    if (!(i.quantidade > 0))
      return rec('quantidade-invalida', `Serviço ${n + 1}: a quantidade deve ser maior que zero.`, ['itens']);
    if (i.valorUnitario < 0 || i.valorDesconto < 0 || valorDoItem(i) < 0)
      return rec('valor-invalido', `Serviço ${n + 1}: o desconto passa do valor do serviço.`, ['itens']);
    if (i.inssNaoRetido > 0 && !i.processoJudicial?.trim())
      return rec('sem-processo', `Serviço ${n + 1}: o INSS não retido exige o número do processo judicial.`, [
        'itens',
      ]);
  }
  if (p.dataEntrada < p.dataEmissao)
    return rec('datas-invertidas', 'A entrada não pode ser anterior à emissão da nota.', ['dataEntrada']);
  if (p.competencia > p.dataEntrada.slice(0, 7))
    return rec('competencia-futura', 'A competência não pode ser posterior à entrada da nota.', [
      'competencia',
    ]);
  if (p.competencia < p.dataEmissao.slice(0, 7))
    return rec('competencia-anterior', 'A competência não pode ser anterior à emissão da nota.', [
      'competencia',
    ]);
  if (p.pedido) {
    const ped = p.pedido;
    if (ped.fornecedor !== p.fornecedor)
      return rec('pedido-outro-fornecedor', 'O pedido é de outro fornecedor.', ['pedido']);
    if (!(PEDIDO_ACEITA_ENTRADA as readonly string[]).includes(ped.situacao))
      return rec('pedido-fechado', 'O pedido não está aprovado ou já foi encerrado.', ['pedido']);
    if (ped.natureza === 'produto')
      return rec(
        'pedido-de-produto',
        'O pedido é de produto: a entrada de serviço pede um pedido de serviço.',
        ['pedido'],
      );
    const usados = new Map<number, number>();
    for (const [n, i] of p.itens.entries()) {
      const pi = ped.itens.find((x) => x.id === i.pedidoItem);
      if (!pi || pi.servico === null)
        return rec('item-fora-do-pedido', `Serviço ${n + 1}: escolha um serviço do pedido.`, ['itens']);
      if (pi.servico !== i.servico)
        return rec('servico-diferente', `Serviço ${n + 1}: o serviço não é o do item do pedido.`, ['itens']);
      const total = (usados.get(pi.id) ?? 0) + i.quantidade;
      usados.set(pi.id, total);
      if (total > saldoDoItemPedido(pi) + 1e-9)
        return rec(
          'acima-do-saldo',
          `Serviço ${n + 1}: a quantidade passa do saldo do pedido (${saldoDoItemPedido(pi)}).`,
          ['itens'],
        );
      if (i.valorUnitario > pi.valorUnitario + 0.005)
        return rec('acima-do-preco', `Serviço ${n + 1}: o preço passa do preço do pedido.`, ['itens']);
    }
  } else if (p.itens.some((i) => i.pedidoItem !== null)) {
    return rec('item-sem-pedido', 'Escolha o pedido dos itens ligados a pedido.', ['pedido']);
  }
  if (p.issRetido) {
    if (p.aliquotaIss === null)
      return rec('iss-sem-aliquota', 'O ISS retido exige a alíquota da nota.', ['aliquotaIss']);
    if (p.aliquotaIss < ISS_ALIQUOTA_MINIMA || p.aliquotaIss > ISS_ALIQUOTA_MAXIMA)
      return rec(
        'iss-fora-da-faixa',
        `A alíquota do ISS fica entre ${ISS_ALIQUOTA_MINIMA}% e ${ISS_ALIQUOTA_MAXIMA}% (LC 116).`,
        ['aliquotaIss'],
      );
  }
  if (p.cambio) {
    if (!(p.cambio.taxa > 0))
      return rec('cambio-invalido', 'A taxa de câmbio deve ser maior que zero.', ['cambio']);
    const convertido = converterMoeda(p.cambio.valorMoeda, p.cambio.taxa);
    if (Math.abs(convertido - valorBrutoEntrada(p.itens)) > 0.01)
      return rec(
        'cambio-nao-fecha',
        `O valor na moeda convertido (${convertido.toFixed(2)}) não fecha com a soma dos serviços.`,
        ['cambio'],
      );
  }
  return null;
}

export interface RetencaoCalculada {
  /** Sigla do tributo, como no cadastro. */
  readonly tributo: string;
  readonly campo: CampoRetencao | null;
  readonly regra: number | null;
  readonly base: number;
  readonly aliquota: number;
  readonly valorTributo: number;
  readonly valorRetido: number;
  readonly valorNaoRetido: number;
  readonly dispensada: boolean;
}

/**
 * As retenções da nota: IR, INSS, PIS, COFINS e CSLL pela regra vigente (com a dispensa pelo mínimo da guia); o INSS
 * com a parte não retida por decisão judicial; o ISS pela nota (base e alíquota informadas) quando o tomador é o
 * responsável. A regra de ISS do cadastro não vale aqui: quem diz se o ISS é retido é a nota.
 */
export function calcularRetencoesEntrada(
  sugestoes: readonly SugestaoRetencao[],
  p: {
    readonly valorBruto: number;
    readonly issRetido: boolean;
    readonly baseIss: number | null;
    readonly aliquotaIss: number | null;
    readonly inssNaoRetido: number;
    readonly siglaIss?: string;
  },
): RetencaoCalculada[] {
  const saida: RetencaoCalculada[] = [];
  for (const s of sugestoes) {
    const campo = campoDoTributo(s.tributo);
    if (campo === 'iss') continue;
    const devido = s.dispensada ? 0 : s.valor;
    const naoRetido = campo === 'inss' ? Math.min(devido, centavos(p.inssNaoRetido)) : 0;
    saida.push({
      tributo: s.tributo,
      campo,
      regra: s.regra,
      base: s.base,
      aliquota: s.aliquota,
      valorTributo: s.valor,
      valorRetido: centavos(devido - naoRetido),
      valorNaoRetido: naoRetido,
      dispensada: s.dispensada,
    });
  }
  if (p.issRetido && p.aliquotaIss !== null) {
    const base = centavos(p.baseIss ?? p.valorBruto);
    const valor = centavos((base * p.aliquotaIss) / 100);
    saida.push({
      tributo: p.siglaIss ?? 'ISS',
      campo: 'iss',
      regra: null,
      base,
      aliquota: p.aliquotaIss,
      valorTributo: valor,
      valorRetido: valor,
      valorNaoRetido: 0,
      dispensada: false,
    });
  }
  return saida;
}

/** Rateia o valor pelos pesos (o valor de cada item), em centavos; a sobra do arredondamento fica no último. */
export function ratear(valor: number, pesos: readonly number[]): number[] {
  const total = pesos.reduce((s, x) => s + x, 0);
  if (pesos.length === 0) return [];
  if (total <= 0) return pesos.map((_, i) => (i === pesos.length - 1 ? centavos(valor) : 0));
  const partes = pesos.map((x) => centavos((valor * x) / total));
  const sobra = centavos(valor - partes.reduce((s, x) => s + x, 0));
  partes[partes.length - 1] = centavos(partes[partes.length - 1]! + sobra);
  return partes;
}

/** O líquido a pagar ao prestador: o bruto menos o retido. */
export const liquidoEntrada = (valorBruto: number, retencoes: readonly { valorRetido: number }[]) =>
  centavos(valorBruto - retencoes.reduce((s, r) => s + r.valorRetido, 0));

/** Os totais por campo da EFD-REINF (o ISS fica fora: é do município). */
export function totaisReinf(retencoes: readonly { campo: CampoRetencao | null; valorRetido: number }[]) {
  const t = { inss: 0, ir: 0, pis: 0, cofins: 0, csll: 0 };
  for (const r of retencoes)
    if (r.campo && r.campo !== 'iss') t[r.campo] = centavos(t[r.campo] + r.valorRetido);
  return t;
}

/** Concluir: só a aberta; os itens têm de somar o valor da nota. */
export function conferirConclusaoEntrada(p: {
  readonly situacao: string;
  readonly valorTotal: number;
  readonly somaItens: number;
}): RecusaFinanceiro | null {
  if (p.situacao !== 'aberta')
    return rec('situacao-invalida', 'Só a entrada aberta pode ser concluída.', ['situacao']);
  if (Math.abs(p.valorTotal - p.somaItens) > 0.01)
    return rec('itens-nao-fecham', 'Os serviços não somam o valor da nota.', ['itens']);
  return null;
}

/**
 * Cancelar: com justificativa; nunca a já cancelada; a concluída só enquanto a retenção não foi declarada na EFD-REINF
 * nem confirmada por título pago (aí se corrige pelo título ou pelo evento retificador, nunca sumindo com a entrada).
 */
export function conferirCancelamentoEntrada(p: {
  readonly situacao: string;
  readonly justificativa: string;
  readonly declaradaReinf: boolean;
  readonly tituloPago: boolean;
}): RecusaFinanceiro | null {
  if (p.situacao === 'cancelada') return rec('ja-cancelada', 'A entrada já está cancelada.', ['situacao']);
  if (p.justificativa.trim().length < 10)
    return rec('sem-justificativa', 'Explique o cancelamento (ao menos 10 letras).', ['justificativa']);
  if (p.declaradaReinf)
    return rec(
      'declarada-reinf',
      'A retenção já foi declarada na EFD-REINF: corrija pelo evento retificador.',
      ['situacao'],
    );
  if (p.tituloPago)
    return rec('titulo-pago', 'O título da entrada já foi pago: estorne o pagamento antes.', ['situacao']);
  return null;
}
