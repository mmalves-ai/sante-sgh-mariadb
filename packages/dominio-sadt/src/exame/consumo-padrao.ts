// Consumo padrão de insumos por exame (F8, 05-SADT linha 22): o cadastro diz o que o exame gasta (contraste, seringa,
// filme, kit), por setor executante ou para todos; na realização o executante confere a sugestão, ajusta o que pode e
// o estoque baixa na hora pelo motor do estoque. Regras puras (sem banco):
//   - cadastro: ao menos um item; cada item é produto ou kit (um só); quantidade positiva; nada repetido;
//   - escolha: o consumo do setor do exame vale antes do geral (setor nulo); só o ativo;
//   - kit: vira os produtos dele, quantidade do kit vezes a do produto; o mesmo produto em duas linhas soma;
//   - realização: o ajuste só vale no item ajustável (o não ajustável sai como cadastrado); quantidade zero é "não
//     usado" (só no ajustável); o executante pode tirar da cobrança um item, nunca pôr na conta o que não é cobrável;
//   - conta (prática TISS): só vai o item cobrável fora do pacote; o consumo marcado sem lançamento na conta é pacote
//     (o material já está no preço do exame) e o produto sem item de cobrança ou não cobrável nunca vai; o estoque baixa
//     sempre. Sem atendimento (exame de fora), nada vai à conta.

export interface ItemConsumoPadrao {
  readonly insumo: number | null;
  readonly kit: number | null;
  readonly quantidade: number;
  readonly ajustavel: boolean;
}

export interface RecusaConsumoPadrao {
  readonly campo: string;
  readonly mensagem: string;
}

export const QUANTIDADE_MAXIMA_CONSUMO = 99999;
export const ITENS_MAXIMOS_CONSUMO = 60;

/** Confere os itens do consumo padrão; devolve as recusas (vazia: pode gravar). */
export function conferirConsumoPadrao(itens: readonly ItemConsumoPadrao[]): RecusaConsumoPadrao[] {
  const r: RecusaConsumoPadrao[] = [];
  if (!itens.length) r.push({ campo: 'itens', mensagem: 'Informe ao menos um produto ou kit.' });
  if (itens.length > ITENS_MAXIMOS_CONSUMO)
    r.push({ campo: 'itens', mensagem: `No máximo ${ITENS_MAXIMOS_CONSUMO} itens por consumo padrão.` });
  const vistos = new Set<string>();
  itens.forEach((i, k) => {
    const linha = `Linha ${k + 1}`;
    if ((i.insumo === null) === (i.kit === null))
      r.push({ campo: `itens.${k}`, mensagem: `${linha}: informe o produto ou o kit (um dos dois).` });
    if (!(i.quantidade > 0) || i.quantidade > QUANTIDADE_MAXIMA_CONSUMO)
      r.push({
        campo: `itens.${k}.quantidade`,
        mensagem: `${linha}: a quantidade vai de mais de zero a ${QUANTIDADE_MAXIMA_CONSUMO}.`,
      });
    const chave = i.insumo !== null ? `p${i.insumo}` : `k${i.kit ?? 0}`;
    if (vistos.has(chave))
      r.push({
        campo: `itens.${k}`,
        mensagem: `${linha}: o item já está no consumo; ajuste a quantidade dele.`,
      });
    vistos.add(chave);
  });
  return r;
}

export interface ConsumoPadraoCandidato {
  readonly id: number;
  readonly setor: number | null;
  readonly ativo: boolean;
}

/** O consumo que vale para o exame no setor: o do setor primeiro, senão o geral; nenhum ativo, null. */
export function escolherConsumoPadrao<T extends ConsumoPadraoCandidato>(
  candidatos: readonly T[],
  setor: number | null,
): T | null {
  const ativos = candidatos.filter((c) => c.ativo);
  return (
    (setor !== null ? ativos.find((c) => c.setor === setor) : undefined) ??
    ativos.find((c) => c.setor === null) ??
    null
  );
}

export interface ProdutoDoKit {
  readonly kit: number;
  readonly insumo: number;
  readonly quantidade: number;
}

export interface ProdutoSugerido {
  readonly insumo: number;
  readonly quantidade: number;
  readonly ajustavel: boolean;
}

const q4 = (v: number) => Math.round(v * 10_000) / 10_000;

/**
 * Os produtos do consumo, com o kit aberto (quantidade do kit vezes a do produto). O mesmo produto em duas linhas soma,
 * e fica ajustável se alguma das linhas for. Kit sem produto vivo é recusa de quem chama (aqui, simplesmente some).
 */
export function produtosDoConsumo(
  itens: readonly ItemConsumoPadrao[],
  kits: readonly ProdutoDoKit[],
): ProdutoSugerido[] {
  const saida = new Map<number, { quantidade: number; ajustavel: boolean }>();
  const somar = (insumo: number, quantidade: number, ajustavel: boolean) => {
    const a = saida.get(insumo);
    saida.set(insumo, {
      quantidade: q4((a?.quantidade ?? 0) + quantidade),
      ajustavel: (a?.ajustavel ?? false) || ajustavel,
    });
  };
  for (const i of itens) {
    if (i.insumo !== null) somar(i.insumo, i.quantidade, i.ajustavel);
    else if (i.kit !== null)
      for (const p of kits.filter((x) => x.kit === i.kit))
        somar(p.insumo, i.quantidade * p.quantidade, i.ajustavel);
  }
  return [...saida.entries()].map(([insumo, v]) => ({ insumo, ...v }));
}

export interface ProdutoNaRealizacao extends ProdutoSugerido {
  /** O cadastro do produto: cobrável e com item de cobrança ativo. */
  readonly cobravelNoCadastro: boolean;
}

export interface AjusteRealizacao {
  readonly insumo: number;
  readonly quantidade: number;
  /** false: o executante tira o item da cobrança (o estoque baixa assim mesmo). */
  readonly cobrar?: boolean;
}

export interface BaixaDaRealizacao {
  readonly insumo: number;
  readonly quantidade: number;
  readonly cobravel: boolean;
}

export type ResultadoRealizacao =
  | { readonly ok: true; readonly baixas: BaixaDaRealizacao[] }
  | { readonly ok: false; readonly recusas: RecusaConsumoPadrao[] };

/** O que baixa do estoque e o que vai à conta na realização, com os ajustes do executante. */
export function consumoDaRealizacao(e: {
  readonly produtos: readonly ProdutoNaRealizacao[];
  readonly ajustes: readonly AjusteRealizacao[];
  readonly lancamentoContaAutomatico: boolean;
  readonly comAtendimento: boolean;
}): ResultadoRealizacao {
  const recusas: RecusaConsumoPadrao[] = [];
  const vistos = new Set<number>();
  for (const [k, a] of e.ajustes.entries()) {
    const p = e.produtos.find((x) => x.insumo === a.insumo);
    if (!p)
      recusas.push({ campo: `ajustes.${k}`, mensagem: 'O produto não está no consumo padrão do exame.' });
    else if (vistos.has(a.insumo))
      recusas.push({ campo: `ajustes.${k}`, mensagem: 'O produto foi ajustado duas vezes.' });
    else if (!(a.quantidade >= 0) || a.quantidade > QUANTIDADE_MAXIMA_CONSUMO)
      recusas.push({ campo: `ajustes.${k}.quantidade`, mensagem: 'Quantidade inválida.' });
    else if (!p.ajustavel && q4(a.quantidade) !== q4(p.quantidade))
      recusas.push({
        campo: `ajustes.${k}.quantidade`,
        mensagem: 'Este produto não é ajustável na execução: sai a quantidade do cadastro.',
      });
    vistos.add(a.insumo);
  }
  if (recusas.length) return { ok: false, recusas };
  const baixas: BaixaDaRealizacao[] = [];
  for (const p of e.produtos) {
    const a = e.ajustes.find((x) => x.insumo === p.insumo);
    const quantidade = q4(a ? a.quantidade : p.quantidade);
    if (quantidade <= 0) continue;
    baixas.push({
      insumo: p.insumo,
      quantidade,
      cobravel:
        e.comAtendimento && e.lancamentoContaAutomatico && p.cobravelNoCadastro && a?.cobrar !== false,
    });
  }
  if (!baixas.length)
    return {
      ok: false,
      recusas: [{ campo: 'ajustes', mensagem: 'Nada a baixar: todos os produtos ficaram sem uso.' }],
    };
  return { ok: true, baixas };
}
