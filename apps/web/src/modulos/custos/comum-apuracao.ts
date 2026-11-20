// Regras de apresentação das telas da apuração do custo do mês e do resultado (M54, etapa 5), puras e testadas: reais
// de centavos, margem percentual, a conservação com as parcelas, os rateios recebidos de cada centro, o filtro dos
// centros e dos grupos e a leitura do limite da linha atípica digitado em reais.
import {
  type ClasseCentroCusto,
  ESTATISTICAS_CUSTO,
  type GrupoResultado,
  type IndicadorEconomico,
  type LinhaApuracaoCentro,
  type TotaisApuracao,
} from '@sgh/contratos';

const MILHAR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** Centavos → "R$ 1.234,56"; negativo com o sinal de menos. Em inteiros (sem ponto flutuante). */
export function reais(centavos: number): string {
  const neg = centavos < 0;
  const abs = Math.abs(Math.trunc(centavos));
  return `${neg ? '−' : ''}R$ ${MILHAR.format(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, '0')}`;
}

/** Margem em centésimos de ponto percentual → "12,34%"; null → "—". */
export function percentual(cent: number | null): string {
  if (cent === null) return '—';
  const neg = cent < 0;
  const abs = Math.abs(Math.trunc(cent));
  return `${neg ? '−' : ''}${MILHAR.format(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, '0')}%`;
}

/** Quantidade em centésimos → "1.234,5". */
export function quantidadeCent(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/** "1.000,50", "1000,5", "1000.5" ou "1000" (reais) → centavos; vazio ou inválido → null. */
export function lerReais(texto: string): number | null {
  const b = texto.trim().replace(/^R\$\s*/, '');
  const t = b.includes(',') ? b.replace(/\./g, '').replace(',', '.') : b;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [i, d = ''] = t.split('.');
  const c = Number(i) * 100 + Number(d.padEnd(2, '0'));
  return Number.isSafeInteger(c) ? c : null;
}

export interface ContaConservacao {
  /** As parcelas do custo lido: pessoal, materiais, despesas com centro e despesas sem centro. */
  readonly lidas: readonly number[];
  readonly lido: number;
  /** O destino: custo final dos produtivos, não rateado e despesas não distribuídas. */
  readonly destinos: readonly number[];
  readonly destino: number;
  readonly fecha: boolean;
}

/** A prova de que nada se perdeu, com as parcelas (o servidor já recusa gravar a que não fecha). */
export function conservacao(t: TotaisApuracao): ContaConservacao {
  const lidas = [t.direto.pessoal, t.direto.materiais, t.direto.despesas, t.despesasSemCentro];
  const destinos = [t.custoFinalProdutivos, t.naoRateado, t.despesasNaoDistribuidas];
  const lido = lidas.reduce((s, v) => s + v, 0);
  const destino = destinos.reduce((s, v) => s + v, 0);
  return { lidas, lido, destinos, destino, fecha: lido === destino };
}

/** "A + B + C = total" em reais (as parcelas impressas). */
export function somaEmReais(parcelas: readonly number[]): string {
  const total = parcelas.reduce((s, v) => s + v, 0);
  return `${parcelas.map(reais).join(' + ')} = ${reais(total)}`;
}

/** Os rateios recebidos pelo centro, com o nome de quem repartiu, e a soma. */
export function textoRecebidos(
  l: LinhaApuracaoCentro,
  nomeDe: (centro: number) => string,
): { itens: { de: string; valor: string }[]; total: string } {
  return {
    itens: l.recebidos.map((r) => ({ de: nomeDe(r.de), valor: reais(r.centavos) })),
    total: reais(l.recebidoTotal),
  };
}

export type FiltroClasseApuracao = ClasseCentroCusto | 'todas';

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** As linhas da apuração pela classe e pelo termo (código exato ou parte do nome). */
export function filtrarLinhas(
  linhas: readonly LinhaApuracaoCentro[],
  classe: FiltroClasseApuracao,
  termo: string,
): LinhaApuracaoCentro[] {
  const t = normalizar(termo.trim());
  return linhas.filter(
    (l) =>
      (classe === 'todas' || l.classe === classe) &&
      (!t || String(l.codigo) === t || normalizar(l.nome).includes(t)),
  );
}

/** Os grupos do resultado pelo termo (chave exata ou parte do rótulo). */
export function filtrarGrupos(grupos: readonly GrupoResultado[], termo: string): GrupoResultado[] {
  const t = normalizar(termo.trim());
  if (!t) return [...grupos];
  return grupos.filter((g) => normalizar(g.chave) === t || normalizar(g.rotulo).includes(t));
}

/** O indicador como conta: "Σ numeradores ÷ Σ denominadores = valor" (regra 15). */
export function contaIndicador(i: IndicadorEconomico): string {
  return `${reais(i.numerador)} ÷ ${quantidadeCent(i.denominador)} = ${i.valor === null ? '—' : reais(i.valor)}`;
}

/** "2026-04-02T10:00:00Z" → "02/04/2026 07:00" (hora local); texto inválido volta como veio. */
export { dataHora } from './comum-custos.js';

/** A produção do centro com a unidade da estatística ("1.250 paciente-dia"). */
export function textoProducao(p: LinhaApuracaoCentro['producao']): string | null {
  if (!p) return null;
  const d = ESTATISTICAS_CUSTO.find((e) => e.codigo === p.codigo);
  return `${quantidadeCent(p.quantidadeCent)} ${d?.unidade ?? p.codigo}`;
}

/** O rótulo da estatística pelo código (critério do rateio). */
export function rotuloEstatistica(codigo: string | null): string {
  if (!codigo) return '—';
  return ESTATISTICAS_CUSTO.find((e) => e.codigo === codigo)?.rotulo ?? codigo;
}
