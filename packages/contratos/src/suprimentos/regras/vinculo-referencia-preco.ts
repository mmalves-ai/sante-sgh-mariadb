// F3.6 (05-SUP linha 28): vínculo do item do estoque com o item das referências de preço de material e medicamento
// (código, edição e fator de conversão). O vínculo é uma linha do tempo por item E por publicação (fonte): o item fica
// ligado ao mesmo tempo a mais de uma tabela de referência (uma por publicação), e a conta escolhe a da tabela de preço
// da operadora. Dentro da mesma publicação, um vínculo vale de cada vez: o novo fecha o anterior na véspera (o histórico
// fica, nada é apagado). Nem o início do novo nem o fim de um encerramento caem antes de hoje (data do servidor), nem o
// início antes do último da publicação: o preço das contas já lançadas não se reescreve. A troca para a mesma referência
// com o mesmo fator é recusada (nada muda). O fator diz quantas unidades de estoque equivalem a uma da referência.
import { recusa, type RecusaSuprimentos } from './recusa.js';

export const FATOR_REFERENCIA_MAXIMO = 1_000_000;

export interface VinculoReferenciaPrecoVigencia {
  readonly id: number;
  readonly referencia: number;
  /** A publicação (fonte) da referência: a linha do tempo é por publicação. */
  readonly fonte: string;
  readonly fator: number;
  readonly inicio: string;
  readonly fim: string | null;
}

/** O que a regra precisa além da entrada: a publicação da referência escolhida e a data de hoje do servidor. */
export interface ContextoVinculoReferencia {
  readonly fonte: string;
  readonly hoje: string;
}

export interface VincularReferenciaPrecoEntrada {
  readonly referencia: number;
  readonly edicao: number | null;
  readonly fator: number;
  readonly inicio: string;
}

export interface PlanoVinculoReferenciaPreco {
  readonly recusas: readonly RecusaSuprimentos[];
  /** Os vínculos que se sobrepõem ao novo e fecham na véspera do início dele. */
  readonly encerrar: readonly { readonly id: number; readonly fim: string }[];
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(d: string): boolean {
  if (!DATA.test(d)) return false;
  const x = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
}

/** A véspera de uma data ISO (AAAA-MM-DD). */
export function vespera(d: string): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}

/** O fator aceito: positivo, até o máximo e com no máximo 8 casas (DECIMAL(20,8)). */
export function fatorReferenciaValido(f: number): boolean {
  return (
    Number.isFinite(f) &&
    f > 0 &&
    f <= FATOR_REFERENCIA_MAXIMO &&
    Math.abs(f * 1e8 - Math.round(f * 1e8)) < 1e-6
  );
}

/** Confere o novo vínculo contra a linha do tempo da mesma publicação e diz quais vínculos dela fecham. */
export function planejarVinculoReferenciaPreco(
  e: VincularReferenciaPrecoEntrada,
  todos: readonly VinculoReferenciaPrecoVigencia[],
  ctx: ContextoVinculoReferencia,
): PlanoVinculoReferenciaPreco {
  const recusas: RecusaSuprimentos[] = [];
  if (!fatorReferenciaValido(e.fator))
    recusas.push(
      recusa(
        'fator-invalido',
        `O fator de conversão precisa ser maior que zero, até ${FATOR_REFERENCIA_MAXIMO}, com no máximo 8 casas.`,
        ['fator'],
      ),
    );
  if (!dataValida(e.inicio)) {
    recusas.push(recusa('data-invalida', 'Informe a data de início do vínculo.', ['inicio']));
    return { recusas, encerrar: [] };
  }
  const linha = todos.filter((v) => v.fonte === ctx.fonte);
  const ultimo = linha.reduce<VinculoReferenciaPrecoVigencia | null>(
    (a, v) => (a === null || v.inicio > a.inicio ? v : a),
    null,
  );
  if (e.inicio < ctx.hoje)
    recusas.push(
      recusa(
        'vinculo-retroativo',
        `O vínculo não pode começar antes de hoje (${ctx.hoje}): o preço das contas já lançadas não se reescreve.`,
        ['inicio'],
      ),
    );
  else if (ultimo && e.inicio <= ultimo.inicio)
    recusas.push(
      recusa(
        'vinculo-retroativo',
        `O vínculo precisa começar depois de ${ultimo.inicio}, o início do último vínculo desta publicação (o histórico não se reescreve).`,
        ['inicio'],
      ),
    );
  const abertos = linha.filter((v) => v.fim === null || v.fim >= e.inicio);
  const vigente = abertos.find((v) => v.fim === null) ?? null;
  if (vigente && vigente.referencia === e.referencia && Math.abs(vigente.fator - e.fator) < 1e-9)
    recusas.push(
      recusa('vinculo-sem-mudanca', 'O item já está ligado a esta referência com o mesmo fator.', [
        'referencia',
      ]),
    );
  if (recusas.length) return { recusas, encerrar: [] };
  return { recusas, encerrar: abertos.map((v) => ({ id: v.id, fim: vespera(e.inicio) })) };
}

/** Confere o encerramento do vínculo vigente na data dada (nunca antes de hoje, nunca antes do início). */
export function conferirEncerramentoVinculoReferencia(
  v: VinculoReferenciaPrecoVigencia,
  fim: string,
  hoje: string,
): readonly RecusaSuprimentos[] {
  if (!dataValida(fim)) return [recusa('data-invalida', 'Informe a data de fim do vínculo.', ['fim'])];
  if (v.fim !== null) return [recusa('vinculo-ja-encerrado', `O vínculo já terminou em ${v.fim}.`, ['fim'])];
  if (fim < v.inicio)
    return [
      recusa('vigencia-invalida', `O fim não pode ser antes do início do vínculo (${v.inicio}).`, ['fim']),
    ];
  if (fim < hoje)
    return [
      recusa(
        'encerramento-retroativo',
        `O vínculo não pode terminar antes de hoje (${hoje}): o preço das contas já lançadas não se reescreve.`,
        ['fim'],
      ),
    ];
  return [];
}

/**
 * O vínculo que a conta usa entre os vigentes na data do lançamento (um por publicação): o da mesma referência do item
 * faturável, senão o da publicação da tabela de preço da conta, senão o de início mais recente. Uma só fonte da
 * verdade: o vínculo do insumo manda; a referência do item faturável só vale quando o insumo não tem vínculo vigente.
 */
export function escolherVinculoDaConta<
  V extends Pick<VinculoReferenciaPrecoVigencia, 'id' | 'referencia' | 'fonte' | 'inicio'>,
>(
  vigentes: readonly V[],
  criterio: { readonly referenciaDoFaturavel: number | null; readonly fonteDaTabela: string | null },
): V | null {
  if (!vigentes.length) return null;
  const mesmaRef = vigentes.find((v) => v.referencia === criterio.referenciaDoFaturavel);
  if (mesmaRef) return mesmaRef;
  const fonte = criterio.fonteDaTabela?.trim().toLowerCase() ?? null;
  const ordenados = [...vigentes].sort((a, b) =>
    a.inicio === b.inicio ? b.id - a.id : a.inicio < b.inicio ? 1 : -1,
  );
  return ordenados.find((v) => fonte !== null && v.fonte.toLowerCase() === fonte) ?? ordenados[0] ?? null;
}

/**
 * O fator sugerido na tela: 1 quando a unidade da referência é a do estoque; o fator da unidade do item quando a
 * referência usa uma unidade que o item tem cadastrada; senão nenhum (o usuário informa).
 */
export function fatorSugeridoReferencia(
  unidadeEstoque: number | null,
  unidadeReferencia: number | null,
  unidadesDoItem: readonly { readonly unidade: number; readonly fator: number }[],
): number | null {
  if (unidadeReferencia === null) return null;
  if (unidadeReferencia === unidadeEstoque) return 1;
  const u = unidadesDoItem.find((x) => x.unidade === unidadeReferencia && x.fator > 0);
  return u ? u.fator : null;
}
