// Orçamento particular de exames (ficha do M26, regra 13; cap-05b §5.10): orçamento com validade; convertido, vira
// lançamento no atendimento com os mesmos exames e os mesmos valores aprovados. O legado guarda o cabeçalho (um por
// paciente e setor) e os itens com o valor; a validade e a conversão ficam no novo (SGH_SADT_ORCAMENTO).
import type { SituacaoOrcamento } from '@sgh/contratos';

export interface ItemOrcamento {
  readonly exame: string;
  readonly valor: number;
}

/** O valor com as 2 casas do legado (o mesmo tipo numérico: NUMERIC(15,2)). */
export function valorDoLegado(v: number): number {
  return Math.round(v * 100) / 100;
}

/** O total do orçamento (soma das parcelas com 2 casas). */
export function totalDoOrcamento(itens: readonly ItemOrcamento[]): number {
  return valorDoLegado(itens.reduce((a, i) => a + valorDoLegado(i.valor), 0));
}

/** A data de validade (AAAA-MM-DD) a partir da data do orçamento e dos dias de validade. */
export function validadeDoOrcamento(data: string, dias: number): string {
  const t = Date.parse(`${data.slice(0, 10)}T00:00:00Z`) + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Situação: convertido; vencido depois da validade; aberto. */
export function situacaoDoOrcamento(o: {
  readonly validade: string;
  readonly convertido: boolean;
  readonly hoje: string;
}): SituacaoOrcamento {
  if (o.convertido) return 'convertido';
  return o.hoje.slice(0, 10) > o.validade.slice(0, 10) ? 'vencido' : 'aberto';
}

/** Os itens do lançamento da conversão: os mesmos exames, na mesma ordem, com os mesmos valores. */
export function itensDaConversao(itens: readonly ItemOrcamento[]): readonly ItemOrcamento[] {
  const vistos = new Set<string>();
  const r: ItemOrcamento[] = [];
  for (const i of itens) {
    const k = i.exame.trim();
    if (vistos.has(k)) continue;
    vistos.add(k);
    r.push({ exame: k, valor: valorDoLegado(i.valor) });
  }
  return r;
}

/** Confere a conversão: a situação, os mesmos exames e os mesmos valores (recusa com o motivo). */
export function conferirConversao(
  o: { readonly validade: string; readonly convertido: boolean; readonly itens: readonly ItemOrcamento[] },
  hoje: string,
  lancados?: readonly ItemOrcamento[],
): { readonly pode: boolean; readonly motivo: string | null } {
  const s = situacaoDoOrcamento({ validade: o.validade, convertido: o.convertido, hoje });
  if (s === 'convertido') return { pode: false, motivo: 'O orçamento já foi convertido.' };
  if (s === 'vencido') return { pode: false, motivo: 'O orçamento passou da validade: faça um novo.' };
  if (o.itens.length === 0) return { pode: false, motivo: 'O orçamento não tem exames.' };
  if (lancados) {
    const esperado = itensDaConversao(o.itens);
    const iguais =
      esperado.length === lancados.length &&
      esperado.every(
        (e, i) =>
          e.exame === lancados[i]?.exame.trim() && e.valor === valorDoLegado(lancados[i]?.valor ?? NaN),
      );
    if (!iguais)
      return { pode: false, motivo: 'Os exames e os valores lançados diferem do orçamento aprovado.' };
  }
  return { pode: true, motivo: null };
}
