// F3.6 (05-SUP linha 28): vínculo do item do estoque com o item das referências de preço de material e medicamento
// (código, edição e fator de conversão). O vínculo é uma linha do tempo por item: um vínculo vale de cada vez; o novo
// fecha a vigência do anterior na véspera (o histórico fica, nada é apagado) e nunca começa antes do último, para não
// reescrever o preço das contas já calculadas. A troca para a mesma referência com o mesmo fator é recusada (nada
// muda). O fator diz quantas unidades de estoque do item equivalem a uma unidade da referência.
import { recusa, type RecusaSuprimentos } from './recusa.js';

export const FATOR_REFERENCIA_MAXIMO = 1_000_000;

export interface VinculoReferenciaPrecoVigencia {
  readonly id: number;
  readonly referencia: number;
  readonly fator: number;
  readonly inicio: string;
  readonly fim: string | null;
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

/** Confere o novo vínculo contra a linha do tempo do item e diz quais vínculos fecham. */
export function planejarVinculoReferenciaPreco(
  e: VincularReferenciaPrecoEntrada,
  linha: readonly VinculoReferenciaPrecoVigencia[],
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
  const ultimo = linha.reduce<VinculoReferenciaPrecoVigencia | null>(
    (a, v) => (a === null || v.inicio > a.inicio ? v : a),
    null,
  );
  if (ultimo && e.inicio <= ultimo.inicio)
    recusas.push(
      recusa(
        'vinculo-retroativo',
        `O vínculo precisa começar depois de ${ultimo.inicio}, o início do último vínculo do item (o histórico não se reescreve).`,
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

/** Confere o encerramento do vínculo vigente na data dada. */
export function conferirEncerramentoVinculoReferencia(
  v: VinculoReferenciaPrecoVigencia,
  fim: string,
): readonly RecusaSuprimentos[] {
  if (!dataValida(fim)) return [recusa('data-invalida', 'Informe a data de fim do vínculo.', ['fim'])];
  if (v.fim !== null) return [recusa('vinculo-ja-encerrado', `O vínculo já terminou em ${v.fim}.`, ['fim'])];
  if (fim < v.inicio)
    return [
      recusa('vigencia-invalida', `O fim não pode ser antes do início do vínculo (${v.inicio}).`, ['fim']),
    ];
  return [];
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
