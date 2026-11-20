// Regras do consignado (ficha do M46, etapa 4; regra 10; cap-06a §6.4): o saldo por fornecedor e item a partir dos
// movimentos do novo e do consumo em sala do OPME consignado; a remessa (o item do OPME ou de referência consignada, o
// lote ou a série, a validade); a reposição e o faturamento ligados a consumos do mesmo fornecedor e item, cada um uma
// vez; a devolução ao fornecedor até o saldo; o indicador do consumo sem reposição ou sem faturamento. O controle de
// consignados do estoque não é ligado: a saída acima do saldo é a regra do gatilho da saída (a referência do item
// consignada), lida no catálogo do banco, e só ela vale. Funções puras: a gravação confere de novo na transação.
import type {
  ConsumoConsignado,
  IndicadorConsignado,
  SaldoConsignado,
  TipoMovimentoConsignado,
} from '../consignado.js';
import { CLASSE_OPME } from '../opme-vocabulario.js';
import { qtd3, recusa, type RecusaSuprimentos } from './recusa.js';

// ── Saldo ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MovimentoParaSaldo {
  readonly fornecedor: number;
  readonly item: number;
  readonly tipo: TipoMovimentoConsignado;
  readonly quantidade: number;
}

export interface ConsumoParaSaldo {
  readonly fornecedor: number | null;
  readonly item: number;
  /** A quantidade líquida (consumida menos devolvida ao estoque). */
  readonly quantidade: number;
  readonly reposto: boolean;
  readonly faturado: boolean;
}

const chaveFi = (f: number, i: number) => `${f}:${i}`;

/** Regra 10: o saldo por fornecedor e item = remessas + reposições − consumos líquidos − devoluções ao fornecedor. */
export function saldoConsignado(
  movimentos: readonly MovimentoParaSaldo[],
  consumos: readonly ConsumoParaSaldo[],
): Omit<SaldoConsignado, 'fornecedorNome' | 'itemNome' | 'saldoCadastro'>[] {
  const m = new Map<
    string,
    {
      fornecedor: number;
      item: number;
      remessas: number;
      reposicoes: number;
      consumidos: number;
      devolvidos: number;
      aRepor: number;
      aFaturar: number;
    }
  >();
  const de = (f: number, i: number) => {
    const k = chaveFi(f, i);
    let x = m.get(k);
    if (!x) {
      x = {
        fornecedor: f,
        item: i,
        remessas: 0,
        reposicoes: 0,
        consumidos: 0,
        devolvidos: 0,
        aRepor: 0,
        aFaturar: 0,
      };
      m.set(k, x);
    }
    return x;
  };
  for (const v of movimentos) {
    const x = de(v.fornecedor, v.item);
    if (v.tipo === 'remessa') x.remessas = qtd3(x.remessas + v.quantidade);
    else if (v.tipo === 'reposicao') x.reposicoes = qtd3(x.reposicoes + v.quantidade);
    else if (v.tipo === 'devolucao') x.devolvidos = qtd3(x.devolvidos + v.quantidade);
  }
  for (const c of consumos) {
    if (c.fornecedor === null || !(c.quantidade > 0)) continue;
    const x = de(c.fornecedor, c.item);
    x.consumidos = qtd3(x.consumidos + c.quantidade);
    if (!c.reposto) x.aRepor += 1;
    if (!c.faturado) x.aFaturar += 1;
  }
  return [...m.values()]
    .map((x) => ({ ...x, saldo: qtd3(x.remessas + x.reposicoes - x.consumidos - x.devolvidos) }))
    .sort((a, b) => a.fornecedor - b.fornecedor || a.item - b.item);
}

// ── Remessa ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RemessaParaConferir {
  /** A classe do item no cadastro (null: o item não existe). */
  readonly classeItem: number | null;
  /** A referência do item está marcada como consignada no cadastro. */
  readonly referenciaConsignada: boolean;
  readonly fornecedorExiste: boolean;
  readonly quantidade: number;
  readonly lote: string | null;
  readonly serie: string | null;
  readonly validade: string | null;
  readonly emissao: string;
  readonly hoje: string;
}

/** A remessa em consignação: o item de OPME ou de referência consignada, do fornecedor do cadastro, rastreável. */
export function conferirRemessaConsignado(r: RemessaParaConferir): RecusaSuprimentos[] {
  const x: RecusaSuprimentos[] = [];
  if (!r.fornecedorExiste)
    x.push(recusa('fornecedor-inexistente', 'O fornecedor não está no cadastro.', ['fornecedor']));
  if (r.classeItem === null) x.push(recusa('item-inexistente', 'O item não está no cadastro.', ['item']));
  else if (r.classeItem !== CLASSE_OPME && !r.referenciaConsignada)
    x.push(
      recusa(
        'item-nao-consignavel',
        'Só o material de OPME ou de referência consignada no cadastro de itens entra em consignação.',
        ['item'],
      ),
    );
  if (!(r.quantidade > 0))
    x.push(recusa('quantidade-invalida', 'A quantidade tem de ser maior que zero.', ['quantidade']));
  if (!r.lote && !r.serie)
    x.push(recusa('sem-rastreio', 'Informe o lote ou o número de série do material.', ['lote']));
  if (r.validade && r.validade < r.hoje)
    x.push(recusa('validade-no-passado', 'A validade do material já passou.', ['validade']));
  if (r.emissao > r.hoje)
    x.push(
      recusa('emissao-futura', 'A emissão da nota de remessa não pode ser depois de hoje.', ['nfEmissao']),
    );
  return x;
}

/** Alerta (não recusa): o item consignado só sai acima do saldo do estoque se a referência dele for consignada. */
export function avisoReferenciaConsignado(referenciaConsignada: boolean): string | null {
  return referenciaConsignada
    ? null
    : 'A referência deste item não está marcada como consignada no cadastro de itens: a saída em sala precisa de saldo no estoque.';
}

// ── Reposição, faturamento e devolução ao fornecedor ───────────────────────────────────────────────────────────

export interface ConsumoParaRepor {
  readonly consumo: number;
  readonly fornecedor: number | null;
  readonly item: number;
  readonly quantidade: number;
  readonly reposto: boolean;
  readonly faturado: boolean;
}

export interface ReposicaoParaConferir {
  readonly tipo: 'reposicao' | 'faturamento' | 'devolucao';
  readonly fornecedor: number;
  readonly item: number;
  /** Os consumos pedidos (relidos; null: o consumo não existe ou não é consignado). */
  readonly consumos: readonly (ConsumoParaRepor | null)[];
  /** Devolução: a quantidade e o saldo atual do fornecedor e item. */
  readonly quantidade: number | null;
  readonly saldo: number;
  /** Faturamento: a nota fiscal de entrada relida (null: não existe). */
  readonly nf: { readonly fornecedor: number; readonly temItem: boolean } | null;
  readonly motivo: string | null;
}

/** A reposição e o faturamento cobrem consumos do mesmo fornecedor e item, uma vez cada; a devolução, até o saldo. */
export function conferirReposicaoConsignado(r: ReposicaoParaConferir): RecusaSuprimentos[] {
  const x: RecusaSuprimentos[] = [];
  if (r.tipo === 'devolucao') {
    if (!(r.quantidade !== null && r.quantidade > 0))
      x.push(recusa('quantidade-invalida', 'A quantidade tem de ser maior que zero.', ['quantidade']));
    else if (r.quantidade > r.saldo)
      x.push(
        recusa(
          'acima-do-saldo',
          `O saldo em consignação deste fornecedor e item é ${r.saldo}: não dá para devolver mais que isso.`,
          ['quantidade'],
        ),
      );
    if ((r.motivo ?? '').trim().length < 10)
      x.push(
        recusa('sem-motivo', 'Escreva o motivo da devolução ao fornecedor (ao menos 10 caracteres).', [
          'motivo',
        ]),
      );
    return x;
  }
  if (r.consumos.length === 0)
    x.push(recusa('sem-consumo', 'Escolha os consumos em sala que esta operação cobre.', ['consumos']));
  const vistos = new Set<number>();
  for (const c of r.consumos) {
    if (!c) {
      x.push(
        recusa('consumo-inexistente', 'Um dos consumos não existe ou não é de material consignado.', [
          'consumos',
        ]),
      );
      continue;
    }
    if (vistos.has(c.consumo))
      x.push(recusa('consumo-repetido', 'O mesmo consumo foi escolhido duas vezes.', ['consumos']));
    vistos.add(c.consumo);
    if (c.fornecedor !== r.fornecedor || c.item !== r.item)
      x.push(
        recusa('consumo-de-outro-fornecedor', 'Um dos consumos é de outro fornecedor ou de outro item.', [
          'consumos',
        ]),
      );
    if (!(c.quantidade > 0))
      x.push(
        recusa('consumo-devolvido', 'Um dos consumos foi devolvido inteiro ao estoque: não há o que repor.', [
          'consumos',
        ]),
      );
    if (r.tipo === 'reposicao' && c.reposto)
      x.push(recusa('consumo-ja-reposto', 'Um dos consumos já foi reposto pelo fornecedor.', ['consumos']));
    if (r.tipo === 'faturamento' && c.faturado)
      x.push(recusa('consumo-ja-faturado', 'Um dos consumos já foi faturado.', ['consumos']));
  }
  if (r.tipo === 'faturamento') {
    if (!r.nf)
      x.push(recusa('nf-inexistente', 'A nota fiscal não está nas entradas do estoque.', ['nfEntrada']));
    else {
      if (r.nf.fornecedor !== r.fornecedor)
        x.push(recusa('nf-de-outro-fornecedor', 'A nota fiscal é de outro fornecedor.', ['nfEntrada']));
      if (!r.nf.temItem)
        x.push(recusa('nf-sem-item', 'A nota fiscal não tem o item consignado.', ['nfEntrada']));
    }
  }
  return x;
}

// ── Indicador e alertas ─────────────────────────────────────────────────────────────────────────────────────────

const diasEntre = (de: string, ate: string) =>
  Math.floor(
    (Date.parse(`${ate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${de.slice(0, 10)}T00:00:00Z`)) / 86_400_000,
  );

/** O consumo consignado está atrasado: sem reposição ou sem faturamento depois dos dias do alerta. */
export function consumoConsignadoAtrasado(c: ConsumoConsignado, hoje: string, diasAlerta: number): boolean {
  return (c.reposicao === null || c.faturamento === null) && diasEntre(c.em, hoje) > diasAlerta;
}

/** O indicador "consumo consignado sem faturamento", com o numerador e o denominador. */
export function indicadorConsignado(
  consumos: readonly ConsumoConsignado[],
  hoje: string,
  diasAlerta: number,
): IndicadorConsignado {
  const validos = consumos.filter((c) => c.quantidade > 0);
  return {
    consumos: validos.length,
    semReposicao: validos.filter((c) => c.reposicao === null).length,
    semFaturamento: validos.filter((c) => c.faturamento === null).length,
    atrasados: validos.filter((c) => consumoConsignadoAtrasado(c, hoje, diasAlerta)).length,
    diasAlerta,
  };
}
