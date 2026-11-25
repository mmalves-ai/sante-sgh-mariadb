// F3.8, 07-FIN linha 109: a retenção SOFRIDA no recebimento. O tomador (convênio, operadora, órgão público) paga a
// fatura do hospital já descontada do tributo que reteve na fonte (IR, PIS, COFINS, CSLL, ISS, contribuição
// previdenciária). O retido quita a parcela junto com o dinheiro recebido e vira crédito do hospital: fica "a
// compensar" até entrar na apuração do tributo próprio de uma competência. A sugestão sai da regra vigente no momento
// "recebimento" (retencao-regra.ts); o valor informado pelo tomador pode diferir por arredondamento, nunca passar da
// base nem do saldo da parcela.
import { centavos, type RecusaFinanceiro } from '@sgh/contratos/regras-financeiro';

export interface ItemRetencaoSofrida {
  /** Id do tributo. */
  readonly tributo: number;
  readonly base: number;
  readonly aliquota: number;
  readonly valor: number;
}

const rec = (codigo: string, mensagem: string, campos: string[]): RecusaFinanceiro => ({
  codigo,
  mensagem,
  campos,
});

/** O total retido pelo tomador nos itens informados. */
export const totalRetidoSofrido = (itens: readonly { readonly valor: number }[]): number =>
  centavos(itens.reduce((s, i) => s + i.valor, 0));

/**
 * Confere a retenção sofrida antes de gravar: há item, um tributo por vez, base e valor positivos, alíquota entre 0 e
 * 100, o retido cabe na base, o tributo ainda não foi retido nesta parcela e a soma cabe no saldo em aberto.
 */
export function conferirRetencaoSofrida(p: {
  readonly emAberto: boolean;
  readonly saldoParcela: number;
  readonly itens: readonly ItemRetencaoSofrida[];
  /** Tributos já retidos (vivos) nesta parcela. */
  readonly jaRetidos: readonly number[];
}): RecusaFinanceiro | null {
  if (!p.emAberto)
    return rec('titulo-ja-baixado', 'O título não tem parcela em aberto para abater a retenção.', ['titulo']);
  if (p.itens.length === 0) return rec('sem-item', 'Informe ao menos um tributo retido.', ['itens']);
  const vistos = new Set<number>();
  for (const i of p.itens) {
    if (vistos.has(i.tributo))
      return rec('tributo-repetido', 'O mesmo tributo aparece duas vezes na retenção.', ['itens']);
    vistos.add(i.tributo);
    if (p.jaRetidos.includes(i.tributo))
      return rec(
        'tributo-ja-retido',
        'Este tributo já foi retido nesta parcela: estorne a retenção anterior para corrigir.',
        ['itens'],
      );
    if (!(i.valor > 0)) return rec('valor-invalido', 'O valor retido é maior que zero.', ['itens']);
    if (!(i.base > 0)) return rec('base-invalida', 'A base da retenção é maior que zero.', ['itens']);
    if (!(i.aliquota > 0 && i.aliquota <= 100))
      return rec('aliquota-invalida', 'A alíquota fica entre 0 e 100%.', ['itens']);
    if (i.valor > i.base) return rec('retido-maior-que-base', 'O retido não passa da base.', ['itens']);
  }
  if (totalRetidoSofrido(p.itens) > centavos(p.saldoParcela))
    return rec(
      'retido-maior-que-saldo',
      'A soma do retido passa do saldo em aberto da parcela: confira os valores.',
      ['itens'],
    );
  return null;
}

/** O efeito da retenção na parcela: o saldo que sobra e se ela fica quitada (o retido quita como o dinheiro). */
export function efeitoRetencaoSofrida(
  saldoParcela: number,
  retido: number,
): { saldo: number; quita: boolean } {
  const saldo = centavos(Math.max(0, saldoParcela - retido));
  return { saldo, quita: saldo === 0 };
}

/** Confere o estorno: a retenção já compensada numa apuração fica como está (o crédito foi usado). */
export function conferirEstornoRetencaoSofrida(p: {
  readonly existe: boolean;
  readonly compensada: boolean;
  readonly motivo: string;
}): RecusaFinanceiro | null {
  if (!p.existe) return rec('nao-encontrado', 'A retenção não é deste título.', ['retencao']);
  if (p.compensada)
    return rec(
      'retencao-compensada',
      'A retenção já entrou numa compensação: o crédito foi usado e não pode ser estornado.',
      ['retencao'],
    );
  if (p.motivo.trim().length < 5)
    return rec('sem-motivo', 'Diga o motivo do estorno (5 letras ou mais).', ['motivo']);
  return null;
}

export interface RetidoSofrido {
  readonly tributo: string;
  /** Competência AAAA-MM do recebimento. */
  readonly competencia: string;
  readonly valor: number;
  readonly compensado: boolean;
}
export interface SaldoACompensar {
  readonly tributo: string;
  readonly retido: number;
  readonly compensado: number;
  readonly aCompensar: number;
  /** A competência mais antiga com crédito ainda não compensado; nula quando não sobra crédito. */
  readonly desde: string | null;
}

/** O saldo a compensar por tributo: o retido pelos tomadores menos o que já entrou em compensação. */
export function saldoACompensar(retidos: readonly RetidoSofrido[]): SaldoACompensar[] {
  const m = new Map<string, { retido: number; compensado: number; desde: string | null }>();
  for (const r of retidos) {
    const a = m.get(r.tributo) ?? { retido: 0, compensado: 0, desde: null };
    a.retido = centavos(a.retido + r.valor);
    if (r.compensado) a.compensado = centavos(a.compensado + r.valor);
    else if (a.desde === null || r.competencia < a.desde) a.desde = r.competencia;
    m.set(r.tributo, a);
  }
  return [...m.entries()]
    .map(([tributo, a]) => ({ tributo, ...a, aCompensar: centavos(a.retido - a.compensado) }))
    .sort((a, b) => a.tributo.localeCompare(b.tributo));
}

/**
 * Confere a compensação do crédito na apuração de uma competência: só entra o retido até ela (crédito de mês futuro
 * não compensa tributo de mês passado) e a soma é positiva.
 */
export function conferirCompensacaoSofrida(
  creditos: readonly { readonly competencia: string; readonly valor: number }[],
  competencia: string,
): RecusaFinanceiro | null {
  if (!/^\d{4}-\d{2}$/.test(competencia))
    return rec('competencia-invalida', 'Informe a competência da apuração (ano e mês).', ['competencia']);
  const cabem = creditos.filter((c) => c.competencia <= competencia);
  if (cabem.length === 0 || totalRetidoSofrido(cabem) <= 0)
    return rec('sem-credito', 'Não há retenção sofrida a compensar deste tributo até a competência.', [
      'competencia',
    ]);
  return null;
}
