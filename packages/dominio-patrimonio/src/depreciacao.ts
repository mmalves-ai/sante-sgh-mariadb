// Depreciação mensal (M54, etapa 6; ficha, regra 12): linear, com o coeficiente acelerado por turno
// (GPCOEFICIENTE_DEPREC: 1 turno 1,0; 2 turnos 1,5; 3 turnos 2,0 no pc) quando o parâmetro da empresa manda aplicar, e
// o valor residual descontado da base quando o parâmetro manda considerar. A cota de cada mês é a diferença entre a
// acumulada ESPERADA até a competência e a acumulada já gravada:
//   esperada(c) = mín(base − residual, arred((base − residual) × coeficiente × meses(c) ÷ vida útil))
// em que meses(c) conta do início da depreciação até c, inclusive. Daí: o arredondamento nunca se acumula (a soma das
// cotas fecha exatamente o valor depreciável), a última cota é o que falta, e o bem cadastrado depois do início recupera
// os meses sem cálculo na primeira cota (D-RECUPERA-546, marcada na cota). O total do cálculo é a soma das cotas, com
// as parcelas por grupo e por centro de custo (ficha, seção 8, regra 12; "toda conta com as parcelas").
// D-BAIXA-DEPREC-546: o bem baixado deprecia até o mês anterior ao da baixa. D-SEQ-546: as competências de uma empresa
// são calculadas em sequência, sem pular, e a gravada não se recalcula (a cota é imutável: é o fato contábil).
import {
  type CotaDepreciacao,
  type GrupoBem,
  rotuloGrupoSemente,
  type MotivoSemCota,
  type ParcelaDepreciacao,
  type ParametrosDepreciacao,
} from '@sgh/contratos';
import type { MarcoDepreciacao } from './ajuste.js';
import { competenciaDe, mesSeguinte } from './origem.js';

export interface BemParaDepreciar {
  readonly id: number;
  readonly plaqueta: string;
  readonly descricao: string;
  readonly grupo: GrupoBem;
  readonly centro: number;
  readonly valorCent: number;
  readonly residualCent: number;
  readonly vidaUtilMeses: number;
  /** Percentual do coeficiente por turno (1, 1,5, 2); null: sem coeficiente (1). */
  readonly coeficiente: number | null;
  readonly inicioDepreciacao: string;
  readonly depreciavel: boolean;
  readonly situacao: 'ativo' | 'emprestado' | 'baixado';
  readonly baixadoEm: string | null;
  /** Acumulada gravada antes da competência e se já há cota da própria competência. */
  readonly acumuladaCent: number;
  readonly temCotaNaCompetencia: boolean;
  /**
   * W0-08 (M1): o marco do último ajuste vigente (revisão de estimativa ou impairment). Com ele, a cota é calculada
   * sobre a base do marco, na vida restante, contando os meses a partir do mês seguinte ao marco (prospectivo: as
   * cotas anteriores não mudam).
   */
  readonly marco?: MarcoDepreciacao | null;
}

/** Meses de `inicio` até `competencia`, inclusive (0 quando a competência é anterior ao início). */
export function mesesEntre(inicio: string, competencia: string): number {
  const a = Number(inicio.slice(0, 4)) * 12 + Number(inicio.slice(5, 7));
  const b = Number(competencia.slice(0, 4)) * 12 + Number(competencia.slice(5, 7));
  return b < a ? 0 : b - a + 1;
}

/** Coeficiente em centésimos (1,5 → 150), o que mantém a conta em inteiros. */
const centesimos = (c: number): number => Math.round(c * 100);

export type ResultadoCota = { readonly cota: CotaDepreciacao } | { readonly semCota: MotivoSemCota };

/** A cota do bem na competência, com as parcelas, ou o motivo de não ter. */
export function cotaDoMes(
  b: BemParaDepreciar,
  competencia: string,
  p: Pick<ParametrosDepreciacao, 'aplicarCoeficiente' | 'considerarResidual'>,
): ResultadoCota {
  if (!b.depreciavel) return { semCota: 'nao-depreciavel' };
  if (b.situacao === 'baixado' && (!b.baixadoEm || competenciaDe(b.baixadoEm) <= competencia))
    return { semCota: 'baixado' };
  if (b.temCotaNaCompetencia) return { semCota: 'ja-calculado' };
  const m = b.marco ?? null;
  // Com marco, conta-se do mês seguinte a ele (ou do início, se o bem começa depois) e só o que se depreciou desde ele.
  const desde =
    m && mesSeguinte(m.competencia) > b.inicioDepreciacao ? mesSeguinte(m.competencia) : b.inicioDepreciacao;
  const meses = mesesEntre(desde, competencia);
  if (meses === 0) return { semCota: 'ainda-nao-iniciou' };
  const baseCent = m ? m.baseCent : b.valorCent;
  const vida = m ? m.vidaRestanteMeses : b.vidaUtilMeses;
  const residual = p.considerarResidual ? (m ? m.residualCent : b.residualCent) : 0;
  const jaDepreciada = m ? b.acumuladaCent - m.acumuladaCent : b.acumuladaCent;
  const depreciavel = baseCent - residual;
  const coef = p.aplicarCoeficiente && b.coeficiente !== null && b.coeficiente > 0 ? b.coeficiente : 1;
  const esperada = Math.min(depreciavel, Math.round((depreciavel * centesimos(coef) * meses) / (vida * 100)));
  const valor = esperada - jaDepreciada;
  if (depreciavel - jaDepreciada <= 0 || valor <= 0) return { semCota: 'depreciado' };
  const cotaLinear = Math.round((depreciavel * centesimos(coef)) / (vida * 100));
  return {
    cota: {
      bem: b.id,
      plaqueta: b.plaqueta,
      descricao: b.descricao,
      grupo: b.grupo,
      centro: b.centro,
      baseCent,
      residualCent: residual,
      vidaUtilMeses: vida,
      coeficiente: coef,
      acumuladaAntesCent: b.acumuladaCent,
      mesesDecorridos: meses,
      valorCent: valor,
      acumuladaDepoisCent: b.acumuladaCent + valor,
      ultima: jaDepreciada + valor === depreciavel,
      recuperaMeses: valor > cotaLinear + 1,
    },
  };
}

export interface PlanoDepreciacao {
  readonly cotas: CotaDepreciacao[];
  readonly semCota: { bem: number; plaqueta: string; motivo: MotivoSemCota }[];
  readonly totalCent: number;
  readonly porGrupo: ParcelaDepreciacao[];
  readonly porCentro: ParcelaDepreciacao[];
}

/** Parcelas por chave, em ordem de chave; a soma das parcelas é o total. */
export function parcelas(
  cotas: readonly CotaDepreciacao[],
  chave: (c: CotaDepreciacao) => string,
  rotulo: (k: string) => string,
): ParcelaDepreciacao[] {
  const m = new Map<string, { bens: number; valorCent: number }>();
  for (const c of cotas) {
    const k = chave(c);
    const a = m.get(k) ?? { bens: 0, valorCent: 0 };
    m.set(k, { bens: a.bens + 1, valorCent: a.valorCent + c.valorCent });
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    .map(([k, v]) => ({ chave: k, rotulo: rotulo(k), ...v }));
}

/** Monta a prévia (ou o que se grava) da competência a partir dos bens da empresa. */
export function planoDaDepreciacao(
  bens: readonly BemParaDepreciar[],
  competencia: string,
  p: Pick<ParametrosDepreciacao, 'aplicarCoeficiente' | 'considerarResidual'>,
  nomeDoCentro: (id: number) => string = (id) => String(id),
  nomeDoGrupo: (codigo: GrupoBem) => string = rotuloGrupoSemente,
): PlanoDepreciacao {
  const cotas: CotaDepreciacao[] = [];
  const semCota: PlanoDepreciacao['semCota'] = [];
  for (const b of bens) {
    const r = cotaDoMes(b, competencia, p);
    if ('cota' in r) cotas.push(r.cota);
    else semCota.push({ bem: b.id, plaqueta: b.plaqueta, motivo: r.semCota });
  }
  return { ...montarTotais(cotas, nomeDoCentro, nomeDoGrupo), cotas, semCota };
}

/** Total e parcelas de cotas já gravadas (a consulta da competência calculada). */
export function montarTotais(
  cotas: readonly CotaDepreciacao[],
  nomeDoCentro: (id: number) => string = (id) => String(id),
  nomeDoGrupo: (codigo: GrupoBem) => string = rotuloGrupoSemente,
): { totalCent: number; porGrupo: ParcelaDepreciacao[]; porCentro: ParcelaDepreciacao[] } {
  return {
    totalCent: cotas.reduce((s, c) => s + c.valorCent, 0),
    porGrupo: parcelas(
      cotas,
      (c) => c.grupo,
      (k) => nomeDoGrupo(k),
    ),
    porCentro: parcelas(
      cotas,
      (c) => String(c.centro),
      (k) => nomeDoCentro(Number(k)),
    ),
  };
}

export interface ContextoCalculo {
  readonly parametros: ParametrosDepreciacao | null;
  /** A última competência calculada da empresa (null: nenhuma). */
  readonly ultimaCalculada: string | null;
  /** Mês corrente no relógio do estabelecimento (AAAA-MM). */
  readonly mesAtual: string;
}

/**
 * O que impede calcular a competência (vazio: pode). D-SEQ-546: depois da primeira, as competências seguem em
 * sequência; a primeira pode ser qualquer uma (as cotas recuperam os meses desde o início de cada bem).
 */
export function impedimentosDoCalculo(competencia: string, c: ContextoCalculo): string[] {
  const r: string[] = [];
  if (!c.parametros) r.push('A empresa não tem os parâmetros do patrimônio cadastrados.');
  else if (!c.parametros.depreciar)
    r.push(
      'Os parâmetros do patrimônio da empresa estão sem a depreciação: ligue em Parâmetros do patrimônio.',
    );
  if (competencia > c.mesAtual) r.push('A competência ainda não começou.');
  if (c.ultimaCalculada !== null) {
    if (competencia === c.ultimaCalculada) r.push('A depreciação desta competência já foi calculada.');
    else if (competencia < c.ultimaCalculada)
      r.push(
        `A depreciação já foi calculada até ${c.ultimaCalculada}: a competência anterior não se recalcula.`,
      );
    else if (competencia !== mesSeguinte(c.ultimaCalculada))
      r.push(
        `Calcule antes a competência ${mesSeguinte(c.ultimaCalculada)} (as competências seguem em sequência).`,
      );
  }
  return r;
}

/** Resumo do cálculo gravado (JSON curto, só contagens e totais: no máximo 8 grupos, cabe em 2.000 caracteres). */
export function resumoDoCalculo(plano: PlanoDepreciacao): string {
  const motivos: Record<string, number> = {};
  for (const s of plano.semCota) motivos[s.motivo] = (motivos[s.motivo] ?? 0) + 1;
  const txt = JSON.stringify({
    total: plano.totalCent,
    cotas: plano.cotas.length,
    recuperam: plano.cotas.filter((c) => c.recuperaMeses).length,
    ultimas: plano.cotas.filter((c) => c.ultima).length,
    semCota: motivos,
    porGrupo: plano.porGrupo.map((g) => [g.chave, g.bens, g.valorCent]),
  });
  return txt;
}
