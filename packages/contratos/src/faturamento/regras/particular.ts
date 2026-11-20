// Particular (ficha do M30, regra 12; cap-06b §6.5; Lei 12.653/2012): a urgência nunca é condicionada a caução, nota
// promissória ou garantia; o preço manual só dentro da faixa da tabela (parâmetro), com aprovação acima dela.
import { centavos, recusaFat, type RecusaFaturamento } from './recusa.js';

export const FORMAS_PAGAMENTO = [
  'dinheiro',
  'pix',
  'cartao-credito',
  'cartao-debito',
  'transferencia',
] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

/**
 * O convênio do particular (TBCONVEN 10 na rede, o mesmo da agenda e do orçamento de exames). O recebimento do caixa
 * contra uma conta só vale para conta deste convênio: conta de convênio é cobrada da operadora, não no caixa.
 */
export const CONVENIO_PARTICULAR_FAT = 10;

/** O recebimento no caixa pode ser contra esta conta? (só a conta do particular). */
export function conferirContaParticular(convenio: number): RecusaFaturamento | null {
  return convenio === CONVENIO_PARTICULAR_FAT
    ? null
    : recusaFat('conta-nao-particular', 'Só a conta do particular é recebida no caixa.', ['conta']);
}

export const ROTULO_FORMA: Readonly<Record<FormaPagamento, string>> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  'cartao-credito': 'Cartão de crédito',
  'cartao-debito': 'Cartão de débito',
  transferencia: 'Transferência',
};

/** Regra 12 (Lei 12.653/2012): na urgência, nenhuma exigência prévia de pagamento, caução ou garantia. */
export function conferirSemCaucao(o: {
  readonly urgencia: boolean;
  readonly exigeGarantiaAntes: boolean;
}): RecusaFaturamento | null {
  if (o.urgencia && o.exigeGarantiaAntes)
    return recusaFat(
      'caucao-proibida',
      'Atendimento de urgência não pode ser condicionado a caução, garantia ou pagamento antecipado (Lei 12.653/2012).',
    );
  return null;
}

export interface FaixaPreco {
  /** Fração abaixo e acima do preço de tabela aceitas sem aprovação (ex.: 0,10 = 10%). */
  readonly abaixo: number;
  readonly acima: number;
}

export type DecisaoPrecoManual = 'dentro-da-faixa' | 'exige-aprovacao' | 'abaixo-do-minimo';

/** Regra 12: o preço manual contra a tabela e a faixa do parâmetro. */
export function decidirPrecoManual(tabela: number, manual: number, faixa: FaixaPreco): DecisaoPrecoManual {
  if (tabela <= 0) return 'exige-aprovacao';
  const min = centavos(tabela * (1 - faixa.abaixo));
  const max = centavos(tabela * (1 + faixa.acima));
  if (manual < min) return 'abaixo-do-minimo';
  if (manual > max) return 'exige-aprovacao';
  return 'dentro-da-faixa';
}

/** Logins comparados como o legado guarda (sem espaços nas pontas, sem caixa). */
export const mesmoLogin = (a: string, b: string): boolean =>
  a.trim().toUpperCase() === b.trim().toUpperCase();

/** O preço manual pode seguir? Abaixo do mínimo e acima da faixa só com aprovador (alçada) e justificativa. */
export function conferirPrecoManual(o: {
  readonly tabela: number;
  readonly manual: number;
  readonly faixa: FaixaPreco;
  readonly aprovador: string | null;
  readonly justificativa: string;
  /** O login de quem lança: a aprovação é de outra pessoa (sem autoaprovação). */
  readonly operador?: string;
}): RecusaFaturamento | null {
  const d = decidirPrecoManual(o.tabela, o.manual, o.faixa);
  if (d === 'dentro-da-faixa') return null;
  if (!o.aprovador)
    return recusaFat(
      'preco-fora-da-faixa',
      'O preço digitado está fora da faixa da tabela e exige aprovação.',
      ['preco'],
    );
  if (o.operador && mesmoLogin(o.aprovador, o.operador))
    return recusaFat(
      'autoaprovacao',
      'O preço fora da faixa é aprovado por outra pessoa, não por quem lança.',
      ['aprovador'],
    );
  if (o.justificativa.trim().length < 5)
    return recusaFat('justificativa-obrigatoria', 'Informe a justificativa do preço fora da faixa.', [
      'justificativa',
    ]);
  return null;
}

export interface ItemOrcamento {
  readonly descricao: string;
  readonly quantidade: number;
  readonly unitario: number;
}

export function totalOrcamento(itens: readonly ItemOrcamento[], desconto = 0): number {
  const bruto = itens.reduce((s, i) => s + centavos(i.quantidade * i.unitario), 0);
  return Math.max(0, centavos(bruto - desconto));
}

/** O recebimento fecha o orçamento? O troco só em dinheiro; nenhuma forma acima do saldo, salvo dinheiro. */
export function conferirRecebimento(o: {
  readonly saldo: number;
  readonly pagamentos: readonly { readonly forma: FormaPagamento; readonly valor: number }[];
}): RecusaFaturamento | null {
  if (o.pagamentos.length === 0)
    return recusaFat('sem-pagamento', 'Informe ao menos uma forma de pagamento.');
  for (const p of o.pagamentos)
    if (!(p.valor > 0))
      return recusaFat('valor-invalido', 'O valor de cada pagamento tem de ser maior que zero.');
  const naoDinheiro = o.pagamentos.filter((p) => p.forma !== 'dinheiro').reduce((s, p) => s + p.valor, 0);
  if (centavos(naoDinheiro) > centavos(o.saldo))
    return recusaFat('acima-do-saldo', 'Pagamento em cartão, Pix ou transferência acima do saldo em aberto.');
  return null;
}

/** O troco (só em dinheiro). */
export function troco(saldo: number, pagamentos: readonly { readonly valor: number }[]): number {
  return Math.max(0, centavos(pagamentos.reduce((s, p) => s + p.valor, 0) - saldo));
}
