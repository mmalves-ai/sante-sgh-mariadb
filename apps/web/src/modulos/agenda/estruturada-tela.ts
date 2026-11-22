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

export interface PedacoTexto {
  texto: string;
  /** nulo: texto fora de qualquer trecho; verdadeiro/falso: trecho interpretado ou não. */
  interpretado: boolean | null;
  tipoRegra: TrechoTexto['tipoRegra'];
  motivo: string | null;
}

/**
 * Fatia o texto pelos trechos. Trechos fora do texto são cortados; sobrepostos valem na ordem de início (o que
 * começa dentro de outro já fatiado começa onde o anterior acabou). Concatenar os pedaços devolve o texto inteiro.
 */
export function fatiarTexto(texto: string, trechos: readonly TrechoTexto[]): PedacoTexto[] {
  const chars = Array.from(texto);
  const total = chars.length;
  const ordenados = [...trechos].sort((a, b) => a.inicio - b.inicio || a.fim - b.fim);
  const pedacos: PedacoTexto[] = [];
  let pos = 0;
  const livre = (ate: number) => {
    if (ate > pos)
      pedacos.push({
        texto: chars.slice(pos, ate).join(''),
        interpretado: null,
        tipoRegra: null,
        motivo: null,
      });
  };
  for (const t of ordenados) {
    const inicio = Math.max(Math.min(t.inicio, total), pos);
    const fim = Math.min(t.fim, total);
    if (fim <= inicio) continue;
    livre(inicio);
    pedacos.push({
      texto: chars.slice(inicio, fim).join(''),
      interpretado: t.interpretado,
      tipoRegra: t.tipoRegra,
      motivo: t.motivo,
    });
    pos = fim;
  }
  livre(total);
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

/** As regras de preço que valem (a recusada não vale; a estimada já vale, decisão 27), em ordem de prioridade. */
export const regrasVigentes = (regras: readonly RegraPrecoParticular[]): RegraPrecoParticular[] =>
  regras
    .filter((r) => r.ativo && r.situacaoRevisao !== 'recusada')
    .sort((a, b) => a.prioridade - b.prioridade || a.id - b.id);

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
