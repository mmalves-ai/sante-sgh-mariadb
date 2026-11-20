// Fechamento de um recibo avulso da folha (M53-F3: férias e 13º): a partir dos proventos e descontos brutos do recibo,
// as bases pelas incidências das rubricas, o INSS e o IRRF nos papéis do recibo, o FGTS e os encargos da empresa, como
// no cálculo mensal (M53-F2), com as linhas e o resumo do vínculo. Regra pura; nenhum valor legal no código (regra 7).
//
// Decisões (POL-5, dono confirma; registradas nas evidências do M53.4):
// - D-IRRF-FER-534: o IRRF das férias é calculado em separado no mês do pagamento com a tabela mensal inteira (desconto
//   simplificado e a redução de 2026), como rendimento do mês.
// - D-IRRF13-534: o IRRF do 13º é de tributação exclusiva: deduções legais (INSS do 13º e dependentes), sem o desconto
//   simplificado mensal e sem a redução mensal de 2026.
// - D-ADIANT-534: o adiantamento do 13º (pago com as férias ou na 1ª parcela) nunca entra na base do INSS nem do IRRF
//   (a retenção é da parcela final; Lei 4.749/1965), qualquer que seja a incidência da rubrica; o FGTS segue a rubrica.
import type {
  ColaboradorCalculado,
  LinhaCalculoFolha,
  PapelCalculoFolha,
  ParametrosFolha,
  RubricaFolha,
  TabelaLegalFolha,
} from '@sgh/contratos';
import { TIPO_DO_PAPEL } from '@sgh/contratos';
import {
  type Bruta,
  type FeriasNoMesParaCalculo,
  incide,
  inssDoMes,
  inssProgressivo,
  irrfMensal,
  linhaDaBruta,
  linhaInformativa,
  multiplicarDividir,
  pct,
  reais,
} from './calculo.js';

export interface OpcoesRecibo {
  /** O papel do INSS e do IRRF do recibo (null: o recibo não retém, como a 1ª parcela do 13º). */
  readonly papelInss: PapelCalculoFolha | null;
  readonly papelIrrf: PapelCalculoFolha | null;
  readonly irrf: 'mensal' | 'exclusiva';
  /** Papéis que não entram na base do INSS nem do IRRF (D-ADIANT-534). */
  readonly foraDoInssIrrf: ReadonlySet<PapelCalculoFolha>;
  /** Papéis que não entram em base nenhuma (o desconto do adiantamento na parcela final do 13º). */
  readonly foraDasBases?: ReadonlySet<PapelCalculoFolha>;
  /** Base do FGTS já depositada a abater (o adiantamento do 13º na parcela final). */
  readonly fgtsJaDepositado: number;
  /** Encargos da empresa (patronal, RAT, terceiros) sobre a base do INSS do recibo. */
  readonly encargos: boolean;
  /**
   * O recibo de férias do mês (M53-F4: a rescisão no mês de um gozo): o INSS sai da base somada à do recibo, menos o
   * já retido nele (D-FERMES-534, salário de contribuição único do mês).
   */
  readonly feriasNoMes?: FeriasNoMesParaCalculo;
}

export interface ReciboFechado {
  readonly resumo: ColaboradorCalculado;
  readonly linhas: readonly LinhaCalculoFolha[];
}

const SEM_REDUCAO = { isencaoAte: 0, reducaoDe: 0, reducaoAte: 0, valor: 0, semReducaoAcimaDe: 0 };

/** Fecha o recibo: bases, retenções, FGTS e encargos; o resumo pela soma das linhas. */
export function fecharRecibo(
  v: { readonly id: number; readonly matricula: string | null; readonly centroCusto: number },
  dias: number,
  brutasIniciais: readonly Bruta[],
  c: {
    readonly tabela: TabelaLegalFolha | null;
    readonly parametros: ParametrosFolha;
    readonly rubricas: ReadonlyMap<PapelCalculoFolha, RubricaFolha>;
    readonly dependentesIrrf: number;
  },
  op: OpcoesRecibo,
): ReciboFechado {
  const brutas = brutasIniciais.filter((b) => b.valor > 0);
  const rub = (p: PapelCalculoFolha) => c.rubricas.get(p);
  const baseDe = (tributo: 'inss' | 'irrf' | 'fgts') => {
    let b = 0;
    const partes: string[] = [];
    for (const x of brutas) {
      if (tributo !== 'fgts' && op.foraDoInssIrrf.has(x.papel)) continue;
      if (op.foraDasBases?.has(x.papel)) continue;
      if (!incide(rub(x.papel), tributo)) continue;
      const sinal = TIPO_DO_PAPEL[x.papel] === 'desconto' ? -1 : 1;
      b += sinal * x.valor;
      partes.push(`${sinal < 0 ? '- ' : partes.length ? '+ ' : ''}${reais(x.valor)}`);
    }
    return { valor: Math.max(0, b), memoria: partes.join(' ') || 'nenhuma rubrica incide' };
  };
  const bInss = baseDe('inss');
  const bIrrf = baseDe('irrf');
  const bFgts0 = baseDe('fgts');
  const bFgts =
    op.fgtsJaDepositado > 0
      ? {
          valor: Math.max(0, bFgts0.valor - op.fgtsJaDepositado),
          memoria: `${bFgts0.memoria} - ${reais(op.fgtsJaDepositado)} já depositado no adiantamento`,
        }
      : bFgts0;
  let inss = 0;
  let irrf = 0;
  let baseCalculoIrrf = 0;
  if (op.papelInss && c.tabela) {
    const r = op.feriasNoMes
      ? inssDoMes(bInss.valor, c.tabela.inss, op.feriasNoMes)
      : inssProgressivo(bInss.valor, c.tabela.inss);
    inss = r.valor;
    if (inss > 0)
      brutas.push({ papel: op.papelInss, quantidade: 0, unidade: 'valor', valor: inss, memoria: r.memoria });
  }
  if (op.papelIrrf && c.tabela) {
    const t =
      op.irrf === 'exclusiva'
        ? { ...c.tabela.irrf, descontoSimplificado: 0, reducao: SEM_REDUCAO }
        : c.tabela.irrf;
    const r = irrfMensal(bIrrf.valor, inss, c.dependentesIrrf, t);
    irrf = r.valor;
    baseCalculoIrrf = r.base;
    if (irrf > 0)
      brutas.push({
        papel: op.papelIrrf,
        quantidade: c.dependentesIrrf,
        unidade: 'dependentes',
        valor: irrf,
        memoria: `${r.memoria}${op.irrf === 'exclusiva' ? ' (tributação exclusiva)' : ''}`,
      });
  }
  const e = c.parametros.encargos;
  const fgts = multiplicarDividir([bFgts.valor, e.fgts], [10_000]);
  if (fgts > 0)
    brutas.push({
      papel: 'fgts',
      quantidade: e.fgts,
      unidade: 'percentual',
      valor: fgts,
      memoria: `${reais(bFgts.valor)} × ${pct(e.fgts)}`,
    });
  const linhas = brutas.map((b) => linhaDaBruta(b, rub(b.papel)));
  const comEncargos = op.encargos && op.papelInss !== null;
  const patronal = comEncargos ? multiplicarDividir([bInss.valor, e.inssPatronal], [10_000]) : 0;
  const rat = comEncargos ? multiplicarDividir([bInss.valor, e.ratAjustado], [10_000]) : 0;
  const terceiros = comEncargos ? multiplicarDividir([bInss.valor, e.terceiros], [10_000]) : 0;
  linhas.push(
    linhaInformativa('baseInss', op.papelInss ? bInss.valor : 0, bInss.memoria),
    linhaInformativa(
      'baseIrrf',
      op.papelIrrf ? bIrrf.valor : 0,
      `${bIrrf.memoria}; base de cálculo ${reais(baseCalculoIrrf)}`,
    ),
    linhaInformativa('baseFgts', bFgts.valor, bFgts.memoria),
  );
  if (comEncargos)
    linhas.push(
      linhaInformativa(
        'inssPatronal',
        patronal,
        `${reais(bInss.valor)} × ${pct(e.inssPatronal)}`,
        e.inssPatronal,
      ),
      linhaInformativa('rat', rat, `${reais(bInss.valor)} × ${pct(e.ratAjustado)}`, e.ratAjustado),
      linhaInformativa('terceiros', terceiros, `${reais(bInss.valor)} × ${pct(e.terceiros)}`, e.terceiros),
    );
  const soma = (t: 'provento' | 'desconto') =>
    linhas.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0);
  const proventos = soma('provento');
  const descontos = soma('desconto');
  return {
    resumo: {
      vinculo: v.id,
      matricula: v.matricula,
      centroCusto: v.centroCusto,
      diasPagos: Math.max(0, Math.min(30, dias)),
      proventos,
      descontos,
      liquido: Math.max(0, proventos - descontos),
      baseInss: op.papelInss ? bInss.valor : 0,
      baseIrrf: op.papelIrrf ? bIrrf.valor : 0,
      baseFgts: bFgts.valor,
      inss,
      irrf,
      fgts,
      encargos: patronal + rat + terceiros,
    },
    linhas,
  };
}

/** Os papéis com valor no recibo que não têm rubrica válida (pendência `papel-sem-rubrica` ou `rubrica-invalida`). */
export function papeisSemRubrica(
  linhas: readonly LinhaCalculoFolha[],
  rubricas: ReadonlyMap<PapelCalculoFolha, RubricaFolha>,
): PapelCalculoFolha[] {
  const out: PapelCalculoFolha[] = [];
  for (const l of linhas) {
    if (l.tipo === 'base' || l.papel === 'inssPatronal' || l.papel === 'rat' || l.papel === 'terceiros')
      continue;
    if (l.valor === 0) continue;
    const p = l.papel as PapelCalculoFolha;
    if (!rubricas.has(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

/** As rubricas dos papéis nos parâmetros que servem na competência, e os papéis apontados para rubrica inválida. */
export function rubricasDosParametros(
  parametros: ParametrosFolha,
  rubricas: readonly RubricaFolha[],
  empresa: number,
  competencia: string,
  serve: (r: RubricaFolha, papel: PapelCalculoFolha, competencia: string) => boolean,
): { mapa: Map<PapelCalculoFolha, RubricaFolha>; invalidas: Set<PapelCalculoFolha> } {
  const mapa = new Map<PapelCalculoFolha, RubricaFolha>();
  const invalidas = new Set<PapelCalculoFolha>();
  for (const [papel, id] of Object.entries(parametros.rubricas) as [PapelCalculoFolha, number | null][]) {
    if (id === null) continue;
    const r = rubricas.find((x) => x.id === id && x.empresa === empresa);
    if (r && serve(r, papel, competencia)) mapa.set(papel, r);
    else invalidas.add(papel);
  }
  return { mapa, invalidas };
}
