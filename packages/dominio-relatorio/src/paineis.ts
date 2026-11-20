// Painéis gerenciais (M16; ficha, seção 7; regras 12 a 14). Assistencial: os indicadores com ficha sobre a base
// mensal do censo. Operacional: atendimentos, consultas, cirurgias e exames por mês (contagens agregadas na
// cópia diária). Financeiro: as DUAS réguas da receita, com o nome da régua em cada série (regra 13): pela data do
// item e pela competência da conta; a glosa só sobre os itens já baixados (a marca de baixa não é glosa; regra 12)
// e a maturação (quanto do cobrado já foi baixado), para ninguém ler "glosa de 0%" num mês que ainda não baixou.
import type { BaseMensal, ReguaReceita, SeriePainel } from '@sgh/contratos';
import { arredondar, serieDe } from './calculo.js';
import { fichaDe } from './fichas.js';

/** Dinheiro em reais com duas casas, sem o ruído do DOUBLE. */
export const dinheiro = (v: number): number => arredondar(v, 2);

/** Percentual protegido da divisão por zero (uma casa). */
export const percentual = (parte: number, todo: number): number | null =>
  todo > 0 ? arredondar((parte / todo) * 100, 1) : null;

/** Glosa dos itens baixados (regra 12): cobrado − pago dos baixados, e o percentual sobre o cobrado baixado. */
export function glosaDosBaixados(
  cobradoBaixado: number,
  pagoBaixado: number,
): { valor: number; percentual: number | null } {
  return {
    valor: dinheiro(cobradoBaixado - pagoBaixado),
    percentual: percentual(cobradoBaixado - pagoBaixado, cobradoBaixado),
  };
}

const ASSISTENCIAIS = [
  'taxaOcupacao',
  'taxaOcupacaoIntensiva',
  'mediaPermanencia',
  'taxaMortalidadeInstitucional',
  'taxaReinternacao30',
  'admissoes',
] as const;

/** Séries do painel assistencial (as fichas dos indicadores sobre a base mensal). */
export function seriesAssistenciais(bases: readonly BaseMensal[]): SeriePainel[] {
  return ASSISTENCIAIS.map((codigo) => {
    const f = fichaDe(codigo)!;
    return {
      codigo,
      rotulo: f.nome,
      unidade: f.unidade,
      regua: null,
      valores: serieDe(f, bases).map((v) => ({
        periodo: v.periodo,
        valor: v.valor,
        numerador: v.numerador,
        denominador: v.denominador,
        parcial: v.parcial,
      })),
    };
  });
}

export interface LinhaOperacional {
  readonly periodo: string;
  readonly atendimentosExternos: number;
  readonly internacoes: number;
  readonly consultas: number;
  readonly cirurgias: number;
  readonly exames: number;
}

const OPERACIONAIS: readonly { codigo: keyof Omit<LinhaOperacional, 'periodo'>; rotulo: string }[] = [
  { codigo: 'atendimentosExternos', rotulo: 'Atendimentos externos (ambulatório e pronto atendimento)' },
  { codigo: 'internacoes', rotulo: 'Atendimentos de internação' },
  { codigo: 'consultas', rotulo: 'Consultas com especialidade' },
  { codigo: 'cirurgias', rotulo: 'Cirurgias' },
  { codigo: 'exames', rotulo: 'Exames realizados' },
];

/** Séries do painel operacional, mês a mês (meses sem linha: zero; o mês corrente, parcial). */
export function seriesOperacionais(
  linhas: readonly LinhaOperacional[],
  meses: readonly string[],
  parcialDesde: string,
): SeriePainel[] {
  const porMes = new Map(linhas.map((l) => [l.periodo, l]));
  return OPERACIONAIS.map((o) => ({
    codigo: o.codigo,
    rotulo: o.rotulo,
    unidade: 'quantidade',
    regua: null,
    valores: meses.map((m) => ({
      periodo: m,
      valor: porMes.get(m)?.[o.codigo] ?? 0,
      numerador: null,
      denominador: null,
      parcial: m >= parcialDesde,
    })),
  }));
}

export interface LinhaFinanceira {
  readonly periodo: string;
  readonly regua: ReguaReceita;
  readonly cobrado: number;
  readonly pago: number;
  /** Cobrado e pago só dos itens já baixados (a marca de baixa). */
  readonly cobradoBaixado: number;
  readonly pagoBaixado: number;
}

const ROTULO_REGUA: Readonly<Record<ReguaReceita, string>> = {
  'data-do-item': 'pela data do item',
  competencia: 'pela competência da conta',
};

/** Séries do painel financeiro: cobrado e pago nas duas réguas; glosa e maturação pela data do item. */
export function seriesFinanceiras(
  linhas: readonly LinhaFinanceira[],
  meses: readonly string[],
  parcialDesde: string,
): SeriePainel[] {
  const chave = (r: ReguaReceita, m: string) => `${r}|${m}`;
  const mapa = new Map(linhas.map((l) => [chave(l.regua, l.periodo), l]));
  const serie = (
    codigo: string,
    rotulo: string,
    regua: ReguaReceita,
    unidade: SeriePainel['unidade'],
    f: (l: LinhaFinanceira | undefined) => {
      valor: number | null;
      numerador: number | null;
      denominador: number | null;
    },
  ): SeriePainel => ({
    codigo,
    rotulo: `${rotulo} (${ROTULO_REGUA[regua]})`,
    unidade,
    regua,
    valores: meses.map((m) => ({ periodo: m, ...f(mapa.get(chave(regua, m))), parcial: m >= parcialDesde })),
  });
  const r: SeriePainel[] = [];
  for (const regua of ['data-do-item', 'competencia'] as const) {
    r.push(
      serie(`cobrado-${regua}`, 'Receita cobrada', regua, 'reais', (l) => ({
        valor: dinheiro(l?.cobrado ?? 0),
        numerador: null,
        denominador: null,
      })),
      serie(`pago-${regua}`, 'Receita paga', regua, 'reais', (l) => ({
        valor: dinheiro(l?.pago ?? 0),
        numerador: null,
        denominador: null,
      })),
    );
  }
  r.push(
    serie('glosa-baixados', 'Glosa sobre os itens baixados', 'data-do-item', 'percentual', (l) => {
      const g = glosaDosBaixados(l?.cobradoBaixado ?? 0, l?.pagoBaixado ?? 0);
      return { valor: g.percentual, numerador: g.valor, denominador: dinheiro(l?.cobradoBaixado ?? 0) };
    }),
    serie('maturacao', 'Cobrado já baixado (maturação)', 'data-do-item', 'percentual', (l) => ({
      valor: percentual(l?.cobradoBaixado ?? 0, l?.cobrado ?? 0),
      numerador: dinheiro(l?.cobradoBaixado ?? 0),
      denominador: dinheiro(l?.cobrado ?? 0),
    })),
  );
  return r;
}

/** Total de uma série de reais num conjunto de meses (o controle das duas réguas de um ano). */
export function totalDaSerie(s: SeriePainel, meses: readonly string[]): number {
  return dinheiro(s.valores.filter((v) => meses.includes(v.periodo)).reduce((a, v) => a + (v.valor ?? 0), 0));
}
