// Regra 7 (ficha do M54; cap-07 §7.2, AGHUse Custos e PNGC): custeio por absorção com rateio sequencial. Passos:
//   1. custo direto por centro e grupo (pessoal, materiais, despesas), dos movimentos do mês pelo centro de custo;
//   2. as despesas do financeiro sem centro de custo (o banco grava CDC 0 na classificação gerencial) são distribuídas
//      aos centros do custeio pela proporção do custo direto de cada um (parcela "despesas gerais", impressa);
//   3. cada auxiliar e administrativo, na ordem do rateio, reparte o que tem (direto + recebido) aos centros que vêm
//      DEPOIS dele na sequência (os auxiliares e administrativos seguintes e todos os produtivos), pela estatística do
//      seu critério; o que não tem base (nenhum centro seguinte com a estatística) fica parado e é pendência;
//   4. custo final do produtivo = direto + rateios recebidos, com as parcelas (de quem veio cada rateio).
// Conservação: custo direto lido = custo final dos produtivos + não rateado + despesas não distribuídas (provado no
// teste). Os movimentos de centro fora do custeio (inativo, sem classificação ou fora do cadastro) não entram: ficam
// somados à parte como pendência.
import {
  type ClasseCentroCusto,
  type CodigoEstatistica,
  GRUPOS_CUSTO_DIRETO,
  type GrupoCustoDireto,
  type LinhaApuracaoCentro,
  type ParcelaRateio,
  type PendenciaApuracaoCustos,
} from '@sgh/contratos';
import { dividirArredondado, repartir } from './repartir.js';

export interface CentroParaApuracao {
  readonly id: number;
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
  readonly classificacao: {
    readonly classe: ClasseCentroCusto;
    readonly ordemRateio: number | null;
    readonly criterio: string | null;
  } | null;
}

/** Um valor de custo direto já pelo TBCENCUS.ID (null: sem centro de custo no movimento). */
export interface CustoDiretoLido {
  readonly centro: number | null;
  readonly grupo: GrupoCustoDireto;
  readonly centavos: number;
}

/** Estatísticas vigentes da competência por centro (centésimos). */
export type EstatisticasPorCentro = ReadonlyMap<number, Readonly<Partial<Record<string, number>>>>;

/** Ordem de preferência da estatística que mede a produção do centro (custo unitário). */
export const PREFERENCIA_PRODUCAO: readonly CodigoEstatistica[] = [
  'pacienteDia',
  'horasSala',
  'exames',
  'cirurgias',
  'refeicoes',
  'kgRoupa',
  'requisicoes',
];

export interface ResultadoAbsorcao {
  readonly linhas: LinhaApuracaoCentro[];
  readonly pendencias: PendenciaApuracaoCustos[];
  readonly totais: {
    readonly direto: Record<GrupoCustoDireto, number>;
    readonly despesasSemCentro: number;
    readonly diretoTotal: number;
    readonly custoFinalProdutivos: number;
    readonly naoRateado: number;
    readonly despesasNaoDistribuidas: number;
    readonly foraDoCusteio: number;
  };
}

const zero = (): Record<GrupoCustoDireto, number> => ({ pessoal: 0, materiais: 0, despesas: 0 });
const nomes = (cs: readonly { codigo: number; nome: string }[], max = 5): string => {
  const ls = cs.slice(0, max).map((c) => `${c.codigo} ${c.nome}`);
  return cs.length > max ? `${ls.join(', ')} e mais ${cs.length - max}` : ls.join(', ');
};
const brl = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

interface Trabalho {
  readonly c: CentroParaApuracao & {
    readonly classificacao: NonNullable<CentroParaApuracao['classificacao']>;
  };
  readonly direto: Record<GrupoCustoDireto, number>;
  despesasGerais: number;
  recebidos: Map<number, number>;
  repassado: number;
  naoRateado: number;
  baseCriterioCent: number | null;
}

/** Os centros do custeio: ativos e classificados. A ordem: a sequência do rateio, depois os produtivos pelo código. */
function participantes(centros: readonly CentroParaApuracao[]): Trabalho['c'][] {
  const ps = centros.filter((c): c is Trabalho['c'] => c.ativo && c.classificacao !== null);
  const rateia = ps
    .filter((c) => c.classificacao.classe !== 'produtivo')
    .sort(
      (a, b) => (a.classificacao.ordemRateio ?? 9999) - (b.classificacao.ordemRateio ?? 9999) || a.id - b.id,
    );
  const produtivos = ps
    .filter((c) => c.classificacao.classe === 'produtivo')
    .sort((a, b) => a.codigo - b.codigo);
  return [...rateia, ...produtivos];
}

export function apurarAbsorcao(
  centros: readonly CentroParaApuracao[],
  diretos: readonly CustoDiretoLido[],
  estatisticas: EstatisticasPorCentro,
): ResultadoAbsorcao {
  const ordem = participantes(centros);
  const trabalho = new Map<number, Trabalho>(
    ordem.map((c) => [
      c.id,
      {
        c,
        direto: zero(),
        despesasGerais: 0,
        recebidos: new Map(),
        repassado: 0,
        naoRateado: 0,
        baseCriterioCent: null,
      },
    ]),
  );
  const pendencias: PendenciaApuracaoCustos[] = [];
  const porId = new Map(centros.map((c) => [c.id, c]));

  // 1. Custo direto.
  const diretoLido = zero();
  let despesasSemCentro = 0;
  const fora = new Map<number | null, number>();
  for (const d of diretos) {
    if (d.centavos === 0) continue;
    const t = d.centro === null ? undefined : trabalho.get(d.centro);
    if (t) {
      t.direto[d.grupo] += d.centavos;
      diretoLido[d.grupo] += d.centavos;
    } else if (d.centro === null && d.grupo === 'despesas') {
      despesasSemCentro += d.centavos;
    } else {
      fora.set(d.centro, (fora.get(d.centro) ?? 0) + d.centavos);
    }
  }
  const foraDoCusteio = [...fora.values()].reduce((s, v) => s + v, 0);
  if (fora.size > 0) {
    const conhecidos = [...fora.keys()]
      .map((id) => (id === null ? undefined : porId.get(id)))
      .filter((c): c is CentroParaApuracao => c !== undefined);
    const semCentro = fora.has(null) ? ' e movimento sem centro de custo' : '';
    pendencias.push({
      tipo: 'centro-fora-do-custeio',
      bloqueia: false,
      centros: conhecidos.map((c) => c.id),
      centavos: foraDoCusteio,
      mensagem: `${brl(foraDoCusteio)} de custo em centro inativo, sem classificação ou fora do cadastro${semCentro} ficou fora do custeio${conhecidos.length > 0 ? `: ${nomes(conhecidos)}` : ''}.`,
    });
  }

  // 2. Despesas sem centro de custo, pela proporção do custo direto.
  let despesasNaoDistribuidas = 0;
  if (despesasSemCentro !== 0) {
    const ts = [...trabalho.values()];
    const pesos = ts.map((t) => Math.max(0, t.direto.pessoal + t.direto.materiais + t.direto.despesas));
    const partes = repartir(despesasSemCentro, pesos);
    if (partes === null) {
      despesasNaoDistribuidas = despesasSemCentro;
      pendencias.push({
        tipo: 'despesas-nao-distribuidas',
        bloqueia: false,
        centros: [],
        centavos: despesasSemCentro,
        mensagem: `${brl(despesasSemCentro)} de despesas sem centro de custo não foram distribuídas: nenhum centro do custeio tem custo direto no mês.`,
      });
    } else {
      ts.forEach((t, i) => (t.despesasGerais = partes[i] ?? 0));
      pendencias.push({
        tipo: 'despesas-sem-centro',
        bloqueia: false,
        centros: [],
        centavos: despesasSemCentro,
        mensagem: `${brl(despesasSemCentro)} de despesas do financeiro sem centro de custo foram distribuídas aos centros pela proporção do custo direto (parcela "despesas gerais").`,
      });
    }
  }

  // 3. Rateio sequencial.
  const total = (t: Trabalho) =>
    t.direto.pessoal +
    t.direto.materiais +
    t.direto.despesas +
    t.despesasGerais +
    [...t.recebidos.values()].reduce((s, v) => s + v, 0);
  const semBase: Trabalho[] = [];
  ordem.forEach((c, pos) => {
    if (c.classificacao.classe === 'produtivo') return;
    const t = trabalho.get(c.id)!;
    const criterio = c.classificacao.criterio ?? '';
    const receptores = ordem.slice(pos + 1);
    const bases = receptores.map((r) => Math.max(0, Math.round(estatisticas.get(r.id)?.[criterio] ?? 0)));
    t.baseCriterioCent = bases.reduce((s, b) => s + b, 0);
    const pool = total(t);
    if (pool === 0) return;
    const partes = repartir(pool, bases);
    if (partes === null) {
      t.naoRateado = pool;
      semBase.push(t);
      return;
    }
    t.repassado = pool;
    receptores.forEach((r, i) => {
      const v = partes[i] ?? 0;
      if (v === 0) return;
      const rt = trabalho.get(r.id)!;
      rt.recebidos.set(c.id, (rt.recebidos.get(c.id) ?? 0) + v);
    });
  });
  if (semBase.length > 0) {
    const v = semBase.reduce((s, t) => s + t.naoRateado, 0);
    pendencias.push({
      tipo: 'sem-base',
      bloqueia: false,
      centros: semBase.map((t) => t.c.id),
      centavos: v,
      mensagem: `${brl(v)} não foram rateados: nenhum centro seguinte na sequência tem a estatística do critério em ${nomes(semBase.map((t) => t.c))}. Colete ou lance a estatística da competência.`,
    });
  }

  // 4. Linhas e custo final.
  const linhas: LinhaApuracaoCentro[] = [];
  const semProducao: Trabalho['c'][] = [];
  for (const c of ordem) {
    const t = trabalho.get(c.id)!;
    const recebidos: ParcelaRateio[] = [...t.recebidos]
      .map(([de, centavos]) => ({ de, centavos }))
      .sort((a, b) => ordem.findIndex((x) => x.id === a.de) - ordem.findIndex((x) => x.id === b.de));
    const recebidoTotal = recebidos.reduce((s, r) => s + r.centavos, 0);
    const diretoTotal = t.direto.pessoal + t.direto.materiais + t.direto.despesas + t.despesasGerais;
    const produtivo = c.classificacao.classe === 'produtivo';
    const custoFinal = produtivo ? diretoTotal + recebidoTotal : t.naoRateado;
    const est = estatisticas.get(c.id) ?? {};
    const cod = PREFERENCIA_PRODUCAO.find((k) => (est[k] ?? 0) > 0);
    const producao = cod ? { codigo: cod, quantidadeCent: Math.round(est[cod] ?? 0) } : null;
    if (produtivo && custoFinal !== 0 && producao === null) semProducao.push(c);
    linhas.push({
      centro: c.id,
      codigo: c.codigo,
      nome: c.nome,
      classe: c.classificacao.classe,
      ordemRateio: produtivo ? null : c.classificacao.ordemRateio,
      criterio: produtivo ? null : ((c.classificacao.criterio ?? null) as CodigoEstatistica | null),
      direto: { ...t.direto },
      despesasGerais: t.despesasGerais,
      diretoTotal,
      recebidos,
      recebidoTotal,
      repassado: t.repassado,
      naoRateado: t.naoRateado,
      custoFinal,
      baseCriterioCent: produtivo ? null : t.baseCriterioCent,
      producao,
      custoUnitario:
        produtivo && producao ? dividirArredondado(custoFinal * 100, producao.quantidadeCent) : null,
      receita: 0,
    });
  }
  if (semProducao.length > 0)
    pendencias.push({
      tipo: 'sem-producao',
      bloqueia: false,
      centros: semProducao.map((c) => c.id),
      centavos: 0,
      mensagem: `Centro(s) produtivo(s) sem estatística de produção no mês (sem custo unitário): ${nomes(semProducao)}.`,
    });

  const diretoTotal = GRUPOS_CUSTO_DIRETO.reduce((s, g) => s + diretoLido[g], 0) + despesasSemCentro;
  return {
    linhas,
    pendencias,
    totais: {
      direto: diretoLido,
      despesasSemCentro,
      diretoTotal,
      custoFinalProdutivos: linhas
        .filter((l) => l.classe === 'produtivo')
        .reduce((s, l) => s + l.custoFinal, 0),
      naoRateado: linhas.reduce((s, l) => s + l.naoRateado, 0),
      despesasNaoDistribuidas,
      foraDoCusteio,
    },
  };
}
