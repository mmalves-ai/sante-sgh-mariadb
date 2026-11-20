// W0-08, parte 7 (mercado M1; CPC 27 itens 51 e 61, CPC 23 item 32, CPC 01): revisão de estimativa, impairment e
// reavaliação do bem como EVENTOS. O ajuste vigente mais novo do bem vira o MARCO da depreciação: dali em diante a cota
// é calculada sobre o valor contábil do marco (menos o residual), na vida útil restante, sem tocar nas cotas passadas
// (prospectivo). Estornar o ajuste devolve o marco anterior; só o último ajuste vigente se estorna, e só enquanto não
// houver cota calculada depois dele (estorne a depreciação antes), nem lote contábil exportado da competência dele.
import { ORIGEM_AJUSTE_BEM, type RegistrarAjusteBem, type TipoAjusteBem } from '@sgh/contratos';
import { mesesEntre } from './depreciacao.js';
import { competenciaDe, mesSeguinte } from './origem.js';

/** O ponto de partida da depreciação depois de um ajuste (null no bem sem ajuste vigente). */
export interface MarcoDepreciacao {
  /** A última competência com cota antes do ajuste: as cotas seguintes partem daqui. */
  readonly competencia: string;
  /** A depreciação acumulada do bem no marco. */
  readonly acumuladaCent: number;
  /** O valor contábil líquido no marco, já com a perda do impairment (é a nova base). */
  readonly baseCent: number;
  readonly residualCent: number;
  readonly vidaRestanteMeses: number;
}

/** O bem como o ajuste o vê. */
export interface BemParaAjuste {
  readonly valorCent: number;
  readonly residualCent: number;
  readonly vidaUtilMeses: number;
  readonly coeficiente: number | null;
  readonly inicioDepreciacao: string;
  readonly depreciavel: boolean;
  readonly situacao: 'ativo' | 'emprestado' | 'baixado';
  /** Depreciação acumulada vigente (cotas de cálculos não estornados). */
  readonly acumuladaCent: number;
  /** O marco do último ajuste vigente (null: nenhum). */
  readonly marco: MarcoDepreciacao | null;
}

/** Valor contábil líquido: a base do marco menos o que se depreciou depois dele (ou custo menos acumulada). */
export function valorContabil(b: Pick<BemParaAjuste, 'valorCent' | 'acumuladaCent' | 'marco'>): number {
  return b.marco
    ? b.marco.baseCent - (b.acumuladaCent - b.marco.acumuladaCent)
    : b.valorCent - b.acumuladaCent;
}

/**
 * Vida útil restante (em meses nominais) depois da competência `ate`: a do marco menos os meses corridos desde ele,
 * ou a do cadastro menos os meses desde o início; com coeficiente por turno, o mês consome `coeficiente` meses.
 */
export function vidaRestante(b: BemParaAjuste, ate: string): number {
  const coef = b.coeficiente !== null && b.coeficiente > 0 ? b.coeficiente : 1;
  const [vida, desde] = b.marco
    ? [b.marco.vidaRestanteMeses, mesSeguinte(b.marco.competencia)]
    : [b.vidaUtilMeses, b.inicioDepreciacao];
  return Math.max(1, vida - Math.ceil(mesesEntre(desde, ate) * coef));
}

export interface SituacaoParaAjuste {
  readonly bem: BemParaAjuste;
  /** A última competência calculada (vigente) da empresa do bem; null: nenhuma. */
  readonly ultimaCalculada: string | null;
  /** A data do registro (AAAA-MM-DD; o relógio do estabelecimento). */
  readonly hoje: string;
  /** As contas do lançamento do tipo estão configuradas nos parâmetros (só o impairment lança). */
  readonly contasConfiguradas: boolean;
  /** Lotes contábeis exportados que cobrem a competência de hoje. */
  readonly lotesExportados: readonly { readonly periodo: string }[];
}

export type CodigoImpedimentoAjuste =
  | 'nao-depreciavel'
  | 'bem-baixado'
  | 'sem-conta'
  | 'lote-exportado'
  | 'sem-perda'
  | 'residual-maior'
  | 'nao-e-o-ultimo'
  | 'ja-estornado'
  | 'cota-posterior';

export interface ImpedimentoAjuste {
  readonly codigo: CodigoImpedimentoAjuste;
  readonly detalhe: string;
}

/** O ajuste pronto para gravar (os valores calculados; o marco novo é o que ele estabelece). */
export interface AjustePlanejado {
  readonly tipo: TipoAjusteBem;
  readonly competenciaMarco: string;
  readonly data: string;
  readonly valorContabilAntesCent: number;
  readonly valorContabilDepoisCent: number;
  readonly acumuladaMarcoCent: number;
  readonly perdaCent: number;
  readonly residualCent: number;
  readonly vidaRestanteMeses: number;
  readonly valorJustoCent: number | null;
  readonly laudo: number | null;
  readonly origem: string;
  /** O marco que passa a valer (null na reavaliação, que não muda a depreciação). */
  readonly marco: MarcoDepreciacao | null;
}

const fmt = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Planeja o ajuste ou devolve o impedimento. O marco é a última competência calculada (ou o mês anterior ao início
 * da depreciação, no bem que ainda não teve cota): o ajuste vale da competência seguinte em diante.
 */
export function planejarAjuste(
  e: RegistrarAjusteBem,
  s: SituacaoParaAjuste,
): { ajuste: AjustePlanejado } | { impedimento: ImpedimentoAjuste } {
  const b = s.bem;
  if (b.situacao === 'baixado')
    return { impedimento: { codigo: 'bem-baixado', detalhe: 'O bem está baixado: não recebe ajuste.' } };
  if (!b.depreciavel && e.tipo !== 'reavaliacao')
    return {
      impedimento: {
        codigo: 'nao-depreciavel',
        detalhe: 'O bem não deprecia: a revisão e o impairment valem só para o bem depreciável.',
      },
    };
  if (e.tipo === 'impairment' && !s.contasConfiguradas)
    return {
      impedimento: {
        codigo: 'sem-conta',
        detalhe:
          'As contas da perda por impairment não estão configuradas nos parâmetros do patrimônio: configure-as antes do lançamento.',
      },
    };
  const lote = s.lotesExportados[0];
  if (lote && e.tipo === 'impairment')
    return {
      impedimento: {
        codigo: 'lote-exportado',
        detalhe: `O lote contábil de ${lote.periodo} já foi exportado: cancele a exportação primeiro.`,
      },
    };
  const inicioMenos1 = anterior(b.inicioDepreciacao);
  const competenciaMarco =
    s.ultimaCalculada !== null && s.ultimaCalculada > inicioMenos1 ? s.ultimaCalculada : inicioMenos1;
  const contabil = valorContabil(b);
  const residualAtual = b.marco ? b.marco.residualCent : b.residualCent;
  const restante = vidaRestante(b, competenciaMarco);
  const comum = {
    tipo: e.tipo,
    competenciaMarco,
    data: s.hoje,
    valorContabilAntesCent: contabil,
    acumuladaMarcoCent: b.acumuladaCent,
    laudo: e.laudo,
    origem: ORIGEM_AJUSTE_BEM,
  };
  if (e.tipo === 'reavaliacao')
    return {
      ajuste: {
        ...comum,
        valorContabilDepoisCent: contabil,
        perdaCent: 0,
        residualCent: residualAtual,
        vidaRestanteMeses: restante,
        valorJustoCent: e.valorJustoCent,
        marco: null,
      },
    };
  if (e.tipo === 'revisao-estimativa') {
    if (e.residualCent > contabil)
      return {
        impedimento: {
          codigo: 'residual-maior',
          detalhe: `O residual (${fmt(e.residualCent)}) passa do valor contábil do bem (${fmt(contabil)}).`,
        },
      };
    const marco = {
      competencia: competenciaMarco,
      acumuladaCent: b.acumuladaCent,
      baseCent: contabil,
      residualCent: e.residualCent,
      vidaRestanteMeses: e.vidaRestanteMeses,
    };
    return {
      ajuste: {
        ...comum,
        valorContabilDepoisCent: contabil,
        perdaCent: 0,
        residualCent: e.residualCent,
        vidaRestanteMeses: e.vidaRestanteMeses,
        valorJustoCent: null,
        marco,
      },
    };
  }
  if (e.recuperavelCent >= contabil)
    return {
      impedimento: {
        codigo: 'sem-perda',
        detalhe: `O valor recuperável (${fmt(e.recuperavelCent)}) não é menor que o valor contábil (${fmt(contabil)}): não há perda a reconhecer.`,
      },
    };
  const residual = Math.min(residualAtual, e.recuperavelCent);
  const marco = {
    competencia: competenciaMarco,
    acumuladaCent: b.acumuladaCent,
    baseCent: e.recuperavelCent,
    residualCent: residual,
    vidaRestanteMeses: restante,
  };
  return {
    ajuste: {
      ...comum,
      valorContabilDepoisCent: e.recuperavelCent,
      perdaCent: contabil - e.recuperavelCent,
      residualCent: residual,
      vidaRestanteMeses: restante,
      valorJustoCent: null,
      marco,
    },
  };
}

/** O ajuste gravado como o estorno o vê. */
export interface AjusteParaEstorno {
  readonly id: number;
  readonly tipo: TipoAjusteBem;
  readonly competenciaMarco: string;
  readonly data: string;
  readonly estornado: boolean;
}

export interface SituacaoEstornoAjuste {
  readonly ajuste: AjusteParaEstorno;
  /** O último ajuste vigente do bem que mexe na depreciação (revisão ou impairment). */
  readonly ultimoComMarco: { readonly id: number } | null;
  /** Competências com cota vigente do bem depois do marco do ajuste. */
  readonly cotasPosteriores: readonly string[];
  /** Lotes contábeis exportados que cobrem a competência do lançamento do ajuste. */
  readonly lotesExportados: readonly { readonly periodo: string }[];
}

/** O que impede estornar o ajuste (null: pode). A reavaliação (sem marco nem lançamento) só recusa o já estornado. */
export function impedimentoDoEstornoAjuste(s: SituacaoEstornoAjuste): ImpedimentoAjuste | null {
  const a = s.ajuste;
  if (a.estornado) return { codigo: 'ja-estornado', detalhe: 'O ajuste já foi estornado.' };
  if (a.tipo === 'reavaliacao') return null;
  if (s.ultimoComMarco && s.ultimoComMarco.id !== a.id)
    return {
      codigo: 'nao-e-o-ultimo',
      detalhe: 'Só o último ajuste do bem se estorna: estorne antes o ajuste mais novo.',
    };
  if (s.cotasPosteriores.length > 0)
    return {
      codigo: 'cota-posterior',
      detalhe: `A depreciação de ${s.cotasPosteriores.join(', ')} já usou este ajuste: estorne a depreciação antes.`,
    };
  const lote = s.lotesExportados[0];
  if (lote && a.tipo === 'impairment')
    return {
      codigo: 'lote-exportado',
      detalhe: `O lote contábil de ${lote.periodo} já foi exportado: cancele a exportação primeiro e estorne depois.`,
    };
  return null;
}

/** A competência anterior (AAAA-MM). */
export function anterior(competencia: string): string {
  const a = Number(competencia.slice(0, 4));
  const m = Number(competencia.slice(5, 7));
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/** A competência do lançamento do ajuste (a da data). */
export const competenciaDoAjuste = (data: string): string => competenciaDe(data);
