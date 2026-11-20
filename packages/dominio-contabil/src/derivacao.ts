// De linha lida a fato contábil (M54-F1; regra 1). Cada fonte tem um derivador (fontes.ts e receita.ts) que diz quais
// fatos a linha representa AGORA. A conciliação com os fatos já registrados da mesma linha decide o que entra:
//   - fato igual (mesma impressão) → nada;
//   - fato diferente → estorno do anterior + o novo;
//   - fato que deixou de existir (conta reaberta, título excluído do efeito) → só o estorno.
// Nada é apagado: a correção é sempre lançamento novo (regras 3 e 4).
import {
  TIPOS_FATO,
  type FatoContabil,
  type LinhaFonte,
  type TipoFato,
  type ValorCampoFato,
} from '@sgh/contratos';
import { competenciaDaData } from './dinheiro.js';
import { impressaoDaLinha } from './fatos.js';

/** O que o derivador devolve; o resto do fato é preenchido por `montarFato`. */
export interface FatoBase {
  readonly tipo: TipoFato;
  readonly data: string;
  readonly valorCentavos: number;
  readonly centroCusto: number | null;
  readonly documento: string;
  readonly campos: Readonly<Record<string, ValorCampoFato>>;
}

export interface ContextoDerivacao {
  /** Empresa contábil do estabelecimento (as fontes gravam a empresa de formas diferentes; FCCTAEXT.EMPRESA é texto). */
  readonly empresa: number;
}

export interface Derivador {
  (l: LinhaFonte, c: ContextoDerivacao): FatoBase[];
  /**
   * W0-08: o documento do estorno quando a própria linha diz por que o fato deixou de valer (ex.: o estorno do cálculo
   * da depreciação, com o motivo). null ou ausente: o estorno leva o documento do fato estornado.
   */
  readonly documentoDoEstorno?: (l: LinhaFonte) => string | null;
}

/** Datas que o banco usa como "sem data" (convencoes.md §5, sentinelas). */
const SENTINELAS = new Set(['1899-12-30', '1899-12-31', '1900-01-01', '9999-12-31']);

/** Valor de data lido → AAAA-MM-DD, ou null se vazio ou sentinela. */
export function dataValida(v: ValorCampoFato | undefined): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
  if (!m || SENTINELAS.has(m[1]!)) return null;
  return m[1]!;
}

export function inteiroOuNulo(v: ValorCampoFato | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) ? n : null;
}

export function textoOuVazio(v: ValorCampoFato | undefined): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** Completa o fato: origem do tipo, competência da data e a impressão do efeito contábil. */
export function montarFato(l: LinhaFonte, b: FatoBase, c: ContextoDerivacao): FatoContabil {
  const impressao = impressaoDaLinha({
    tipo: b.tipo,
    data: b.data,
    valor: b.valorCentavos,
    centroCusto: b.centroCusto,
    documento: b.documento,
    ...b.campos,
  });
  return {
    tabela: l.tabela,
    id: l.id,
    tipo: b.tipo,
    origem: TIPOS_FATO[b.tipo].origem,
    empresa: c.empresa,
    data: b.data,
    competencia: competenciaDaData(b.data),
    valorCentavos: b.valorCentavos,
    centroCusto: b.centroCusto,
    documento: b.documento,
    campos: b.campos,
    impressao,
    carimbo: l.carimbo,
    estorno: false,
    referencia: null,
  };
}

/** Estorno de um fato registrado, com a data em que a mudança foi vista (cai no período aberto, regra 3). */
export function estornoDe(
  f: FatoContabil,
  data: string,
  carimbo: string | null,
  documento: string | null = null,
): FatoContabil {
  return {
    ...f,
    documento: documento ?? f.documento,
    data,
    competencia: competenciaDaData(data),
    carimbo,
    estorno: true,
    referencia: f.impressao,
    impressao: impressaoDaLinha({ estornoDe: f.impressao, data }),
  };
}

/**
 * Fatos a registrar para a linha, dados os fatos ATIVOS já registrados dela (o último não estornado de cada tipo).
 * `hoje` é a data do estorno quando o fato some ou muda (o período do fato original pode estar encerrado).
 */
export function conciliarFatos(
  l: LinhaFonte,
  derivar: Derivador,
  ativos: readonly FatoContabil[],
  c: ContextoDerivacao,
  hoje: string,
): FatoContabil[] {
  const atuais = derivar(l, c)
    .filter((b) => b.valorCentavos !== 0)
    .map((b) => montarFato(l, b, c));
  const porTipoAtual = new Map<TipoFato, FatoContabil>();
  for (const f of atuais) porTipoAtual.set(f.tipo, f);
  const porTipoAtivo = new Map<TipoFato, FatoContabil>();
  for (const f of ativos)
    if (!f.estorno && f.tabela === l.tabela && f.id === l.id) porTipoAtivo.set(f.tipo, f);
  const saida: FatoContabil[] = [];
  const tipos = [...new Set([...porTipoAtivo.keys(), ...porTipoAtual.keys()])].sort();
  for (const t of tipos) {
    const antes = porTipoAtivo.get(t);
    const agora = porTipoAtual.get(t);
    if (antes && agora && antes.impressao === agora.impressao) continue;
    if (antes)
      saida.push(estornoDe(antes, hoje, l.carimbo, agora ? null : (derivar.documentoDoEstorno?.(l) ?? null)));
    if (agora) saida.push(agora);
  }
  return saida;
}
