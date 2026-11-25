// C1-124 (05-SUP linha 12): produção interna da farmácia e da central (manipulação de quimioterapia e nutrição
// parenteral, kit montado). Regras puras: o fechamento da ordem baixada vira o lote produzido (quantidade, perda,
// validade com hora, custos indiretos do lote) e o kit montado consome a composição do kit padrão e entra no estoque
// como lote próprio, com validade nunca acima da do componente que vence primeiro (boa prática de preparo estéril).
import type { RecusaSuprimentos } from './recusa.js';

export const TIPOS_LOTE_PRODUZIDO = ['manipulacao', 'kit_montado'] as const;
export type TipoLoteProduzido = (typeof TIPOS_LOTE_PRODUZIDO)[number];

/** Rendimento aceito acima do previsto (a sobra de bolsa e o volume de enchimento): 10%. */
export const TOLERANCIA_RENDIMENTO = 0.1;
/** Quantos kits se montam de uma vez (a montagem é de bancada). */
export const MAXIMO_KITS_POR_MONTAGEM = 500;
const NUMERO_LOTE = /^[A-Za-z0-9._/-]{1,50}$/;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const r = (codigo: string, mensagem: string, ...campos: string[]): RecusaSuprimentos => ({
  codigo,
  mensagem,
  ...(campos.length ? { campos } : {}),
});

export interface CustoIndiretoDoLote {
  readonly custo: number;
  readonly quantidade: number;
  readonly valorUnitario: number;
}

function conferirCustos(custos: readonly CustoIndiretoDoLote[]): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (new Set(custos.map((c) => c.custo)).size !== custos.length)
    out.push(r('custo-repetido', 'Cada custo indireto entra uma vez no lote.', 'custos'));
  if (custos.some((c) => !(c.quantidade > 0) || !(c.valorUnitario >= 0)))
    out.push(
      r('custo-invalido', 'O custo indireto pede quantidade maior que zero e valor não negativo.', 'custos'),
    );
  return out;
}

function conferirValidade(produzidoEm: string, validadeEm: string): RecusaSuprimentos[] {
  if (!INSTANTE.test(validadeEm) || !INSTANTE.test(produzidoEm))
    return [r('validade-invalida', 'Informe a validade com data e hora.', 'validadeEm')];
  if (validadeEm <= produzidoEm)
    return [r('validade-invalida', 'A validade do lote tem de ser depois da produção.', 'validadeEm')];
  return [];
}

function conferirNumeroLote(numero: string | null): RecusaSuprimentos[] {
  return numero !== null && !NUMERO_LOTE.test(numero)
    ? [r('numero-lote-invalido', 'O número do lote aceita letras, dígitos e . _ / - (até 50).', 'numeroLote')]
    : [];
}

export interface FechamentoParaConferir {
  readonly situacao: string;
  readonly jaTemLote: boolean;
  readonly quantidadePrevista: number;
  readonly quantidadeProduzida: number;
  readonly perda: number;
  /** AAAA-MM-DDTHH:mm */
  readonly produzidoEm: string;
  readonly validadeEm: string;
  readonly numeroLote: string | null;
  readonly custos: readonly CustoIndiretoDoLote[];
}

/** O fechamento da ordem: só a baixada (insumo já saiu do estoque) e uma vez; quantidades, validade e custos. */
export function conferirFechamentoProducao(f: FechamentoParaConferir): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (f.situacao !== 'baixada')
    out.push(r('ordem-nao-baixada', 'Só a ordem com o insumo baixado fecha a produção.', 'ordem'));
  if (f.jaTemLote) out.push(r('producao-ja-fechada', 'A produção desta ordem já tem lote.', 'ordem'));
  if (!(f.quantidadeProduzida > 0))
    out.push(
      r('quantidade-invalida', 'A quantidade produzida tem de ser maior que zero.', 'quantidadeProduzida'),
    );
  if (!(f.perda >= 0)) out.push(r('perda-invalida', 'A perda não pode ser negativa.', 'perda'));
  else if (
    f.quantidadeProduzida > 0 &&
    f.quantidadeProduzida + f.perda > f.quantidadePrevista * (1 + TOLERANCIA_RENDIMENTO) + 1e-9
  )
    out.push(
      r(
        'rendimento-acima',
        `Produzido mais perda (${f.quantidadeProduzida + f.perda}) passa de ${f.quantidadePrevista} previstos mais ${TOLERANCIA_RENDIMENTO * 100}%.`,
        'quantidadeProduzida',
      ),
    );
  out.push(...conferirValidade(f.produzidoEm, f.validadeEm));
  out.push(...conferirNumeroLote(f.numeroLote));
  out.push(...conferirCustos(f.custos));
  return out;
}

export interface CustoDoLote {
  readonly custos: readonly (CustoIndiretoDoLote & { readonly valorTotal: number })[];
  readonly valorIndireto: number;
  /** Insumos + indiretos + adicional (2 casas). */
  readonly valorTotal: number;
  /** Por unidade produzida (4 casas). */
  readonly custoUnitario: number;
}

const reais = (v: number) => Math.round(v * 100) / 100;

/** O custo do lote: o valor dos insumos baixados, os custos indiretos (quantidade × valor) e o adicional. */
export function custoDoLote(
  valorInsumos: number,
  custos: readonly CustoIndiretoDoLote[],
  valorAdicional: number,
  quantidadeProduzida: number,
): CustoDoLote {
  const linhas = custos.map((c) => ({ ...c, valorTotal: reais(c.quantidade * c.valorUnitario) }));
  const valorIndireto = reais(linhas.reduce((s, c) => s + c.valorTotal, 0));
  const valorTotal = reais(valorInsumos + valorIndireto + valorAdicional);
  return {
    custos: linhas,
    valorIndireto,
    valorTotal,
    custoUnitario:
      quantidadeProduzida > 0 ? Math.round((valorTotal / quantidadeProduzida) * 10_000) / 10_000 : 0,
  };
}

/** O número do lote gerado: MP (manipulação) ou KT (kit), a data e a sequência do estabelecimento. */
export function numeroLoteProduzido(tipo: TipoLoteProduzido, dia: string, sequencia: number): string {
  return `${tipo === 'manipulacao' ? 'MP' : 'KT'}-${dia.replace(/-/g, '')}-${String(sequencia).padStart(4, '0')}`;
}

export interface ComponenteDoKit {
  readonly insumo: number;
  readonly nome: string;
  /** Por kit. */
  readonly quantidade: number;
  /** No local da montagem. */
  readonly saldo: number;
}

export interface MontagemParaConferir {
  readonly kitAtivo: boolean;
  readonly produto: number;
  readonly componentes: readonly ComponenteDoKit[];
  readonly quantidadeKits: number;
  readonly produzidoEm: string;
  readonly validadeEm: string;
  readonly numeroLote: string | null;
  readonly custos: readonly CustoIndiretoDoLote[];
}

/** O consumo da montagem: a quantidade de cada componente vezes os kits. */
export function consumoDaMontagem(
  componentes: readonly ComponenteDoKit[],
  quantidadeKits: number,
): { insumo: number; quantidade: number }[] {
  return componentes.map((c) => ({
    insumo: c.insumo,
    quantidade: Math.round(c.quantidade * quantidadeKits * 10_000) / 10_000,
  }));
}

/** A montagem: kit ativo com composição, o produto fora da composição, kits inteiros e o saldo de cada componente. */
export function conferirMontagemKit(m: MontagemParaConferir): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (!m.kitAtivo) out.push(r('kit-inativo', 'O kit padrão está inativo.', 'kit'));
  if (!m.componentes.length) out.push(r('kit-sem-itens', 'O kit padrão não tem composição.', 'kit'));
  if (m.componentes.some((c) => c.insumo === m.produto))
    out.push(r('produto-no-kit', 'O produto do kit não pode ser um dos componentes.', 'produto'));
  if (
    !Number.isInteger(m.quantidadeKits) ||
    m.quantidadeKits < 1 ||
    m.quantidadeKits > MAXIMO_KITS_POR_MONTAGEM
  )
    out.push(
      r(
        'quantidade-invalida',
        `Monte de 1 a ${MAXIMO_KITS_POR_MONTAGEM} kits inteiros por vez.`,
        'quantidadeKits',
      ),
    );
  else {
    const faltam = consumoDaMontagem(m.componentes, m.quantidadeKits).filter(
      (u, i) => u.quantidade > m.componentes[i]!.saldo + 1e-9,
    );
    if (faltam.length)
      out.push(
        r(
          'saldo-insuficiente',
          `Sem saldo no local para ${faltam.length} componente(s): ${faltam
            .map((u) => m.componentes.find((c) => c.insumo === u.insumo)!.nome)
            .join(', ')}.`,
          'quantidadeKits',
        ),
      );
  }
  out.push(...conferirValidade(m.produzidoEm, m.validadeEm));
  out.push(...conferirNumeroLote(m.numeroLote));
  out.push(...conferirCustos(m.custos));
  return out;
}

/** A validade do kit não passa da do lote do componente que vence primeiro (validades AAAA-MM-DD; fim do dia). */
export function conferirValidadeDoKit(
  validadeEm: string,
  validadesDosLotes: readonly string[],
): RecusaSuprimentos[] {
  if (!validadesDosLotes.length) return [];
  const menor = [...validadesDosLotes].sort()[0]!;
  return validadeEm.slice(0, 10) > menor
    ? [
        r(
          'validade-acima-componente',
          `A validade do kit passa da do componente que vence primeiro (${menor}).`,
          'validadeEm',
        ),
      ]
    : [];
}
