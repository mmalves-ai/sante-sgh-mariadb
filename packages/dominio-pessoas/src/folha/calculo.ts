// Cálculo mensal da folha (M53-F2; ficha do M53, seções 1 e 8, regras 7 e 8). Regra pura: quem chama lê o vínculo, o
// salário contratual, o ponto fechado, o sobreaviso realizado, os afastamentos, a tabela legal, os dias de afastamento a
// cargo da empresa, os parâmetros da empresa e as rubricas, e recebe as linhas de cada vínculo com a memória, os totais
// e as pendências que barram a gravação. Nenhum valor legal no código (regra 7): alíquotas, faixas, tetos, percentuais e
// dias vêm das vigências; aqui só estão as fórmulas da lei. Valores em centavos (inteiros); percentuais em centésimos de
// ponto; os produtos são feitos em BigInt e arredondados uma vez, meio centavo para cima.
//
// Decisões (POL-5, dono confirma; registradas nas evidências do M53.3):
// - D-TIPO-533: só os vínculos `clt` entram na folha mensal; os demais tipos (cooperado, PJ, terceiro, estatutário,
//   residente, estagiário) contam em `foraDaFolha` (bolsa, RPA e regime próprio ficam fora desta etapa).
// - D-DESLIG-533: vínculo desligado dentro da competência fica fora da folha mensal: o saldo de salário sai na rescisão
//   (M53-F4), para não pagar duas vezes.
// - D-DIAS-533: mês comercial de 30 dias; dias não pagos = antes da admissão + afastamento além dos dias a cargo da
//   empresa (contados do início de cada afastamento); afastamento o mês inteiro = 0 dia pago.
// - D-SAL-533: o salário é o contratual em vigor no último dia da competência (aumento no meio do mês vale o mês todo;
//   a diferença retroativa é lançamento da competência seguinte).
// - D-HORA-533: valor da hora = salário ÷ divisor (o dos parâmetros; sem ele, carga semanal × 5). Hora extra pelo tipo
//   de hora do fechamento (excedente → 50%; descanso e feriado → 100%); adicional noturno, faltas e atrasos pelos tipos
//   de integração do fechamento; sobreaviso pelos minutos de plantão de sobreaviso realizados (um terço da hora).
// - D-DSR-533: descanso sobre as variáveis (horas extras e adicional noturno) = variáveis × domingos ÷ dias úteis do
//   mês; os feriados não entram (calendário de feriados é cadastro de outra etapa).
// - D-SF-533: salário-família pela remuneração do mês (base do INSS), cota × dependentes, proporcional aos dias pagos.
// - D-RED-533: redução do IRRF da lei de 2026 (Lei 15.270/2025): renda tributável até `isencaoAte` → redução até
//   `valor`, limitada ao imposto; entre `reducaoDe` e `reducaoAte` → `valor` × (reducaoAte − renda) ÷ (reducaoAte −
//   reducaoDe); acima de `semReducaoAcimaDe` → zero. Com os números da lei (312,89; 5.000; 7.350) é a fórmula
//   978,62 − 0,133145 × renda.
// - D-IRRF-533: dedução do IRRF = o maior entre (INSS + dependentes × dedução) e o desconto simplificado.
// M53-F3 (M53.4), D-FERMES-534: os dias de férias do recibo gravado saem dos dias pagos do mês (30 − dias de gozo no
// mês); no mês do início do gozo o INSS é o da base do mês somada à base do recibo, menos o INSS já retido no recibo
// (salário de contribuição único do mês). O FGTS e os encargos do recibo ficam no recibo.
import type {
  ColaboradorCalculado,
  DiasAfastamentoFolha,
  FaixaTabelaLegal,
  LinhaCalculoFolha,
  PapelCalculoFolha,
  PapelLinhaFolha,
  ParametrosFolha,
  PendenciaCalculo,
  RubricaFolha,
  TabelaLegalFolha,
  TipoVinculoTrabalho,
  TotaisCalculoFolha,
  UnidadeLinhaFolha,
} from '@sgh/contratos';
import { TIPO_DO_PAPEL } from '@sgh/contratos';
import { diaUtc } from '../datas.js';
import {
  conferirTabelaLegal,
  fimDaCompetencia,
  rubricaVigenteNaCompetencia,
  vigenteNaCompetencia,
  vigenteNaData,
} from './vigencia.js';

/** Tipos de integração do ponto (domínio de eventos do fechamento) que o cálculo usa. */
export const EVENTO_PONTO_CALCULO = { faltas: '3', atrasos: '4', adicionalNoturno: '5' } as const;
/** Tipos de hora do fechamento que o cálculo usa: excedente (50%), descanso e feriado (100%). */
export const TIPO_HORA_CALCULO = { horaExtra50: ['5'], horaExtra100: ['3', '4'] } as const;

export const DIAS_MES_COMERCIAL = 30;

export interface VinculoParaCalculo {
  readonly id: number;
  readonly matricula: string | null;
  readonly tipo: TipoVinculoTrabalho;
  readonly admissao: string;
  readonly desligamento: string | null;
  readonly centroCusto: number;
  readonly cargaSemanal: number;
}

export interface SalarioParaCalculo {
  readonly vinculo: number;
  readonly inicio: string;
  readonly salario: number;
  readonly dependentesIrrf: number;
  readonly dependentesSalarioFamilia: number;
  readonly insalubridade: number;
  readonly periculosidade: boolean;
}

export interface AfastamentoParaCalculo {
  readonly vinculo: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly situacao: string;
}

/** O ponto fechado do vínculo: minutos por tipo de integração e por tipo de hora. */
export interface PontoFechadoParaCalculo {
  readonly eventos: Readonly<Record<string, number>>;
  readonly horas: Readonly<Record<string, number>>;
}

/** As férias do recibo gravado que tocam a competência (D-FERMES-534). */
export interface FeriasNoMesParaCalculo {
  /** Dias de gozo dentro da competência (corridos). */
  readonly dias: number;
  /** Base do INSS e INSS retido no recibo, só na competência do início do gozo (nas demais, 0). */
  readonly baseInss: number;
  readonly inss: number;
}

export interface EntradaCalculoFolha {
  readonly empresa: number;
  readonly competencia: string;
  /** Hoje (AAAA-MM-DD): a competência só é calculada depois do último dia. */
  readonly hoje: string;
  readonly vinculos: readonly VinculoParaCalculo[];
  readonly salarios: readonly SalarioParaCalculo[];
  /** Só os vínculos com o período de ponto fechado. */
  readonly ponto: ReadonlyMap<number, PontoFechadoParaCalculo>;
  /** Minutos de sobreaviso realizados e aprovados na competência, por vínculo. */
  readonly sobreaviso: ReadonlyMap<number, number>;
  readonly afastamentos: readonly AfastamentoParaCalculo[];
  readonly tabelasLegais: readonly TabelaLegalFolha[];
  readonly diasAfastamento: readonly DiasAfastamentoFolha[];
  readonly parametros: readonly ParametrosFolha[];
  readonly rubricas: readonly RubricaFolha[];
  /** As férias com recibo gravado na competência, por vínculo (M53-F3; ausente: nenhuma). */
  readonly ferias?: ReadonlyMap<number, FeriasNoMesParaCalculo>;
}

export interface VinculoCalculado {
  readonly resumo: ColaboradorCalculado;
  readonly linhas: readonly LinhaCalculoFolha[];
}

export interface ResultadoCalculoFolhaPuro {
  readonly pendencias: readonly PendenciaCalculo[];
  readonly colaboradores: readonly VinculoCalculado[];
  readonly totais: TotaisCalculoFolha;
  readonly foraDaFolha: number;
  readonly tabelaLegal: string | null;
  readonly parametros: string | null;
}

// ── Aritmética ────────────────────────────────────────────────────────────────────────────────────────────────

/** round(Π num ÷ Π den), meio para cima, sobre inteiros não negativos (BigInt: sem perda acima de 2^53). */
export function multiplicarDividir(num: readonly number[], den: readonly number[]): number {
  let n = 1n;
  for (const x of num) n *= BigInt(Math.trunc(x));
  let d = 1n;
  for (const x of den) d *= BigInt(Math.trunc(x));
  if (d === 0n) throw new Error('divisão por zero no cálculo da folha');
  if (n < 0n) throw new Error('valor negativo no cálculo da folha');
  return Number((n * 2n + d) / (d * 2n));
}

const milhar = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** R$ 1.234,56 (memória do cálculo; sem Intl, para a memória ser a mesma em qualquer máquina). */
export function reais(centavos: number): string {
  const c = Math.round(centavos);
  const s = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return `${s}R$ ${milhar(Math.floor(a / 100))},${String(a % 100).padStart(2, '0')}`;
}

/** 15h30 */
export function horasMin(minutos: number): string {
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}`;
}

/** 7,5% (centésimos de ponto) */
export function pct(centesimos: number): string {
  const i = Math.floor(centesimos / 100);
  const f = centesimos % 100;
  return f === 0 ? `${i}%` : `${i},${String(f).padStart(2, '0').replace(/0$/, '')}%`;
}

// ── Tabelas legais ────────────────────────────────────────────────────────────────────────────────────────────

/** INSS do empregado, progressivo por faixa (cada faixa sobre a parte da base dentro dela), até o teto. */
export function inssProgressivo(
  base: number,
  t: TabelaLegalFolha['inss'],
): { valor: number; memoria: string } {
  const faixas = t.faixas;
  const ultimaAte = faixas.at(-1)?.ate ?? null;
  const teto = t.teto > 0 ? t.teto : (ultimaAte ?? base);
  const b = Math.min(base, teto);
  let soma = 0n;
  let anterior = 0;
  const partes: string[] = [];
  for (const f of faixas) {
    if (b <= anterior) break;
    const topo = f.ate === null ? b : Math.min(b, f.ate);
    const parte = Math.max(0, topo - anterior);
    if (parte > 0) {
      soma += BigInt(parte) * BigInt(f.aliquota);
      partes.push(`${reais(parte)} × ${pct(f.aliquota)}`);
    }
    if (f.ate === null) break;
    anterior = f.ate;
  }
  const valor = Number((soma * 2n + 10_000n) / 20_000n);
  const limitado = base > teto ? ` (base limitada ao teto de ${reais(teto)})` : '';
  return { valor, memoria: `${partes.join(' + ') || 'base zero'}${limitado}` };
}

function faixaDa(base: number, faixas: readonly FaixaTabelaLegal[]): FaixaTabelaLegal | null {
  for (const f of faixas) if (f.ate === null || base <= f.ate) return f;
  return null;
}

/** IRRF mensal: base = renda − dedução (D-IRRF-533); imposto da faixa − parcela a deduzir; menos a redução (D-RED-533). */
export function irrfMensal(
  renda: number,
  inss: number,
  dependentes: number,
  t: TabelaLegalFolha['irrf'],
): { valor: number; base: number; memoria: string } {
  const legais = inss + dependentes * t.deducaoDependente;
  const simplificado = t.descontoSimplificado > legais;
  const deducao = simplificado ? t.descontoSimplificado : legais;
  const base = Math.max(0, renda - deducao);
  const f = faixaDa(base, t.faixas);
  const bruto = f ? Math.max(0, multiplicarDividir([base, f.aliquota], [10_000]) - f.deducao) : 0;
  const r = t.reducao;
  let reducao = 0;
  if (r.valor > 0) {
    if (renda <= r.isencaoAte) reducao = Math.min(bruto, r.valor);
    else if (renda >= r.reducaoDe && renda <= r.reducaoAte && r.reducaoAte > r.reducaoDe)
      reducao = Math.min(
        bruto,
        multiplicarDividir([r.valor, r.reducaoAte - renda], [r.reducaoAte - r.reducaoDe]),
      );
    if (r.semReducaoAcimaDe > 0 && renda > r.semReducaoAcimaDe) reducao = 0;
  }
  const valor = Math.max(0, bruto - reducao);
  const ded = simplificado
    ? `desconto simplificado ${reais(t.descontoSimplificado)}`
    : `INSS ${reais(inss)} + ${dependentes} dependente(s) × ${reais(t.deducaoDependente)}`;
  const faixa = f ? `${pct(f.aliquota)} - ${reais(f.deducao)}` : 'sem faixa';
  const red = reducao > 0 ? `; redução ${reais(reducao)}` : '';
  return {
    valor,
    base,
    memoria: `(${reais(renda)} - ${ded}) = ${reais(base)} × ${faixa} = ${reais(bruto)}${red}`,
  };
}

/** Cota do salário-família pela remuneração do mês (D-SF-533). */
export function cotaSalarioFamilia(remuneracao: number, t: TabelaLegalFolha['salarioFamilia']): number {
  for (const f of t) if (remuneracao >= f.de && remuneracao <= f.ate) return f.cota;
  return 0;
}

// ── Calendário da competência ─────────────────────────────────────────────────────────────────────────────────

// `diaUtc` devolve o número do dia (dias desde 1970-01-01, UTC).
const isoDe = (dia: number) => new Date(dia * 86_400_000).toISOString().slice(0, 10);

export function diasDoMes(competencia: string): number {
  return Number(fimDaCompetencia(competencia).slice(8, 10));
}

export function domingosDoMes(competencia: string): number {
  const ini = diaUtc(`${competencia}-01`);
  const n = diasDoMes(competencia);
  let d = 0;
  for (let i = 0; i < n; i++) if (new Date((ini + i) * 86_400_000).getUTCDay() === 0) d++;
  return d;
}

/** Dias corridos de [a, b] dentro de [ini, fim] (datas AAAA-MM-DD; b null = sem fim). */
function diasNoIntervalo(a: string, b: string | null, ini: string, fim: string): number {
  const x = Math.max(diaUtc(a), diaUtc(ini));
  const y = Math.min(b === null ? Number.MAX_SAFE_INTEGER : diaUtc(b), diaUtc(fim));
  return y < x ? 0 : y - x + 1;
}

/**
 * Dias pagos no mês comercial (D-DIAS-533): 30 − (dias antes da admissão + dias de afastamento além dos que a empresa
 * paga). Cada afastamento conta do próprio início; afastamentos que se tocam não somam os dias da empresa de novo
 * (regra simples desta etapa: cada registro é um afastamento).
 */
export function diasPagos(
  v: Pick<VinculoParaCalculo, 'admissao'>,
  afastamentos: readonly AfastamentoParaCalculo[],
  competencia: string,
  diasEmpresa: number,
): { dias: number; naoPagos: number; antesDaAdmissao: number; afastado: number } {
  const ini = `${competencia}-01`;
  const fim = fimDaCompetencia(competencia);
  const mes = diasDoMes(competencia);
  const antes =
    diaUtc(v.admissao) > diaUtc(ini) ? diasNoIntervalo(ini, isoDe(diaUtc(v.admissao) - 1), ini, fim) : 0;
  let afastado = 0;
  for (const a of afastamentos) {
    if (a.situacao !== 'ativo') continue;
    const desde = isoDe(diaUtc(a.inicio) + diasEmpresa);
    if (a.fim !== null && diaUtc(desde) > diaUtc(a.fim)) continue;
    afastado += diasNoIntervalo(desde, a.fim, ini, fim);
  }
  const naoPagos = Math.min(mes, antes + afastado);
  const dias = naoPagos >= mes ? 0 : Math.max(0, DIAS_MES_COMERCIAL - naoPagos);
  return { dias, naoPagos, antesDaAdmissao: antes, afastado };
}

// ── Cálculo do vínculo ────────────────────────────────────────────────────────────────────────────────────────

export interface Bruta {
  papel: PapelCalculoFolha;
  quantidade: number;
  unidade: UnidadeLinhaFolha;
  valor: number;
  memoria: string;
}

export interface ContextoVinculo {
  readonly competencia: string;
  readonly salario: SalarioParaCalculo;
  readonly ponto: PontoFechadoParaCalculo;
  readonly sobreaviso: number;
  readonly dias: ReturnType<typeof diasPagos>;
  readonly tabela: TabelaLegalFolha;
  readonly parametros: ParametrosFolha;
  /** A rubrica de cada papel (já conferida). */
  readonly rubricas: ReadonlyMap<PapelCalculoFolha, RubricaFolha>;
  /** As férias do recibo no mês (D-FERMES-534); ausente: nenhuma. */
  readonly ferias?: FeriasNoMesParaCalculo;
}

const minutosDe = (r: Readonly<Record<string, number>>, chaves: readonly string[]) =>
  chaves.reduce((s, k) => s + Math.max(0, Math.trunc(r[k] ?? 0)), 0);

/** Os proventos e os descontos de ponto do vínculo, antes das incidências (não dependem da rubrica). */
export function proventosDoVinculo(
  v: Pick<VinculoParaCalculo, 'cargaSemanal'>,
  c: Omit<ContextoVinculo, 'rubricas'>,
): Bruta[] {
  const out: Bruta[] = [];
  const s = c.salario;
  const p = c.parametros.percentuais;
  const divisor = c.parametros.divisorHoras ?? v.cargaSemanal * 5;
  const hora = `${reais(s.salario)} ÷ ${divisor} h`;
  const add = (b: Bruta) => {
    if (b.valor > 0) out.push(b);
  };
  const base = multiplicarDividir([s.salario, c.dias.dias], [DIAS_MES_COMERCIAL]);
  add({
    papel: 'salario',
    quantidade: c.dias.dias,
    unidade: 'dias',
    valor: base,
    memoria: `${reais(s.salario)} × ${c.dias.dias}/${DIAS_MES_COMERCIAL} dias${
      c.ferias && c.ferias.dias > 0 ? ` (${c.ferias.dias} dia(s) de férias no recibo)` : ''
    }`,
  });
  const porHora = (papel: PapelCalculoFolha, minutos: number, percentual: number, rotulo: string) =>
    add({
      papel,
      quantidade: minutos,
      unidade: 'minutos',
      valor: multiplicarDividir([s.salario, minutos, percentual], [divisor, 60, 10_000]),
      memoria: `${horasMin(minutos)} × (${hora}) × ${pct(percentual)}${rotulo}`,
    });
  const he50 = minutosDe(c.ponto.horas, TIPO_HORA_CALCULO.horaExtra50);
  const he100 = minutosDe(c.ponto.horas, TIPO_HORA_CALCULO.horaExtra100);
  const noturno = minutosDe(c.ponto.eventos, [EVENTO_PONTO_CALCULO.adicionalNoturno]);
  porHora('horaExtra50', he50, 10_000 + p.horaExtra50, '');
  porHora('horaExtra100', he100, 10_000 + p.horaExtra100, '');
  porHora('adicionalNoturno', noturno, p.adicionalNoturno, '');
  const variaveis = out
    .filter((b) => b.papel === 'horaExtra50' || b.papel === 'horaExtra100' || b.papel === 'adicionalNoturno')
    .reduce((t, b) => t + b.valor, 0);
  const domingos = domingosDoMes(c.competencia);
  const uteis = diasDoMes(c.competencia) - domingos;
  add({
    papel: 'dsrVariaveis',
    quantidade: domingos,
    unidade: 'dias',
    valor: variaveis > 0 ? multiplicarDividir([variaveis, domingos], [uteis]) : 0,
    memoria: `${reais(variaveis)} × ${domingos} domingos ÷ ${uteis} dias úteis`,
  });
  porHora('sobreaviso', c.sobreaviso, p.sobreaviso, ' (sobreaviso)');
  if (s.insalubridade > 0)
    add({
      papel: 'insalubridade',
      quantidade: s.insalubridade,
      unidade: 'percentual',
      valor: multiplicarDividir(
        [c.tabela.salarioMinimo, s.insalubridade, c.dias.dias],
        [10_000, DIAS_MES_COMERCIAL],
      ),
      memoria: `${reais(c.tabela.salarioMinimo)} × ${pct(s.insalubridade)} × ${c.dias.dias}/${DIAS_MES_COMERCIAL} dias`,
    });
  if (s.periculosidade)
    add({
      papel: 'periculosidade',
      quantidade: p.periculosidade,
      unidade: 'percentual',
      valor: multiplicarDividir([base, p.periculosidade], [10_000]),
      memoria: `${reais(base)} × ${pct(p.periculosidade)}`,
    });
  const faltas = minutosDe(c.ponto.eventos, [EVENTO_PONTO_CALCULO.faltas]);
  const atrasos = minutosDe(c.ponto.eventos, [EVENTO_PONTO_CALCULO.atrasos]);
  porHora('faltas', faltas, 10_000, '');
  porHora('atrasos', atrasos, 10_000, '');
  return out;
}

export const incide = (r: RubricaFolha | undefined, tributo: 'inss' | 'irrf' | 'fgts') =>
  r?.incidencias[tributo] === true;

export function linhaDaBruta(b: Bruta, r: RubricaFolha | undefined): LinhaCalculoFolha {
  return {
    papel: b.papel,
    tipo: TIPO_DO_PAPEL[b.papel],
    rubrica: r?.id ?? null,
    codigoRubrica: r?.codigo ?? null,
    quantidade: b.quantidade,
    unidade: b.unidade,
    valor: b.valor,
    memoria: b.memoria.slice(0, 400),
  };
}

export function linhaInformativa(
  papel: PapelLinhaFolha,
  valor: number,
  memoria: string,
  quantidade = 0,
): LinhaCalculoFolha {
  return {
    papel,
    tipo: TIPO_DO_PAPEL[papel],
    rubrica: null,
    codigoRubrica: null,
    quantidade,
    unidade: quantidade > 0 ? 'percentual' : 'valor',
    valor,
    memoria: memoria.slice(0, 400),
  };
}

/** As linhas do vínculo depois das incidências: bases, salário-família, INSS, IRRF, FGTS e encargos da empresa. */
export function calcularVinculo(v: VinculoParaCalculo, c: ContextoVinculo): VinculoCalculado {
  const brutas = proventosDoVinculo(v, c);
  const rub = (p: PapelCalculoFolha) => c.rubricas.get(p);
  const baseDe = (tributo: 'inss' | 'irrf' | 'fgts', xs: readonly Bruta[]) => {
    let b = 0;
    const partes: string[] = [];
    for (const x of xs) {
      if (!incide(rub(x.papel), tributo)) continue;
      const sinal = TIPO_DO_PAPEL[x.papel] === 'desconto' ? -1 : 1;
      b += sinal * x.valor;
      partes.push(`${sinal < 0 ? '- ' : partes.length ? '+ ' : ''}${reais(x.valor)}`);
    }
    return { valor: Math.max(0, b), memoria: partes.join(' ') || 'nenhuma rubrica incide' };
  };
  // O salário-família não incide em tributo (a rubrica diz); entra depois da base do INSS, que é a remuneração.
  const bInss0 = baseDe('inss', brutas);
  const cota = cotaSalarioFamilia(bInss0.valor, c.tabela.salarioFamilia);
  if (cota > 0 && c.salario.dependentesSalarioFamilia > 0) {
    const valor = multiplicarDividir(
      [cota, c.salario.dependentesSalarioFamilia, c.dias.dias],
      [DIAS_MES_COMERCIAL],
    );
    if (valor > 0)
      brutas.push({
        papel: 'salarioFamilia',
        quantidade: c.salario.dependentesSalarioFamilia,
        unidade: 'dependentes',
        valor,
        memoria: `${c.salario.dependentesSalarioFamilia} dependente(s) × ${reais(cota)} × ${c.dias.dias}/${DIAS_MES_COMERCIAL} dias`,
      });
  }
  const bInss = baseDe('inss', brutas);
  const bIrrf = baseDe('irrf', brutas);
  const bFgts = baseDe('fgts', brutas);
  const inss = inssDoMes(bInss.valor, c.tabela.inss, c.ferias);
  if (inss.valor > 0)
    brutas.push({ papel: 'inss', quantidade: 0, unidade: 'valor', valor: inss.valor, memoria: inss.memoria });
  const irrf = irrfMensal(bIrrf.valor, inss.valor, c.salario.dependentesIrrf, c.tabela.irrf);
  if (irrf.valor > 0)
    brutas.push({
      papel: 'irrf',
      quantidade: c.salario.dependentesIrrf,
      unidade: 'dependentes',
      valor: irrf.valor,
      memoria: irrf.memoria,
    });
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
  const patronal = multiplicarDividir([bInss.valor, e.inssPatronal], [10_000]);
  const rat = multiplicarDividir([bInss.valor, e.ratAjustado], [10_000]);
  const terceiros = multiplicarDividir([bInss.valor, e.terceiros], [10_000]);
  linhas.push(
    linhaInformativa('baseInss', bInss.valor, bInss.memoria),
    linhaInformativa('baseIrrf', bIrrf.valor, `${bIrrf.memoria}; base de cálculo ${reais(irrf.base)}`),
    linhaInformativa('baseFgts', bFgts.valor, bFgts.memoria),
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
      diasPagos: c.dias.dias,
      proventos,
      descontos,
      liquido: Math.max(0, proventos - descontos),
      baseInss: bInss.valor,
      baseIrrf: bIrrf.valor,
      baseFgts: bFgts.valor,
      inss: inss.valor,
      irrf: irrf.valor,
      fgts,
      encargos: patronal + rat + terceiros,
    },
    linhas,
  };
}

/**
 * INSS do mês (D-FERMES-534): sem férias, o progressivo da base; no mês do início do gozo, o progressivo da base do mês
 * somada à do recibo, menos o INSS já retido no recibo (nunca negativo).
 */
export function inssDoMes(
  base: number,
  t: TabelaLegalFolha['inss'],
  ferias?: FeriasNoMesParaCalculo,
): { valor: number; memoria: string } {
  if (!ferias || ferias.baseInss <= 0) return inssProgressivo(base, t);
  const total = inssProgressivo(base + ferias.baseInss, t);
  const valor = Math.max(0, total.valor - ferias.inss);
  return {
    valor,
    memoria: `(${reais(base)} + ${reais(ferias.baseInss)} do recibo de férias): ${total.memoria} = ${reais(
      total.valor,
    )} - ${reais(ferias.inss)} retido no recibo`,
  };
}

// ── Cálculo da competência ────────────────────────────────────────────────────────────────────────────────────

/** O vínculo entra na folha mensal da competência (D-TIPO-533, D-DESLIG-533)? */
export function entraNaFolhaMensal(v: VinculoParaCalculo, competencia: string): boolean {
  const ini = diaUtc(`${competencia}-01`);
  const fim = diaUtc(fimDaCompetencia(competencia));
  if (v.tipo !== 'clt') return false;
  if (diaUtc(v.admissao) > fim) return false;
  if (v.desligamento !== null && diaUtc(v.desligamento) <= fim) return false;
  return !(v.desligamento !== null && diaUtc(v.desligamento) < ini);
}

/** A rubrica serve ao papel: existe na empresa, ativa, em vigor e do tipo do papel. */
export function rubricaServeAoPapel(r: RubricaFolha, papel: PapelCalculoFolha, competencia: string): boolean {
  if (!r.ativa || !rubricaVigenteNaCompetencia(r.vigencia, competencia)) return false;
  const t = TIPO_DO_PAPEL[papel];
  if (t === 'provento') return r.tipo === 'provento';
  if (t === 'desconto') return r.tipo === 'desconto';
  return r.tipo === 'base' || r.tipo === 'informativa' || r.tipo === 'informativaDedutora';
}

const totaisZero = (): TotaisCalculoFolha => ({
  colaboradores: 0,
  proventos: 0,
  descontos: 0,
  liquido: 0,
  inss: 0,
  irrf: 0,
  fgts: 0,
  inssPatronal: 0,
  rat: 0,
  terceiros: 0,
});

/** Os totais da folha pela soma das linhas de cada vínculo (a prova da soma confere com a soma dos resumos). */
export function totalizarCalculo(cs: readonly VinculoCalculado[]): TotaisCalculoFolha {
  const t = totaisZero();
  t.colaboradores = cs.length;
  for (const c of cs) {
    t.proventos += c.resumo.proventos;
    t.descontos += c.resumo.descontos;
    t.liquido += c.resumo.liquido;
    t.inss += c.resumo.inss;
    t.irrf += c.resumo.irrf;
    t.fgts += c.resumo.fgts;
    for (const l of c.linhas) {
      if (l.papel === 'inssPatronal') t.inssPatronal += l.valor;
      if (l.papel === 'rat') t.rat += l.valor;
      if (l.papel === 'terceiros') t.terceiros += l.valor;
    }
  }
  return t;
}

function pendencia(
  mapa: Map<string, PendenciaCalculo>,
  codigo: PendenciaCalculo['codigo'],
  vinculo: number | null,
  papel: PapelCalculoFolha | null = null,
) {
  const k = `${codigo}:${papel ?? ''}`;
  const p = mapa.get(k) ?? { codigo, vinculos: [], papel };
  if (vinculo !== null && !p.vinculos.includes(vinculo)) (p.vinculos as number[]).push(vinculo);
  mapa.set(k, p);
}

/**
 * Calcula a folha mensal da competência. Com qualquer pendência, `colaboradores` traz só os vínculos sem pendência
 * própria (a prévia) e a gravação é recusada por quem chama.
 */
export function calcularFolhaCompetencia(e: EntradaCalculoFolha): ResultadoCalculoFolhaPuro {
  const pend = new Map<string, PendenciaCalculo>();
  const fim = fimDaCompetencia(e.competencia);
  if (diaUtc(e.hoje) <= diaUtc(fim)) pendencia(pend, 'competencia-futura', null);
  const tabela = vigenteNaCompetencia(e.tabelasLegais, e.competencia);
  if (!tabela) pendencia(pend, 'sem-tabela-legal', null);
  else if (conferirTabelaLegal(tabela).length > 0) pendencia(pend, 'tabela-legal-divergente', null);
  const parametros = vigenteNaCompetencia(
    e.parametros.filter((p) => p.empresa === e.empresa),
    e.competencia,
  );
  if (!parametros) pendencia(pend, 'sem-parametros', null);
  const dias = vigenteNaCompetencia(e.diasAfastamento, e.competencia);

  const naFolha = e.vinculos.filter((v) => entraNaFolhaMensal(v, e.competencia));
  const foraDaFolha = e.vinculos.length - naFolha.length;
  if (naFolha.length === 0) pendencia(pend, 'sem-colaboradores', null);

  const rubricas = new Map<PapelCalculoFolha, RubricaFolha>();
  const invalidas = new Set<PapelCalculoFolha>();
  if (parametros)
    for (const [papel, id] of Object.entries(parametros.rubricas) as [PapelCalculoFolha, number | null][]) {
      if (id === null) continue;
      const r = e.rubricas.find((x) => x.id === id && x.empresa === e.empresa);
      if (r && rubricaServeAoPapel(r, papel, e.competencia)) rubricas.set(papel, r);
      else invalidas.add(papel);
    }

  const colaboradores: VinculoCalculado[] = [];
  for (const v of [...naFolha].sort((a, b) => a.id - b.id)) {
    const ponto = e.ponto.get(v.id);
    const salario = vigenteNaData(
      e.salarios.filter((s) => s.vinculo === v.id),
      fim,
    );
    const afast = e.afastamentos.filter((a) => a.vinculo === v.id && a.situacao === 'ativo');
    let proprio = false;
    if (!ponto) {
      pendencia(pend, 'ponto-nao-fechado', v.id);
      proprio = true;
    }
    if (!salario) {
      pendencia(pend, 'sem-salario', v.id);
      proprio = true;
    }
    if (afast.length > 0 && !dias) pendencia(pend, 'sem-tabela-legal', null);
    if (proprio || !ponto || !salario || !tabela || !parametros || (afast.length > 0 && !dias)) continue;
    const fer = e.ferias?.get(v.id);
    const d0 = diasPagos(v, afast, e.competencia, dias?.dias ?? 0);
    const ctx: ContextoVinculo = {
      competencia: e.competencia,
      salario,
      ponto,
      sobreaviso: e.sobreaviso.get(v.id) ?? 0,
      dias: fer && fer.dias > 0 ? { ...d0, dias: Math.max(0, d0.dias - fer.dias) } : d0,
      tabela,
      parametros,
      rubricas,
      ...(fer ? { ferias: fer } : {}),
    };
    const calc = calcularVinculo(v, ctx);
    let falta = false;
    for (const l of calc.linhas) {
      if (l.tipo === 'base' || l.papel === 'inssPatronal' || l.papel === 'rat' || l.papel === 'terceiros')
        continue;
      if (l.valor === 0) continue;
      const papel = l.papel as PapelCalculoFolha;
      if (rubricas.has(papel)) continue;
      pendencia(pend, invalidas.has(papel) ? 'rubrica-invalida' : 'papel-sem-rubrica', v.id, papel);
      falta = true;
    }
    if (calc.resumo.descontos > calc.resumo.proventos) {
      pendencia(pend, 'liquido-negativo', v.id);
      falta = true;
    }
    if (!falta) colaboradores.push(calc);
  }
  const pendencias = [...pend.values()]
    .map((p) => ({ ...p, vinculos: [...p.vinculos].sort((a, b) => a - b) }))
    .sort((a, b) => (a.codigo + (a.papel ?? '')).localeCompare(b.codigo + (b.papel ?? '')));
  return {
    pendencias,
    colaboradores,
    totais: totalizarCalculo(colaboradores),
    foraDaFolha,
    tabelaLegal: tabela?.inicio ?? null,
    parametros: parametros?.inicio ?? null,
  };
}

/**
 * Prova da soma (regra 8): em cada vínculo, proventos − descontos = líquido e a soma das linhas bate com o resumo; a
 * soma dos vínculos bate com os totais. As parcelas saem impressas para a tela e o relatório.
 */
export function conferirCalculo(
  cs: readonly { resumo: ColaboradorCalculado; linhas?: readonly LinhaCalculoFolha[] }[],
  totais: TotaisCalculoFolha,
): { ok: boolean; parcelas: { rotulo: string; valor: number }[]; divergencias: string[] } {
  const div: string[] = [];
  let p = 0;
  let d = 0;
  let l = 0;
  for (const c of cs) {
    const r = c.resumo;
    if (r.proventos - r.descontos !== r.liquido)
      div.push(`vinculo ${r.vinculo}: proventos − descontos ≠ líquido`);
    if (c.linhas) {
      const s = (t: string) => c.linhas!.filter((x) => x.tipo === t).reduce((a, x) => a + x.valor, 0);
      if (s('provento') !== r.proventos) div.push(`vinculo ${r.vinculo}: soma dos proventos ≠ resumo`);
      if (s('desconto') !== r.descontos) div.push(`vinculo ${r.vinculo}: soma dos descontos ≠ resumo`);
    }
    p += r.proventos;
    d += r.descontos;
    l += r.liquido;
  }
  if (cs.length !== totais.colaboradores) div.push('colaboradores ≠ total');
  if (p !== totais.proventos) div.push('soma dos proventos ≠ total');
  if (d !== totais.descontos) div.push('soma dos descontos ≠ total');
  if (l !== totais.liquido) div.push('soma dos líquidos ≠ total');
  if (totais.proventos - totais.descontos !== totais.liquido)
    div.push('proventos − descontos ≠ líquido (total)');
  return {
    ok: div.length === 0,
    parcelas: [
      { rotulo: 'proventos', valor: totais.proventos },
      { rotulo: 'descontos', valor: totais.descontos },
      { rotulo: 'liquido', valor: totais.liquido },
      { rotulo: 'somaProventosVinculos', valor: p },
      { rotulo: 'somaDescontosVinculos', valor: d },
      { rotulo: 'somaLiquidosVinculos', valor: l },
    ],
    divergencias: div,
  };
}
