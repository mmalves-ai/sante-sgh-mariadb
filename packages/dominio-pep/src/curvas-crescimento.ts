// Curvas de crescimento e gráficos clínicos de referência (03-PEP L141). Regras puras: a escolha da referência pela
// idade (OMS 2006 até 5 anos, OMS 2007 de 5 a 19 anos, INTERGROWTH-21st para o prematuro até 64 semanas de idade
// pós-menstrual e idade corrigida até os 2 anos, como orientam a Caderneta da Criança do Ministério da Saúde e a
// Sociedade Brasileira de Pediatria), o escore Z pelo método LMS da OMS (com o ajuste restrito além de ±3 nas medidas
// assimétricas), o escore Z pelas linhas de desvio do INTERGROWTH, o percentil, a classificação do estado nutricional
// pelos pontos de corte do Ministério da Saúde (SISVAN) e a validação da medida antes de gravar.
import type { FalhaRegra } from './farmacovigilancia.js';

export const INDICADORES_CRESCIMENTO = ['peso', 'estatura', 'perimetro_cefalico', 'imc'] as const;
export type IndicadorCrescimento = (typeof INDICADORES_CRESCIMENTO)[number];
/** Código do parâmetro vital (afericao_valor) e da curva de cada indicador. */
export const PARAMETRO_DO_INDICADOR: Readonly<Record<IndicadorCrescimento, string>> = {
  peso: 'peso',
  estatura: 'altura',
  perimetro_cefalico: 'perimetro_cefalico',
  imc: 'imc',
};
/** Linhas de escore Z desenhadas no gráfico (as da Caderneta da Criança). */
export const ZS_GRAFICO = [-3, -2, 0, 2, 3] as const;
export const DIAS_POR_MES = 30.4375;
const DIA = 86_400_000;
const TOLERANCIA_X = 0.01;

export interface PontoLms {
  readonly x: number;
  readonly l: number;
  readonly m: number;
  readonly s: number;
}
/** Linhas -3, -2, -1, 0, +1, +2, +3 numa abscissa. */
export interface PontoLinhasZ {
  readonly x: number;
  readonly z: readonly number[];
}
export type CurvaCalculo =
  | { readonly tipo: 'lms'; readonly pontos: readonly PontoLms[] }
  | { readonly tipo: 'linhas_z'; readonly pontos: readonly PontoLinhasZ[] };

/** Valor da medida no escore Z pela fórmula LMS (Box-Cox). */
export function valorLms(z: number, l: number, m: number, s: number): number {
  if (Math.abs(l) < 1e-9) return m * Math.exp(s * z);
  return m * Math.pow(1 + l * s * z, 1 / l);
}

/**
 * Escore Z pelo LMS. `restrito` aplica o ajuste da OMS além de ±3 (peso e IMC, curvas assimétricas): fora da faixa a
 * distância é medida em unidades do intervalo entre os desvios 2 e 3, para não comprimir os extremos.
 */
export function zLms(y: number, l: number, m: number, s: number, restrito = Math.abs(l - 1) > 1e-9): number {
  const z = Math.abs(l) < 1e-9 ? Math.log(y / m) / s : (Math.pow(y / m, l) - 1) / (l * s);
  if (!restrito) return z;
  if (z > 3) {
    const sd3 = valorLms(3, l, m, s);
    return 3 + (y - sd3) / (sd3 - valorLms(2, l, m, s));
  }
  if (z < -3) {
    const sd3 = valorLms(-3, l, m, s);
    return -3 + (y - sd3) / (valorLms(-2, l, m, s) - sd3);
  }
  return z;
}

function entre<T extends { x: number }>(pontos: readonly T[], x: number): [T, T, number] | null {
  if (pontos.length === 0) return null;
  const primeiro = pontos[0]!;
  const ultimo = pontos[pontos.length - 1]!;
  if (x < primeiro.x - TOLERANCIA_X || x > ultimo.x + TOLERANCIA_X) return null;
  if (x <= primeiro.x) return [primeiro, primeiro, 0];
  if (x >= ultimo.x) return [ultimo, ultimo, 0];
  let i = 1;
  while (pontos[i]!.x < x) i++;
  const a = pontos[i - 1]!;
  const b = pontos[i]!;
  return [a, b, b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)];
}
const lin = (a: number, b: number, f: number) => a + (b - a) * f;

/** LMS na abscissa, interpolado linearmente entre os pontos publicados; null fora da faixa da curva. */
export function lmsEm(pontos: readonly PontoLms[], x: number): Omit<PontoLms, 'x'> | null {
  const e = entre(pontos, x);
  if (!e) return null;
  const [a, b, f] = e;
  return { l: lin(a.l, b.l, f), m: lin(a.m, b.m, f), s: lin(a.s, b.s, f) };
}

/** As 7 linhas de desvio na abscissa; null fora da faixa. */
export function linhasEm(pontos: readonly PontoLinhasZ[], x: number): number[] | null {
  const e = entre(pontos, x);
  if (!e) return null;
  const [a, b, f] = e;
  return a.z.map((v, i) => lin(v, b.z[i]!, f));
}

/** Escore Z pelas linhas de desvio (-3 a +3): linear entre as linhas vizinhas e pela última faixa fora delas. */
export function zLinhas(v: readonly number[], y: number): number {
  const n = v.length - 1;
  const base = -(n / 2);
  if (y <= v[0]!) return base - (v[0]! - y) / (v[1]! - v[0]!);
  if (y >= v[n]!) return base + n + (y - v[n]!) / (v[n]! - v[n - 1]!);
  let k = 0;
  while (y > v[k + 1]!) k++;
  return base + k + (y - v[k]!) / (v[k + 1]! - v[k]!);
}

/** Função de distribuição normal padrão (Abramowitz e Stegun 7.1.26, erro abaixo de 1,5e-7). */
export function normalAcumulada(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const p =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + p) / 2 : (1 - p) / 2;
}

/** Percentil (0 a 100, uma casa) do escore Z. */
export function percentilDoZ(z: number): number {
  return Math.round(normalAcumulada(z) * 1000) / 10;
}

export type NivelCrescimento = 'adequado' | 'atencao' | 'alerta';
export interface ClassificacaoCrescimento {
  readonly codigo: string;
  readonly nivel: NivelCrescimento;
}

/** Pontos de corte do Ministério da Saúde (SISVAN, sobre as curvas da OMS) por indicador e faixa de idade. */
export function classificarCrescimento(
  indicador: IndicadorCrescimento,
  z: number,
  idadeMeses: number,
): ClassificacaoCrescimento {
  const c = (codigo: string, nivel: NivelCrescimento) => ({ codigo, nivel });
  switch (indicador) {
    case 'peso':
      if (z < -3) return c('muito_baixo_peso', 'alerta');
      if (z < -2) return c('baixo_peso', 'atencao');
      if (z > 2) return c('peso_elevado', 'atencao');
      return c('peso_adequado', 'adequado');
    case 'estatura':
      if (z < -3) return c('muito_baixa_estatura', 'alerta');
      if (z < -2) return c('baixa_estatura', 'atencao');
      return c('estatura_adequada', 'adequado');
    case 'perimetro_cefalico':
      if (z < -3) return c('microcefalia_grave', 'alerta');
      if (z < -2) return c('microcefalia', 'alerta');
      if (z > 2) return c('macrocefalia', 'atencao');
      return c('perimetro_adequado', 'adequado');
    case 'imc':
      if (z < -3) return c('magreza_acentuada', 'alerta');
      if (z < -2) return c('magreza', 'atencao');
      if (z <= 1) return c('eutrofia', 'adequado');
      if (idadeMeses < 60) {
        if (z <= 2) return c('risco_sobrepeso', 'atencao');
        if (z <= 3) return c('sobrepeso', 'atencao');
        return c('obesidade', 'alerta');
      }
      if (z <= 2) return c('sobrepeso', 'atencao');
      if (z <= 3) return c('obesidade', 'alerta');
      return c('obesidade_grave', 'alerta');
  }
}

/** Limites de escore Z biologicamente plausíveis da OMS (fora deles, a medida deve ser revista). */
const PLAUSIVEL: Readonly<Record<IndicadorCrescimento, [number, number]>> = {
  peso: [-6, 5],
  estatura: [-6, 6],
  perimetro_cefalico: [-5, 5],
  imc: [-5, 5],
};

export interface AvaliacaoMedida {
  readonly z: number;
  readonly percentil: number;
  readonly classificacao: ClassificacaoCrescimento;
  readonly plausivel: boolean;
}

/** Escore Z, percentil e classificação da medida `y` na abscissa `x` da curva; null fora da faixa da curva. */
export function avaliarMedida(
  indicador: IndicadorCrescimento,
  y: number,
  curva: CurvaCalculo,
  x: number,
  idadeMeses: number,
): AvaliacaoMedida | null {
  if (!(y > 0)) return null;
  let z: number;
  if (curva.tipo === 'lms') {
    const p = lmsEm(curva.pontos, x);
    if (!p) return null;
    z = zLms(y, p.l, p.m, p.s, indicador === 'peso' || indicador === 'imc');
  } else {
    const v = linhasEm(curva.pontos, x);
    if (!v) return null;
    z = zLinhas(v, y);
  }
  const [min, max] = PLAUSIVEL[indicador];
  return {
    z: Math.round(z * 100) / 100,
    percentil: percentilDoZ(z),
    classificacao: classificarCrescimento(indicador, z, idadeMeses),
    plausivel: z >= min && z <= max,
  };
}

/** Linhas do gráfico (ZS_GRAFICO) em cada abscissa publicada da curva. */
export function linhasDoGrafico(curva: CurvaCalculo): { x: number; valores: number[] }[] {
  if (curva.tipo === 'lms')
    return curva.pontos.map((p) => ({
      x: p.x,
      valores: ZS_GRAFICO.map((z) => Math.round(valorLms(z, p.l, p.m, p.s) * 1000) / 1000),
    }));
  const indice = ZS_GRAFICO.map((z) => z + 3);
  return curva.pontos.map((p) => ({ x: p.x, valores: indice.map((i) => p.z[i]!) }));
}

export interface NascimentoCrianca {
  readonly nascimento: Date;
  /** Idade gestacional ao nascer (semanas e dias); nula quando não registrada (tratada como a termo). */
  readonly igSemanas: number | null;
  readonly igDias: number | null;
}
export type ReferenciaMedida =
  | { readonly publicacao: 'intergrowth'; readonly x: number; readonly idadeMeses: number }
  | {
      readonly publicacao: 'oms2006' | 'oms2007';
      readonly x: number;
      readonly idadeMeses: number;
      /** A abscissa é a idade corrigida (prematuro até 2 anos de idade corrigida). */
      readonly corrigida: boolean;
    };

const diaUtc = (d: Date) => Math.floor(d.getTime() / DIA);
/** Dias completos de vida na data da medida. */
export function diasDeVida(nascimento: Date, medidoEm: Date): number {
  return diaUtc(medidoEm) - diaUtc(nascimento);
}

/**
 * Referência e abscissa da medida: o prematuro (menos de 37 semanas) usa o INTERGROWTH até 64 semanas de idade
 * pós-menstrual e, depois, a OMS pela idade corrigida até os 24 meses corrigidos; os demais, a OMS pela idade
 * cronológica (2006 até 60 meses, 2007 até 228). Null antes de 27 semanas pós-menstruais ou depois dos 19 anos.
 */
export function referenciaDaMedida(n: NascimentoCrianca, medidoEm: Date): ReferenciaMedida | null {
  const dias = diasDeVida(n.nascimento, medidoEm);
  if (dias < 0) return null;
  const idadeMeses = dias / DIAS_POR_MES;
  const igTotalDias = n.igSemanas === null ? null : n.igSemanas * 7 + (n.igDias ?? 0);
  const prematuro = igTotalDias !== null && igTotalDias < 37 * 7;
  let x = idadeMeses;
  let corrigida = false;
  if (prematuro) {
    const pma = (igTotalDias + dias) / 7;
    if (pma < 27) return null;
    if (pma <= 64) return { publicacao: 'intergrowth', x: pma, idadeMeses };
    const corrigidaMeses = (dias - (280 - igTotalDias)) / DIAS_POR_MES;
    if (corrigidaMeses < 24) {
      x = corrigidaMeses;
      corrigida = true;
    }
  }
  if (x < 60) return { publicacao: 'oms2006', x, idadeMeses, corrigida };
  if (x <= 228) return { publicacao: 'oms2007', x, idadeMeses, corrigida };
  return null;
}

/** IMC (kg/m²) com o peso em kg e a estatura em cm; null sem os dois. */
export function imcDe(pesoKg: number | null, estaturaCm: number | null): number | null {
  if (!pesoKg || !estaturaCm) return null;
  return Math.round((pesoKg / (estaturaCm / 100) ** 2) * 100) / 100;
}

export interface NovaMedidaCrescimento {
  readonly pesoKg: number | null;
  readonly estaturaCm: number | null;
  readonly perimetroCefalicoCm: number | null;
  readonly medidoEm: Date;
  readonly nascimento: Date | null;
}
/** Faixas fisicamente possíveis (fora delas, erro de digitação: kg × g, cm × m). */
export const LIMITES_MEDIDA = {
  pesoKg: [0.2, 300],
  estaturaCm: [20, 250],
  perimetroCefalicoCm: [15, 70],
} as const;

const falha = (codigo: string, mensagem: string): FalhaRegra => ({ codigo, mensagem });

/** Validação da medida de crescimento antes de gravar. */
export function validarMedidaCrescimento(m: NovaMedidaCrescimento, agora: Date): FalhaRegra[] {
  const f: FalhaRegra[] = [];
  if (m.pesoKg === null && m.estaturaCm === null && m.perimetroCefalicoCm === null)
    f.push(falha('medida-vazia', 'Informe ao menos o peso, a estatura ou o perímetro cefálico.'));
  if (!m.nascimento)
    f.push(falha('sem-data-nascimento', 'O paciente não tem data de nascimento: a curva depende da idade.'));
  if (m.medidoEm.getTime() > agora.getTime() + 5 * 60_000)
    f.push(falha('medida-no-futuro', 'A data da medida está no futuro.'));
  if (m.nascimento && diasDeVida(m.nascimento, m.medidoEm) < 0)
    f.push(falha('medida-antes-do-nascimento', 'A data da medida é anterior ao nascimento.'));
  const fora = (v: number | null, [min, max]: readonly [number, number]) =>
    v !== null && (v < min || v > max);
  if (fora(m.pesoKg, LIMITES_MEDIDA.pesoKg))
    f.push(falha('peso-impossivel', 'Peso fora de 0,2 a 300 kg: confira a unidade (kg).'));
  if (fora(m.estaturaCm, LIMITES_MEDIDA.estaturaCm))
    f.push(falha('estatura-impossivel', 'Estatura fora de 20 a 250 cm: confira a unidade (cm).'));
  if (fora(m.perimetroCefalicoCm, LIMITES_MEDIDA.perimetroCefalicoCm))
    f.push(falha('perimetro-impossivel', 'Perímetro cefálico fora de 15 a 70 cm: confira a unidade (cm).'));
  return f;
}
