// A remuneração de cada trabalhador no período das obrigações (M53-F7), somada dos processamentos da folha: a base do
// FGTS sem o 13º por mês (folha mensal, férias e rescisão), a do 13º por parcela (com o mês do pagamento), o FGTS e o
// rescisório. É a entrada da SEFIP (a competência), da RAIS (os 12 meses) e dos totais de cada obrigação.
import type { TotaisObrigacao } from '@sgh/contratos';
import type { ProcessoParaObrigacao, ResumoParaObrigacao } from './fgts-digital.js';
import type { RemuneracaoObrigacao, TrabalhadorObrigacao } from './tipos.js';

interface Acc {
  remuneracao: number;
  remuneracaoDecimo: number;
  fgts: number;
  rescisorio: number;
  porMes: Record<string, number>;
  decimoAdiantamento: { valor: number; mes: number } | null;
  decimoFinal: { valor: number; mes: number } | null;
}

/** Soma por vínculo os processamentos das competências dadas. */
export function remuneracoesDoPeriodo(
  competencias: readonly string[],
  processos: readonly ProcessoParaObrigacao[],
  resumos: ReadonlyMap<number, readonly ResumoParaObrigacao[]>,
): Map<number, RemuneracaoObrigacao> {
  const por = new Map<number, Acc>();
  for (const p of processos.filter((x) => competencias.includes(x.competencia))) {
    for (const r of resumos.get(p.id) ?? []) {
      const a: Acc = por.get(r.vinculo) ?? {
        remuneracao: 0,
        remuneracaoDecimo: 0,
        fgts: 0,
        rescisorio: 0,
        porMes: {},
        decimoAdiantamento: null,
        decimoFinal: null,
      };
      const base = r.porPapel.baseFgts ?? 0;
      const mes = Number(p.competencia.slice(5, 7));
      if (p.tipo === 'decimo1' || p.tipo === 'decimo2') {
        a.remuneracaoDecimo += base;
        const k = p.tipo === 'decimo1' ? 'decimoAdiantamento' : 'decimoFinal';
        a[k] = { valor: (a[k]?.valor ?? 0) + base, mes };
      } else {
        a.remuneracao += base;
        a.porMes[p.competencia] = (a.porMes[p.competencia] ?? 0) + base;
      }
      a.fgts += r.porPapel.fgts ?? 0;
      a.rescisorio += r.porPapel.multaFgts ?? 0;
      por.set(r.vinculo, a);
    }
  }
  return new Map([...por].map(([vinculo, a]) => [vinculo, { vinculo, ...a }]));
}

/** Os totais da obrigação (trabalhadores do arquivo, remunerações, FGTS e as movimentações do período). */
export function totaisDaObrigacao(
  trabalhadores: readonly TrabalhadorObrigacao[],
  remuneracoes: ReadonlyMap<number, RemuneracaoObrigacao>,
  movimentou: (t: TrabalhadorObrigacao) => { admitido: boolean; desligado: boolean },
): TotaisObrigacao {
  let remuneracao = 0;
  let remuneracaoDecimo = 0;
  let fgts = 0;
  let rescisorio = 0;
  let admissoes = 0;
  let desligamentos = 0;
  for (const t of trabalhadores) {
    const r = remuneracoes.get(t.vinculo);
    remuneracao += r?.remuneracao ?? 0;
    remuneracaoDecimo += r?.remuneracaoDecimo ?? 0;
    fgts += r?.fgts ?? 0;
    rescisorio += r?.rescisorio ?? 0;
    const m = movimentou(t);
    if (m.admitido) admissoes++;
    if (m.desligado) desligamentos++;
  }
  return {
    trabalhadores: trabalhadores.length,
    remuneracao,
    remuneracaoDecimo,
    baseFgts: remuneracao + remuneracaoDecimo,
    fgts,
    rescisorio,
    admissoes,
    desligamentos,
  };
}
