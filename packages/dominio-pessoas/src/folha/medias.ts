// Datas, avos e médias da folha (M53-F3: férias e 13º). Regra pura sobre o histórico das folhas mensais calculadas do
// vínculo (as linhas em vigor por competência e papel) e os afastamentos; nada lido do relógio.
//
// Decisões (POL-5, dono confirma; registradas nas evidências do M53.4):
// - D-MES-534: o período aquisitivo tem sempre 12 competências: começa na do início do período quando ele começa até o
//   dia 15, senão na seguinte (a faltas e as médias do período contam essas competências).
// - D-MEDIA-534: as médias das variáveis nas férias e no 13º são físicas (Súmula 347 do TST): os minutos de hora extra,
//   adicional noturno e sobreaviso das competências somados, divididos pelos meses e valorizados pelo salário e pelos
//   percentuais em vigor no pagamento; o descanso sobre as variáveis entra pela média em valor. Nas férias, ÷ 12 (as
//   competências do período aquisitivo); no 13º, ÷ os avos do ano até novembro (a média dos meses trabalhados).
// - D-AVOS-534: o avo do 13º conta no mês com 15 dias ou mais de trabalho (Lei 4.090/1962, art. 1º §2): dias corridos do
//   mês menos os dias antes da admissão e os de afastamento além dos que a empresa paga (a regra de D-DIAS-533).
import type { PapelLinhaFolha, ParametrosFolha } from '@sgh/contratos';
import { diaUtc } from '../datas.js';
import {
  type AfastamentoParaCalculo,
  diasDoMes,
  diasPagos,
  horasMin,
  multiplicarDividir,
  pct,
  reais,
  type VinculoParaCalculo,
} from './calculo.js';
import { fimDaCompetencia } from './vigencia.js';

const isoDe = (dia: number) => new Date(dia * 86_400_000).toISOString().slice(0, 10);
const p2 = (n: number) => String(n).padStart(2, '0');

export function maisDias(data: string, n: number): string {
  return isoDe(diaUtc(data) + n);
}

/** O mesmo dia `n` anos depois (29/02 em ano não bissexto vira 28/02). */
export function somarAnos(data: string, n: number): string {
  const a = Number(data.slice(0, 4)) + n;
  const m = Number(data.slice(5, 7));
  const d = Number(data.slice(8, 10));
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${a}-${p2(m)}-${p2(Math.min(d, ultimo))}`;
}

export function maisCompetencias(competencia: string, n: number): string {
  const a = Number(competencia.slice(0, 4));
  const m = Number(competencia.slice(5, 7)) - 1 + n;
  const aa = a + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${aa}-${p2(mm + 1)}`;
}

/** Dia da semana da data (0 = domingo). */
export function diaDaSemana(data: string): number {
  return new Date(diaUtc(data) * 86_400_000).getUTCDay();
}

/** As 12 competências do período aquisitivo que começa em `inicio` (D-MES-534). */
export function competenciasDoPeriodo(inicio: string): string[] {
  const primeira =
    Number(inicio.slice(8, 10)) <= 15 ? inicio.slice(0, 7) : maisCompetencias(inicio.slice(0, 7), 1);
  return Array.from({ length: 12 }, (_, i) => maisCompetencias(primeira, i));
}

/** Uma linha do histórico das folhas mensais calculadas do vínculo (somas por competência e papel). */
export interface HistoricoFolha {
  readonly competencia: string;
  readonly papel: PapelLinhaFolha;
  readonly quantidade: number;
  readonly valor: number;
}

/** Os papéis que entram nas médias: os de minutos e o percentual de cada um (como no cálculo mensal). */
export function papeisDeMedia(p: ParametrosFolha): readonly { papel: PapelLinhaFolha; percentual: number }[] {
  return [
    { papel: 'horaExtra50', percentual: 10_000 + p.percentuais.horaExtra50 },
    { papel: 'horaExtra100', percentual: 10_000 + p.percentuais.horaExtra100 },
    { papel: 'adicionalNoturno', percentual: p.percentuais.adicionalNoturno },
    { papel: 'sobreaviso', percentual: p.percentuais.sobreaviso },
  ];
}

const ROTULO_MEDIA: Readonly<Partial<Record<PapelLinhaFolha, string>>> = {
  horaExtra50: 'hora extra',
  horaExtra100: 'hora extra em descanso',
  adicionalNoturno: 'adicional noturno',
  sobreaviso: 'sobreaviso',
};

export interface MediaCalculada {
  /** Valor mensal da média (antes da proporção de dias ou de avos). */
  readonly valor: number;
  readonly memoria: string;
}

/**
 * A média mensal das variáveis (D-MEDIA-534): Σ minutos ÷ meses, valorizados pela hora atual e pelo percentual; mais a
 * média em valor do descanso sobre as variáveis. `fator` = [num, den] aplicado ao fim (avos/12 no 13º).
 */
export function mediaDasVariaveis(
  historico: readonly HistoricoFolha[],
  competencias: ReadonlySet<string>,
  meses: number,
  salario: number,
  divisor: number,
  parametros: ParametrosFolha,
  fator: readonly [number, number] = [1, 1],
): MediaCalculada {
  if (meses <= 0) return { valor: 0, memoria: 'sem meses para a média' };
  const hs = historico.filter((h) => competencias.has(h.competencia));
  const partes: string[] = [];
  let valor = 0;
  for (const { papel, percentual } of papeisDeMedia(parametros)) {
    const min = hs.filter((h) => h.papel === papel).reduce((s, h) => s + Math.max(0, h.quantidade), 0);
    if (min <= 0) continue;
    const v = multiplicarDividir(
      [salario, min, percentual, fator[0]],
      [divisor, 60, 10_000, meses, fator[1]],
    );
    valor += v;
    partes.push(
      `${ROTULO_MEDIA[papel] ?? papel} ${horasMin(min)}/${meses} × (${reais(salario)} ÷ ${divisor} h) × ${pct(percentual)} = ${reais(v)}`,
    );
  }
  const dsr = hs.filter((h) => h.papel === 'dsrVariaveis').reduce((s, h) => s + Math.max(0, h.valor), 0);
  if (dsr > 0) {
    const v = multiplicarDividir([dsr, fator[0]], [meses, fator[1]]);
    valor += v;
    partes.push(`descanso ${reais(dsr)}/${meses} = ${reais(v)}`);
  }
  const f = fator[0] !== fator[1] ? ` (× ${fator[0]}/${fator[1]})` : '';
  return { valor, memoria: partes.length ? `${partes.join('; ')}${f}` : 'sem variáveis no período' };
}

/** As competências da lista sem nenhuma linha no histórico do vínculo (folha mensal não calculada). */
export function competenciasSemCalculo(
  historico: readonly HistoricoFolha[],
  competencias: readonly string[],
): string[] {
  const com = new Set(historico.map((h) => h.competencia));
  return competencias.filter((c) => !com.has(c));
}

/** O vínculo trabalhou ao menos 15 dias corridos na competência (D-AVOS-534)? */
export function temAvo(
  v: Pick<VinculoParaCalculo, 'admissao' | 'desligamento'>,
  afastamentos: readonly AfastamentoParaCalculo[],
  competencia: string,
  diasEmpresa: number,
): boolean {
  const ini = diaUtc(`${competencia}-01`);
  const fim = diaUtc(fimDaCompetencia(competencia));
  if (diaUtc(v.admissao) > fim) return false;
  if (v.desligamento !== null && diaUtc(v.desligamento) < ini) return false;
  const d = diasPagos(v, afastamentos, competencia, diasEmpresa);
  const depois = v.desligamento !== null && diaUtc(v.desligamento) < fim ? fim - diaUtc(v.desligamento) : 0;
  return diasDoMes(competencia) - d.naoPagos - depois >= 15;
}

/** Os avos do 13º do ano, contando os meses de janeiro até `ateMes` (D-AVOS-534). */
export function avosDoAno(
  v: Pick<VinculoParaCalculo, 'admissao' | 'desligamento'>,
  afastamentos: readonly AfastamentoParaCalculo[],
  ano: number,
  diasEmpresa: number,
  ateMes = 12,
): { avos: number; meses: string[] } {
  const meses: string[] = [];
  for (let m = 1; m <= ateMes; m++) {
    const c = `${ano}-${p2(m)}`;
    if (temAvo(v, afastamentos, c, diasEmpresa)) meses.push(c);
  }
  return { avos: meses.length, meses };
}
