// Lote e validade (ficha do M28, regra 8): no item rastreável, a soma por lote é a quantidade do item (o gatilho
// recusa com `e_geral_est_qtde_lote`); a saída sugere o lote que vence primeiro; lote vencido ou interditado não sai pelo
// novo; na entrada, a validade é obrigatória e não pode estar no passado (regra só do novo).
import { qtd3, recusa, type RecusaSuprimentos } from './recusa.js';

export interface LoteDisponivel {
  readonly id: number;
  readonly lote: string;
  /** AAAA-MM-DD. */
  readonly validade: string;
  readonly saldo: number;
  readonly interditado?: boolean;
}

export interface LoteEscolhido {
  readonly lote: string;
  readonly validade: string;
  readonly quantidade: number;
}

/** Validades com dígitos trocados (ano antes de 1990 ou depois de 2099) entram no saneamento, nunca na sugestão. */
export function validadeSuspeita(validade: string): boolean {
  const ano = Number(validade.slice(0, 4));
  return !Number.isFinite(ano) || ano < 1990 || ano > 2099;
}

/** Vencido no dia `hoje` (a validade é o último dia de uso). */
export const vencido = (validade: string, hoje: string): boolean => validade < hoje;

/** Sugestão FEFO: os lotes não vencidos nem interditados, do que vence primeiro, até cobrir a quantidade. */
export function sugerirLotes(
  lotes: readonly LoteDisponivel[],
  quantidade: number,
  hoje: string,
): LoteEscolhido[] {
  const usaveis = lotes
    .filter(
      (l) => l.saldo > 0 && !l.interditado && !vencido(l.validade, hoje) && !validadeSuspeita(l.validade),
    )
    .sort((a, b) => a.validade.localeCompare(b.validade) || a.id - b.id);
  const r: LoteEscolhido[] = [];
  let falta = qtd3(quantidade);
  for (const l of usaveis) {
    if (falta <= 0) break;
    const q = qtd3(Math.min(falta, l.saldo));
    r.push({ lote: l.lote, validade: l.validade, quantidade: q });
    falta = qtd3(falta - q);
  }
  return r;
}

/** Os lotes escolhidos para a saída do item rastreável: a soma, a existência, o saldo, o vencimento e a interdição. */
export function conferirLotesSaida(
  quantidade: number,
  escolhidos: readonly LoteEscolhido[],
  disponiveis: readonly LoteDisponivel[],
  hoje: string,
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  const soma = qtd3(escolhidos.reduce((s, l) => s + l.quantidade, 0));
  if (soma !== qtd3(quantidade))
    r.push(
      recusa('soma-dos-lotes', 'A soma das quantidades por lote tem de ser igual à quantidade do item.', [
        'lotes',
      ]),
    );
  for (const e of escolhidos) {
    const d = disponiveis.find((x) => x.lote === e.lote && x.validade === e.validade);
    if (!d) {
      r.push(recusa('lote-inexistente', `O lote ${e.lote} não tem saldo neste local.`, ['lotes']));
      continue;
    }
    if (d.interditado) r.push(recusa('lote-interditado', `O lote ${e.lote} está interditado.`, ['lotes']));
    else if (vencido(d.validade, hoje))
      r.push(recusa('lote-vencido', `O lote ${e.lote} está vencido: não sai pelo sistema.`, ['lotes']));
    if (qtd3(e.quantidade) > qtd3(d.saldo))
      r.push(recusa('saldo-do-lote', `O lote ${e.lote} não tem a quantidade pedida.`, ['lotes']));
  }
  return r;
}

/** A entrada do lote (nota fiscal): lote e validade obrigatórios, validade não passada e plausível. */
export function conferirLoteEntrada(l: Partial<LoteEscolhido>, hoje: string): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!(l.lote ?? '').trim()) r.push(recusa('sem-lote', 'Informe o lote.', ['lotes']));
  if (!l.validade || !/^\d{4}-\d{2}-\d{2}$/.test(l.validade))
    r.push(recusa('sem-validade', 'Informe a validade do lote.', ['lotes']));
  else if (vencido(l.validade, hoje))
    r.push(
      recusa(
        'validade-no-passado',
        'A validade do lote já passou: a nota não pode entrar com lote vencido.',
        ['lotes'],
      ),
    );
  else if (validadeSuspeita(l.validade))
    r.push(recusa('validade-suspeita', 'A validade do lote parece digitada errada.', ['lotes']));
  return r;
}

/** Validade a corrigir no saneamento (P2): a suspeita e a nova não suspeita. */
export function conferirCorrecaoValidade(atual: string, nova: string): RecusaSuprimentos | null {
  if (!validadeSuspeita(atual))
    return recusa('validade-correta', 'Só a validade com digitação suspeita entra no saneamento.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nova) || validadeSuspeita(nova))
    return recusa('validade-invalida', 'A nova validade é inválida.', ['validade']);
  return null;
}

/** Dias até vencer (negativo: vencido). */
export function diasParaVencer(validade: string, hoje: string): number {
  return Math.round((Date.parse(`${validade}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86_400_000);
}
