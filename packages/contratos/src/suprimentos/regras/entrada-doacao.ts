// C1-126 (09-AREA linha 79): entrada de produtos recebidos em doação. Regras puras: a doação entra sem pedido de compra
// e sem nota fiscal de venda, com o doador (pessoa ou empresa do cadastro), o termo de doação e o custo de referência
// de cada item. Pela NBC TG 07 (subvenção e assistência governamentais, aplicada à doação recebida), o bem doado entra
// pelo valor justo; sem o valor justo do termo, usa-se o último preço de compra do item como referência. A doação não
// gera título a pagar nem muda o último preço de compra; a parte doada do saldo fica marcada (quantidade doada).
import { cpfValido } from '../../validacao/cpf.js';
import { type RecusaSuprimentos, reais } from './recusa.js';

export const TIPOS_DOADOR = ['pessoa', 'empresa'] as const;
export type TipoDoador = (typeof TIPOS_DOADOR)[number];
export const CRITERIOS_CUSTO_DOACAO = ['valor_justo', 'ultimo_preco'] as const;
export type CriterioCustoDoacao = (typeof CRITERIOS_CUSTO_DOACAO)[number];

/** Quantos itens cabem num termo de doação. */
export const MAXIMO_ITENS_DOACAO = 200;
/** Diferença entre o valor justo e o último preço de compra que pede atenção (não recusa): 50%. */
export const LIMIAR_AVISO_VALOR_JUSTO = 0.5;
const TERMO = /^[A-Za-z0-9./-]{1,20}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

const r = (codigo: string, mensagem: string, ...campos: string[]): RecusaSuprimentos => ({
  codigo,
  mensagem,
  ...(campos.length ? { campos } : {}),
});

export interface ItemDoacaoParaConferir {
  readonly item: number;
  readonly quantidade: number;
  readonly criterio: CriterioCustoDoacao;
  /** Valor justo unitário do termo (critério valor_justo). */
  readonly valorJusto: number | null;
  /** Último preço de compra unitário conhecido do item (nulo quando nunca foi comprado). */
  readonly ultimoPreco: number | null;
}

export interface DoacaoParaConferir {
  readonly doador: { readonly tipo: TipoDoador; readonly id: number } | null;
  readonly termo: string;
  readonly recebidaEm: string;
  readonly hoje: string;
  readonly itens: readonly ItemDoacaoParaConferir[];
}

/** O custo unitário de referência do item doado pelo critério (nulo quando o critério não tem valor). */
export function custoUnitarioDoacao(i: ItemDoacaoParaConferir): number | null {
  const v = i.criterio === 'valor_justo' ? i.valorJusto : i.ultimoPreco;
  return v !== null && Number.isFinite(v) && v > 0 ? Math.round(v * 1_000_000) / 1_000_000 : null;
}

function conferirItem(i: ItemDoacaoParaConferir): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (!(i.quantidade > 0) || Math.round(i.quantidade * 10_000) !== i.quantidade * 10_000)
    out.push(
      r('quantidade-invalida', 'A quantidade doada tem de ser maior que zero (até 4 casas).', 'itens'),
    );
  if (!CRITERIOS_CUSTO_DOACAO.includes(i.criterio))
    out.push(
      r('criterio-invalido', 'Escolha o critério do custo: valor justo do termo ou último preço.', 'itens'),
    );
  else if (i.criterio === 'valor_justo' && custoUnitarioDoacao(i) === null)
    out.push(r('sem-valor-justo', 'Informe o valor justo unitário do item, maior que zero.', 'itens'));
  else if (i.criterio === 'ultimo_preco' && custoUnitarioDoacao(i) === null)
    out.push(
      r('sem-ultimo-preco', 'O item nunca foi comprado: informe o valor justo do termo de doação.', 'itens'),
    );
  return out;
}

/** Confere a doação recebida antes de gravar: doador, termo, data e itens (a primeira recusa de cada item). */
export function conferirEntradaDoacao(d: DoacaoParaConferir): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (!d.doador || !TIPOS_DOADOR.includes(d.doador.tipo) || !(d.doador.id > 0))
    out.push(r('sem-doador', 'Escolha o doador (pessoa ou empresa do cadastro).', 'doador'));
  if (!TERMO.test(d.termo.trim()))
    out.push(
      r('termo-invalido', 'Informe o número do termo de doação (até 20 letras, dígitos, . / -).', 'termo'),
    );
  if (!DATA.test(d.recebidaEm)) out.push(r('data-invalida', 'Informe a data do recebimento.', 'recebidaEm'));
  else if (d.recebidaEm > d.hoje)
    out.push(r('data-futura', 'A data do recebimento não pode ser futura.', 'recebidaEm'));
  if (!d.itens.length) out.push(r('sem-itens', 'Inclua ao menos um item doado.', 'itens'));
  if (d.itens.length > MAXIMO_ITENS_DOACAO)
    out.push(r('itens-demais', `Um termo de doação leva até ${MAXIMO_ITENS_DOACAO} itens.`, 'itens'));
  if (new Set(d.itens.map((i) => i.item)).size !== d.itens.length)
    out.push(r('item-repetido', 'Cada item entra uma vez no termo (some as quantidades).', 'itens'));
  for (const i of d.itens) {
    const x = conferirItem(i);
    if (x.length) {
      out.push(x[0]!);
      break;
    }
  }
  return out;
}

export interface CustoItemDoacao {
  readonly item: number;
  readonly custoUnitario: number;
  readonly valorTotal: number;
}

/** O custo de cada item doado (unitário pelo critério × quantidade, em reais) e o total do termo, com as parcelas. */
export function custoDaDoacao(itens: readonly ItemDoacaoParaConferir[]): {
  readonly itens: readonly CustoItemDoacao[];
  readonly total: number;
} {
  const linhas = itens.map((i) => {
    const u = custoUnitarioDoacao(i) ?? 0;
    return { item: i.item, custoUnitario: u, valorTotal: reais(u * i.quantidade) };
  });
  return { itens: linhas, total: reais(linhas.reduce((s, l) => s + l.valorTotal, 0)) };
}

/**
 * Os itens cujo valor justo difere do último preço de compra em mais de 50% (para cima ou para baixo): a tela avisa e o
 * usuário confirma; não é recusa, porque o valor justo do termo prevalece (NBC TG 07).
 */
export function avisosValorJusto(itens: readonly ItemDoacaoParaConferir[]): number[] {
  return itens
    .filter(
      (i) =>
        i.criterio === 'valor_justo' &&
        i.valorJusto !== null &&
        i.valorJusto > 0 &&
        i.ultimoPreco !== null &&
        i.ultimoPreco > 0 &&
        Math.abs(i.valorJusto - i.ultimoPreco) / i.ultimoPreco > LIMIAR_AVISO_VALOR_JUSTO,
    )
    .map((i) => i.item);
}

/**
 * A parte doada do saldo depois de um movimento: a entrada doada soma; a saída doada (o estorno de uma doação
 * desfeita) subtrai da parte doada; a saída comum consome primeiro o que não é doado e a parte doada nunca passa do
 * saldo que fica.
 */
export function quantidadeDoadaApos(
  doadaAntes: number,
  saldoApos: number,
  movimento: {
    readonly natureza: 'entrada' | 'saida';
    readonly quantidade: number;
    readonly doacao: boolean;
  },
): number {
  const q = Math.round(
    (movimento.doacao
      ? movimento.natureza === 'entrada'
        ? doadaAntes + movimento.quantidade
        : doadaAntes - movimento.quantidade
      : doadaAntes) * 10_000,
  );
  return Math.max(0, Math.min(q / 10_000, saldoApos));
}

/** Tamanho mínimo do nome para procurar entre os doadores já registrados. */
export const MINIMO_BUSCA_DOADOR = 2;

/**
 * Como a busca do doador pessoa é feita (LGPD, minimização): pelo nome, só entre as pessoas que já doaram ao
 * estabelecimento; uma pessoa nova do cadastro só pelo CPF completo e válido, sem listagem por nome. A empresa é
 * procurada pelo nome ou pelo CNPJ.
 */
export function buscaDoDoador(termo: string): { readonly nome: string | null; readonly cpf: string | null } {
  const t = termo.trim().slice(0, 60);
  const digitos = t.replace(/\D/g, '');
  const soDocumento = /^[\d.\-\s/]+$/.test(t);
  if (soDocumento) return { nome: null, cpf: digitos.length === 11 && cpfValido(digitos) ? digitos : null };
  return { nome: t.length >= MINIMO_BUSCA_DOADOR ? t : null, cpf: null };
}
