// ADR 0009: regras puras das telas da agenda estruturada. O texto original vem inteiro e é fatiado pelos trechos
// (posições em caracteres, base 0, fim exclusivo) para a tela destacar o que não foi interpretado (continua valendo
// pelo texto, decisão 27). A cobertura agrupa os planos pelo plano superior (subplano).
import type {
  AgendaEstruturada,
  CoberturaAgenda,
  RegraPrecoParticular,
  TextoOrigemAgenda,
  TrechoTexto,
} from '@sgh/contratos';
import { compararEspecificidade } from '@sgh/dominio-preco';

export interface PedacoTexto {
  texto: string;
  /** nulo: texto fora de qualquer trecho; verdadeiro/falso: trecho interpretado ou não. */
  interpretado: boolean | null;
  tipoRegra: TrechoTexto['tipoRegra'];
  motivo: string | null;
}

/**
 * Fatia o texto pelos trechos. Trechos fora do texto são cortados. Na sobreposição, o trecho NÃO interpretado tem
 * precedência (decisão 27: o que não se interpretou continua valendo pelo texto e fica marcado): cada caractere fica
 * com o trecho não interpretado que o cobre, senão com o interpretado; entre os do mesmo tipo, o que começa antes.
 * Um interpretado com um não interpretado dentro sai em três pedaços. Concatenar os pedaços devolve o texto inteiro.
 */
export function fatiarTexto(texto: string, trechos: readonly TrechoTexto[]): PedacoTexto[] {
  const chars = Array.from(texto);
  const total = chars.length;
  const ordenados = [...trechos].sort((a, b) => a.inicio - b.inicio || a.fim - b.fim);
  const dono: (TrechoTexto | null)[] = new Array<TrechoTexto | null>(total).fill(null);
  for (const t of ordenados) {
    const inicio = Math.max(0, Math.min(t.inicio, total));
    const fim = Math.min(t.fim, total);
    for (let k = inicio; k < fim; k++) {
      const atual = dono[k] ?? null;
      if (atual === null || (atual.interpretado && !t.interpretado)) dono[k] = t;
    }
  }
  const pedacos: PedacoTexto[] = [];
  let k = 0;
  while (k < total) {
    const t = dono[k] ?? null;
    let fim = k + 1;
    while (fim < total && (dono[fim] ?? null) === t) fim++;
    pedacos.push({
      texto: chars.slice(k, fim).join(''),
      interpretado: t === null ? null : t.interpretado,
      tipoRegra: t === null ? null : t.tipoRegra,
      motivo: t === null ? null : t.motivo,
    });
    k = fim;
  }
  return pedacos;
}

/** Quantos trechos do texto não foram interpretados (a tela avisa que valem pelo texto). */
export const naoInterpretados = (t: TextoOrigemAgenda): number =>
  t.trechos.filter((x) => !x.interpretado).length;

export interface GrupoCobertura {
  fontePagadoraId: number;
  /** Linha do convênio inteiro (sem plano), se houver. */
  convenio: CoberturaAgenda | null;
  /** Planos agrupados pelo plano superior; superior nulo = plano de primeiro nível. */
  planos: { superiorId: number | null; itens: CoberturaAgenda[] }[];
}

/** Agrupa a cobertura por convênio e, dentro dele, pelo plano superior (subplanos juntos). */
export function agruparCobertura(coberturas: readonly CoberturaAgenda[]): GrupoCobertura[] {
  const porConvenio = new Map<number, GrupoCobertura>();
  for (const c of coberturas) {
    let g = porConvenio.get(c.fontePagadoraId);
    if (!g) {
      g = { fontePagadoraId: c.fontePagadoraId, convenio: null, planos: [] };
      porConvenio.set(c.fontePagadoraId, g);
    }
    if (c.planoId === null) {
      g.convenio = c;
      continue;
    }
    let p = g.planos.find((x) => x.superiorId === c.planoSuperiorId);
    if (!p) {
      p = { superiorId: c.planoSuperiorId, itens: [] };
      g.planos.push(p);
    }
    p.itens.push(c);
  }
  return [...porConvenio.values()].sort((a, b) => a.fontePagadoraId - b.fontePagadoraId);
}

/**
 * As regras de preço que valem na data (a recusada não vale; a estimada já vale, decisão 27), na ordem em que o
 * cálculo as escolhe: a mesma especificidade do domínio (alvo item > grupo > consulta; agenda > profissional;
 * estabelecimento > rede; prioridade, menor vence; confirmada > estimada). A primeira é a que vence para o alvo dela.
 */
export const regrasVigentes = (
  regras: readonly RegraPrecoParticular[],
  data: string,
): RegraPrecoParticular[] =>
  regras
    .filter(
      (r) =>
        r.ativo &&
        r.situacaoRevisao !== 'recusada' &&
        r.vigenciaInicio <= data &&
        (r.vigenciaFim === null || r.vigenciaFim >= data),
    )
    .sort(compararEspecificidade);

/** O texto de onde a regra foi extraída, para mostrar ao lado. */
export const textoDaRegra = (
  a: Pick<AgendaEstruturada, 'textos'>,
  textoOrigemId: number | null,
): TextoOrigemAgenda | null =>
  textoOrigemId === null ? null : (a.textos.find((t) => t.id === textoOrigemId) ?? null);

/** Valor em reais no formato da tela. */
export const reais = (v: number | null): string =>
  v === null ? '–' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Data ISO (AAAA-MM-DD) em DD/MM/AAAA. */
export const dataTela = (d: string | null): string =>
  d === null ? '' : /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d;

/** Converte o valor digitado ("150,00" ou "150.5") em reais com 2 casas; nulo se inválido. */
export function lerValorDigitado(s: string): number | null {
  const limpo = s.trim().replace(/\s|R\$/g, '');
  if (!limpo) return null;
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  return Math.round(Number(normal) * 100) / 100;
}
