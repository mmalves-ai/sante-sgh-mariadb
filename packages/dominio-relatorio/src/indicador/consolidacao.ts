// Consolidação da Rede (M57, etapa 3; regra 8; cap-07 §7.7.4 e §7.5.3): o indicador da Rede usa a MESMA ficha técnica
// em todos os estabelecimentos e é a soma dos numeradores sobre a soma dos denominadores, nunca a média das taxas.
// Cada valor consolidado sai com as parcelas (o numerador e o denominador de cada estabelecimento), para a conta poder
// ser refeita por quem lê. Recusas (o consolidado não sai, com o motivo, e as parcelas continuam visíveis):
//   - `media-de-taxas`: uma parcela chegou só com o valor (a taxa), sem o numerador ou o denominador;
//   - `ficha-diferente`: a versão da ficha ou um parâmetro que muda a definição (os tipos de terapia intensiva, a hora
//     de fechamento do censo) difere entre os estabelecimentos;
//   - `periodo-diferente`: a grandeza que não se soma (os dias do período) difere entre as parcelas do mesmo mês.
// Regras puras: sem banco, sem HTTP, sem dado de pessoa (só contagens).
import type { FichaIndicador, GrandezaBase, SeriePainel, ValorIndicador } from '@sgh/contratos';
import { arredondar } from '../calculo.js';

/**
 * Grandezas que NÃO se somam entre estabelecimentos: os dias do período são os mesmos para todos (o censo médio
 * diário da Rede é a soma dos pacientes-dia sobre os dias do mês, não sobre a soma dos dias de cada um).
 */
export const GRANDEZAS_NAO_ADITIVAS: readonly GrandezaBase[] = ['dias'];

export const MOTIVOS_RECUSA_CONSOLIDACAO = [
  'media-de-taxas',
  'ficha-diferente',
  'periodo-diferente',
  'sem-parcelas',
] as const;
export type MotivoRecusaConsolidacao = (typeof MOTIVOS_RECUSA_CONSOLIDACAO)[number];

export class ErroConsolidacao extends Error {
  override readonly name = 'ErroConsolidacao';
  readonly motivo: MotivoRecusaConsolidacao;
  constructor(motivo: MotivoRecusaConsolidacao, mensagem: string) {
    super(mensagem);
    this.motivo = motivo;
  }
}

/** A definição do indicador num estabelecimento: a ficha (versão) e os parâmetros que mudam a conta. */
export interface DefinicaoNoEstabelecimento {
  readonly versao: number;
  /** Parâmetros que entram na definição (ex.: os tipos de terapia intensiva), já como texto canônico. */
  readonly parametros: Readonly<Record<string, string>>;
}

/** A parcela de um estabelecimento num período: o que ele mediu, com a ficha que usou. */
export interface ParcelaIndicador {
  readonly estabelecimento: string;
  readonly definicao: DefinicaoNoEstabelecimento;
  /** O valor do estabelecimento (numerador e denominador obrigatórios: a taxa sozinha é recusada). */
  readonly valor: Pick<ValorIndicador, 'periodo' | 'parcial' | 'valor'> & {
    readonly numerador: number | null | undefined;
    readonly denominador: number | null | undefined;
  };
}

export interface ValorConsolidado {
  readonly periodo: string;
  readonly numerador: number;
  readonly denominador: number | null;
  readonly valor: number | null;
  readonly parcial: boolean;
  readonly parcelas: readonly {
    readonly estabelecimento: string;
    readonly numerador: number;
    readonly denominador: number | null;
    readonly valor: number | null;
    readonly parcial: boolean;
  }[];
}

const assinaturaDaDefinicao = (d: DefinicaoNoEstabelecimento): string =>
  `v${d.versao}|${Object.entries(d.parametros)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(';')}`;

/** A mesma ficha (versão e parâmetros da definição) em todas as parcelas; senão, `ficha-diferente`. */
export function conferirMesmaFicha(
  ficha: Pick<FichaIndicador, 'codigo' | 'nome'>,
  definicoes: readonly { estabelecimento: string; definicao: DefinicaoNoEstabelecimento }[],
): void {
  const vistas = new Map<string, string[]>();
  for (const d of definicoes) {
    const k = assinaturaDaDefinicao(d.definicao);
    vistas.set(k, [...(vistas.get(k) ?? []), d.estabelecimento]);
  }
  if (vistas.size > 1)
    throw new ErroConsolidacao(
      'ficha-diferente',
      `${ficha.nome}: a ficha técnica não é a mesma em todos os estabelecimentos (${[...vistas.values()]
        .map((e) => e.join(', '))
        .join(' × ')}); o consolidado da Rede não é calculado.`,
    );
}

/**
 * O valor consolidado de um período: Σ numeradores ÷ Σ denominadores × fator (a grandeza que não se soma entra uma
 * vez, igual em todas as parcelas). Sem denominador (contagem), a soma dos numeradores.
 */
export function consolidarValor(
  ficha: Pick<FichaIndicador, 'codigo' | 'nome' | 'fator' | 'denominador'>,
  parcelas: readonly ParcelaIndicador[],
): ValorConsolidado {
  if (parcelas.length === 0)
    throw new ErroConsolidacao('sem-parcelas', `${ficha.nome}: nenhum estabelecimento com valor.`);
  conferirMesmaFicha(ficha, parcelas);
  const periodo = parcelas[0]!.valor.periodo;
  const temDenominador = ficha.denominador !== null;
  for (const p of parcelas) {
    if (p.valor.periodo !== periodo)
      throw new ErroConsolidacao(
        'periodo-diferente',
        `${ficha.nome}: parcelas de períodos diferentes (${periodo} e ${p.valor.periodo}).`,
      );
    const semNumerador = typeof p.valor.numerador !== 'number' || !Number.isFinite(p.valor.numerador);
    const semDenominador =
      temDenominador && (typeof p.valor.denominador !== 'number' || !Number.isFinite(p.valor.denominador));
    if (semNumerador || semDenominador)
      throw new ErroConsolidacao(
        'media-de-taxas',
        `${ficha.nome}: a parcela de ${p.estabelecimento} veio sem o numerador ou o denominador. O consolidado é a soma dos numeradores sobre a soma dos denominadores; a média das taxas não é aceita.`,
      );
  }
  const numerador = arredondar(parcelas.reduce((a, p) => a + (p.valor.numerador as number), 0));
  let denominador: number | null = null;
  if (temDenominador) {
    const g = ficha.denominador!.grandeza;
    const ds = parcelas.map((p) => p.valor.denominador as number);
    if (GRANDEZAS_NAO_ADITIVAS.includes(g)) {
      if (new Set(ds).size > 1)
        throw new ErroConsolidacao(
          'periodo-diferente',
          `${ficha.nome}: os dias do período diferem entre os estabelecimentos (${ds.join(' × ')}).`,
        );
      denominador = ds[0]!;
    } else denominador = arredondar(ds.reduce((a, d) => a + d, 0));
  }
  const valor =
    denominador === null
      ? numerador
      : denominador > 0
        ? arredondar((numerador / denominador) * ficha.fator)
        : null;
  return {
    periodo,
    numerador,
    denominador,
    valor,
    parcial: parcelas.some((p) => p.valor.parcial),
    parcelas: parcelas.map((p) => ({
      estabelecimento: p.estabelecimento,
      numerador: p.valor.numerador as number,
      denominador: temDenominador ? (p.valor.denominador as number) : null,
      valor: p.valor.valor,
      parcial: p.valor.parcial,
    })),
  };
}

/** A série consolidada (mês a mês): cada mês com as parcelas dos estabelecimentos que têm o mês. */
export function consolidarSerie(
  ficha: Pick<FichaIndicador, 'codigo' | 'nome' | 'fator' | 'denominador'>,
  series: readonly {
    estabelecimento: string;
    definicao: DefinicaoNoEstabelecimento;
    valores: readonly ParcelaIndicador['valor'][];
  }[],
): ValorConsolidado[] {
  conferirMesmaFicha(ficha, series);
  const meses = [...new Set(series.flatMap((s) => s.valores.map((v) => v.periodo)))].sort();
  return meses.map((m) =>
    consolidarValor(
      ficha,
      series.flatMap((s) => {
        const v = s.valores.find((x) => x.periodo === m);
        return v ? [{ estabelecimento: s.estabelecimento, definicao: s.definicao, valor: v }] : [];
      }),
    ),
  );
}

/**
 * A média simples das taxas: existe só para o teste e para a tela mostrar por que ela NÃO é o consolidado (os
 * estabelecimentos com movimento diferente pesam igual). Nunca é usada como valor da Rede.
 */
export function mediaDasTaxas(valores: readonly (number | null)[]): number | null {
  const xs = valores.filter((v): v is number => v !== null);
  return xs.length === 0 ? null : arredondar(xs.reduce((a, v) => a + v, 0) / xs.length);
}

const numeroBr = (v: number): string =>
  Number.isInteger(v)
    ? v.toLocaleString('pt-BR')
    : v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * A conta impressa (as parcelas à vista): "(12 + 30) ÷ (100 + 200) × 100 = 14". Sem denominador: "12 + 30 = 42". A
 * grandeza que não se soma aparece uma vez.
 */
export function contaImpressa(
  ficha: Pick<FichaIndicador, 'fator' | 'denominador'>,
  v: Pick<ValorConsolidado, 'parcelas' | 'denominador' | 'valor' | 'numerador'>,
): string {
  const soma = (xs: readonly number[]) =>
    xs.length === 1 ? numeroBr(xs[0]!) : `(${xs.map(numeroBr).join(' + ')})`;
  const resultado = v.valor === null ? 'sem valor (denominador zero)' : numeroBr(v.valor);
  const num = soma(v.parcelas.map((p) => p.numerador));
  if (ficha.denominador === null) return `${v.parcelas.length === 1 ? num : num.slice(1, -1)} = ${resultado}`;
  const den = GRANDEZAS_NAO_ADITIVAS.includes(ficha.denominador.grandeza)
    ? numeroBr(v.denominador ?? 0)
    : soma(v.parcelas.map((p) => p.denominador ?? 0));
  return `${num} ÷ ${den}${ficha.fator !== 1 ? ` × ${numeroBr(ficha.fator)}` : ''} = ${resultado}`;
}

// ── Séries dos painéis (operacional e financeiro) ──────────────────────────────────────────────────────────────────

/** Fator de uma série de painel com numerador e denominador (o percentual; o resto é quociente simples). */
const fatorDaSerie = (s: Pick<SeriePainel, 'unidade'>) => (s.unidade === 'percentual' ? 100 : 1);

/**
 * Consolida uma série de painel entre estabelecimentos, mês a mês: contagens e valores em reais (sem numerador nem
 * denominador) se somam; as séries com numerador e denominador viram Σ numeradores ÷ Σ denominadores. Uma série que
 * só tem a taxa (valor sem numerador) é recusada (`media-de-taxas`).
 */
export function consolidarSeriePainel(
  series: readonly { estabelecimento: string; serie: SeriePainel }[],
): SeriePainel & {
  readonly parcelas: readonly {
    estabelecimento: string;
    valores: readonly {
      periodo: string;
      valor: number | null;
      numerador: number | null;
      denominador: number | null;
    }[];
  }[];
} {
  if (series.length === 0) throw new ErroConsolidacao('sem-parcelas', 'Nenhum estabelecimento com a série.');
  const base = series[0]!.serie;
  for (const s of series)
    if (s.serie.codigo !== base.codigo || s.serie.unidade !== base.unidade || s.serie.regua !== base.regua)
      throw new ErroConsolidacao(
        'ficha-diferente',
        `${base.rotulo}: a série não é a mesma em todos os estabelecimentos.`,
      );
  const meses = [...new Set(series.flatMap((s) => s.serie.valores.map((v) => v.periodo)))].sort();
  const somavel = base.unidade === 'quantidade' || base.unidade === 'reais';
  const valores = meses.map((m) => {
    const vs = series.flatMap((s) => {
      const v = s.serie.valores.find((x) => x.periodo === m);
      return v ? [{ e: s.estabelecimento, v }] : [];
    });
    const parcial = vs.some((x) => x.v.parcial);
    const comConta = vs.some((x) => x.v.numerador !== null || x.v.denominador !== null);
    if (somavel && !comConta) {
      const soma = vs.every((x) => x.v.valor === null)
        ? null
        : arredondar(vs.reduce((a, x) => a + (x.v.valor ?? 0), 0));
      return { periodo: m, valor: soma, numerador: null, denominador: null, parcial };
    }
    for (const x of vs)
      if (x.v.numerador === null || x.v.denominador === null)
        throw new ErroConsolidacao(
          'media-de-taxas',
          `${base.rotulo}: a parcela de ${x.e} em ${m} veio sem o numerador ou o denominador; a média das taxas não é aceita.`,
        );
    const numerador = arredondar(vs.reduce((a, x) => a + (x.v.numerador as number), 0));
    const denominador = arredondar(vs.reduce((a, x) => a + (x.v.denominador as number), 0));
    const casas = base.unidade === 'percentual' ? 1 : 2;
    return {
      periodo: m,
      valor: denominador > 0 ? arredondar((numerador / denominador) * fatorDaSerie(base), casas) : null,
      numerador,
      denominador,
      parcial,
    };
  });
  return {
    codigo: base.codigo,
    rotulo: base.rotulo,
    unidade: base.unidade,
    regua: base.regua,
    valores,
    parcelas: series.map((s) => ({
      estabelecimento: s.estabelecimento,
      valores: s.serie.valores.map((v) => ({
        periodo: v.periodo,
        valor: v.valor,
        numerador: v.numerador,
        denominador: v.denominador,
      })),
    })),
  };
}
