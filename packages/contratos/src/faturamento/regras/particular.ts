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
 * O convênio do particular (o convênio de código 10 na rede, o mesmo da agenda e do orçamento de exames). O recebimento do caixa
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

// ── Valor por extenso (o recibo do recebimento particular) ──────────────────────────────────────────────

const UNIDADES = [
  '',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
] as const;
const DEZENAS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
] as const;
const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
] as const;
const ESCALAS = [null, null, ['milhão', 'milhões'], ['bilhão', 'bilhões']] as const;

/** 1 a 999 por extenso ("cento e vinte e três"). */
function centenaPorExtenso(n: number): string {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const dezena =
    r < 20 ? UNIDADES[r] : [DEZENAS[Math.floor(r / 10)], UNIDADES[r % 10]].filter(Boolean).join(' e ');
  return [CENTENAS[c], dezena].filter(Boolean).join(' e ');
}

/** Inteiro de 1 a 999.999.999.999 por extenso, com o "e" antes do último grupo quando ele é < 100 ou redondo. */
function inteiroPorExtenso(n: number): string {
  const grupos: { valor: number; texto: string; escala: number }[] = [];
  for (let resto = n, escala = 0; resto > 0; resto = Math.floor(resto / 1000), escala += 1) {
    const g = resto % 1000;
    if (g === 0) continue;
    const nome = ESCALAS[escala];
    const texto =
      escala === 0
        ? centenaPorExtenso(g)
        : escala === 1
          ? g === 1
            ? 'mil'
            : `${centenaPorExtenso(g)} mil`
          : `${centenaPorExtenso(g)} ${g === 1 ? nome![0] : nome![1]}`;
    grupos.unshift({ valor: g, texto, escala });
  }
  return grupos
    .map((g, i) => {
      if (i === 0) return g.texto;
      const ultimo = i === grupos.length - 1;
      if (ultimo && (g.valor < 100 || g.valor % 100 === 0)) return ` e ${g.texto}`;
      return grupos[i - 1]!.escala === 1 ? ` ${g.texto}` : `, ${g.texto}`;
    })
    .join('');
}

/**
 * O valor do recibo por extenso, em reais ("mil duzentos e trinta e quatro reais e cinquenta e seis centavos"; milhão
 * redondo leva "de": "um milhão de reais"). Valor negativo, não finito ou de um trilhão para cima é recusado.
 */
export function valorPorExtenso(valor: number): string {
  if (!Number.isFinite(valor) || valor < 0 || valor >= 1e12)
    throw new RangeError('Valor fora da faixa do recibo.');
  const totalCentavos = Math.round(valor * 100);
  const inteiro = Math.floor(totalCentavos / 100);
  const cent = totalCentavos % 100;
  const partes: string[] = [];
  if (inteiro > 0) {
    const de = inteiro >= 1_000_000 && inteiro % 1_000_000 === 0 ? ' de' : '';
    partes.push(`${inteiroPorExtenso(inteiro)}${de} ${inteiro === 1 ? 'real' : 'reais'}`);
  }
  if (cent > 0) partes.push(`${centenaPorExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return partes.length ? partes.join(' e ') : 'zero real';
}
