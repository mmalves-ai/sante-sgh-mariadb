// F3.8, 07-FIN linha 109: a retenção na fonte sugerida pela regra vigente, em vez do valor digitado. Cada regra é de um
// tributo (IR, contribuição previdenciária, ISS, PIS, COFINS, CSLL), com alíquota, parte do valor que forma a base,
// faixa, dedução, mínimo de dispensa, teto, vigência, momento (emissão, pagamento ou recebimento), tipo de participante
// e, no ISS, o município do serviço. A regra mais específica vence (município e participante exatos antes de "todos").
// O recolhimento junta o retido da competência por tributo e código de receita, com o vencimento no mês seguinte.
import { centavos, type RecusaFinanceiro } from '@sgh/contratos/regras-financeiro';

export const MOMENTOS_RETENCAO = ['emissao', 'pagamento', 'recebimento'] as const;
export type MomentoRetencao = (typeof MOMENTOS_RETENCAO)[number];
export const PARTICIPANTES_RETENCAO = [
  'pessoa_fisica',
  'pessoa_juridica',
  'cooperativa',
  'simples_nacional',
  'orgao_publico',
  'todos',
] as const;
export type ParticipanteRetencao = (typeof PARTICIPANTES_RETENCAO)[number];

export interface RegraRetencao {
  readonly id: number;
  /** Sigla do tributo (IRRF, INSS, ISS, PIS, COFINS, CSLL). */
  readonly tributo: string;
  readonly momento: MomentoRetencao;
  readonly participante: ParticipanteRetencao;
  readonly municipio: number | null;
  readonly percentualBase: number;
  readonly aliquota: number;
  readonly faixaInicio: number | null;
  readonly faixaFim: number | null;
  readonly deducao: number;
  readonly minimo: number;
  readonly maximo: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

export interface FatoRetencao {
  readonly data: string;
  readonly valorBruto: number;
  readonly momento: MomentoRetencao;
  readonly participante: Exclude<ParticipanteRetencao, 'todos'>;
  /** Município onde o serviço foi prestado (ISS). */
  readonly municipio: number | null;
}

export interface SugestaoRetencao {
  readonly tributo: string;
  readonly regra: number;
  readonly base: number;
  readonly aliquota: number;
  readonly valor: number;
  /** Abaixo do mínimo: a retenção é dispensada (valor calculado mostrado, nada retido). */
  readonly dispensada: boolean;
}

const rec = (codigo: string, mensagem: string, campos: string[]): RecusaFinanceiro => ({
  codigo,
  mensagem,
  campos,
});
const vigente = (r: RegraRetencao, data: string) =>
  r.ativo && r.vigenciaInicio <= data && (r.vigenciaFim === null || r.vigenciaFim >= data);
const naFaixa = (r: RegraRetencao, base: number) =>
  (r.faixaInicio === null || base >= r.faixaInicio) && (r.faixaFim === null || base <= r.faixaFim);
const ehIss = (tributo: string) => tributo.toUpperCase() === 'ISS';

/** A regra vigente mais específica do tributo para o fato; nula: o tributo não se aplica. */
export function regraVigente(
  regras: readonly RegraRetencao[],
  tributo: string,
  f: FatoRetencao,
): RegraRetencao | null {
  let melhor: { r: RegraRetencao; peso: number } | null = null;
  for (const r of regras) {
    if (r.tributo !== tributo || !vigente(r, f.data) || r.momento !== f.momento) continue;
    if (r.participante !== 'todos' && r.participante !== f.participante) continue;
    if (r.municipio !== null && r.municipio !== f.municipio) continue;
    // ISS sem município vale só como regra geral do município do estabelecimento (sem município do serviço).
    if (ehIss(tributo) && r.municipio === null && f.municipio !== null) continue;
    if (!naFaixa(r, centavos((f.valorBruto * r.percentualBase) / 100))) continue;
    const peso = (r.municipio !== null ? 2 : 0) + (r.participante !== 'todos' ? 1 : 0);
    if (!melhor || peso > melhor.peso) melhor = { r, peso };
  }
  return melhor?.r ?? null;
}

/** A sugestão de cada tributo com regra vigente: base, alíquota, valor (com dedução e teto) e dispensa pelo mínimo. */
export function sugerirRetencoes(regras: readonly RegraRetencao[], f: FatoRetencao): SugestaoRetencao[] {
  const tributos = [...new Set(regras.map((r) => r.tributo))].sort();
  const saida: SugestaoRetencao[] = [];
  for (const t of tributos) {
    const r = regraVigente(regras, t, f);
    if (!r) continue;
    const base = centavos((f.valorBruto * r.percentualBase) / 100);
    let valor = Math.max(0, centavos((base * r.aliquota) / 100 - r.deducao));
    if (r.maximo !== null && valor > r.maximo) valor = r.maximo;
    saida.push({ tributo: t, regra: r.id, base, aliquota: r.aliquota, valor, dispensada: valor < r.minimo });
  }
  return saida;
}

/** Confere a regra nova: alíquota e base entre 0 e 100, vigência, município no ISS, sem sobrepor a vigência de outra. */
export function conferirRegraRetencao(
  e: Omit<RegraRetencao, 'id' | 'ativo'>,
  existentes: readonly RegraRetencao[],
): RecusaFinanceiro | null {
  if (!(e.aliquota > 0 && e.aliquota <= 100))
    return rec('aliquota-invalida', 'A alíquota fica entre 0 e 100%.', ['aliquota']);
  if (!(e.percentualBase > 0 && e.percentualBase <= 100))
    return rec('base-invalida', 'A parte do valor que forma a base fica entre 0 e 100%.', ['percentualBase']);
  if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
    return rec('vigencia-invalida', 'O fim da vigência vem antes do início.', ['vigenciaFim']);
  if (e.faixaInicio !== null && e.faixaFim !== null && e.faixaFim < e.faixaInicio)
    return rec('faixa-invalida', 'O fim da faixa vem antes do início.', ['faixaFim']);
  if (e.maximo !== null && e.maximo < e.minimo)
    return rec('teto-invalido', 'O teto da retenção é menor que o mínimo.', ['maximo']);
  const fim = e.vigenciaFim ?? '9999-12-31';
  const sobreposta = existentes.find(
    (r) =>
      r.ativo &&
      r.tributo === e.tributo &&
      r.momento === e.momento &&
      r.participante === e.participante &&
      r.municipio === e.municipio &&
      (r.faixaInicio ?? 0) === (e.faixaInicio ?? 0) &&
      r.vigenciaInicio <= fim &&
      (r.vigenciaFim ?? '9999-12-31') >= e.vigenciaInicio,
  );
  if (sobreposta)
    return rec(
      'vigencia-sobreposta',
      `Já há regra deste tributo vigente a partir de ${sobreposta.vigenciaInicio}: encerre a vigência dela antes.`,
      ['vigenciaInicio'],
    );
  return null;
}

/** Vencimento do recolhimento: o dia do tributo no mês seguinte à competência (último dia, quando o mês é curto). */
export function vencimentoRecolhimento(competencia: string, dia: number): string {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));
  const [a, m] = mes === 12 ? [ano + 1, 1] : [ano, mes + 1];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${a}-${String(m).padStart(2, '0')}-${String(Math.min(Math.max(dia, 1), ultimo)).padStart(2, '0')}`;
}

/** Confere o recolhimento antes de gerar o título: há retido em aberto, código de receita e soma positiva. */
export function conferirRecolhimento(
  retidos: readonly { readonly valor: number }[],
  codigoReceita: string | null,
): RecusaFinanceiro | null {
  if (retidos.length === 0)
    return rec('sem-retido', 'Não há retenção em aberto deste tributo na competência.', ['competencia']);
  if (!codigoReceita?.trim())
    return rec('sem-codigo-receita', 'Informe o código de receita da guia do tributo.', ['codigoReceita']);
  if (centavos(retidos.reduce((s, r) => s + r.valor, 0)) <= 0)
    return rec('sem-retido', 'A soma do retido da competência é zero.', ['competencia']);
  return null;
}
