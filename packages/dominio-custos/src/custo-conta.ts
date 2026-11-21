// Custo por conta (e, por ela, por paciente e procedimento) e margem (M54-F5; ficha, seção 4 "Custo por paciente e
// margem por conta"). O custo final de cada centro produtivo chega às contas da competência pela razão custo/receita do
// centro: a conta recebe custo do centro na proporção do que faturou nele (repartição exata, a soma das contas é o custo
// final do centro). Receita líquida = bruta − glosa + recurso (regra 4: glosa e recurso ajustam a receita, não a
// excluem). Margem = receita líquida − custo. O produtivo sem receita no mês não passa custo a nenhuma conta (pendência).
import type {
  AgrupamentoResultado,
  CustoConta,
  GrupoResultado,
  LinhaApuracaoCentro,
  PendenciaApuracaoCustos,
} from '@sgh/contratos';
import { dividirArredondado, repartir } from './repartir.js';

/** O que uma conta faturou num centro (agregado no banco por conta e centro de custo do item; centavos). */
export interface ItemContaLido {
  /** Id da conta do paciente. */
  readonly conta: number;
  readonly numero: number;
  readonly tipoConta: string | null;
  readonly convenio: number | null;
  readonly procedimento: string | null;
  /** Id do centro de custo do item (null: o código do item não está no cadastro). */
  readonly centro: number | null;
  readonly bruta: number;
  readonly glosa: number;
  readonly recurso: number;
}

export interface ResultadoCustoContas {
  readonly contas: CustoConta[];
  /** A receita de cada centro (a base da razão), para a linha da apuração. */
  readonly receitaPorCentro: Map<number, number>;
  readonly custoNasContas: number;
  readonly custoSemConta: number;
  readonly pendencias: PendenciaApuracaoCustos[];
}

export const margemPercentualCent = (margem: number, liquida: number): number | null =>
  liquida === 0 ? null : dividirArredondado(margem * 10_000, liquida);

const brl = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export function custearContas(
  linhas: readonly LinhaApuracaoCentro[],
  itens: readonly ItemContaLido[],
): ResultadoCustoContas {
  const contas = new Map<
    number,
    {
      base: Omit<CustoConta, 'custo' | 'margem' | 'margemPercentualCent' | 'parcelas' | 'receitaLiquida'>;
      porCentro: Map<number, { receita: number; custo: number }>;
    }
  >();
  const receitaPorCentro = new Map<number, number>();
  for (const i of itens) {
    let c = contas.get(i.conta);
    if (!c) {
      c = {
        base: {
          conta: i.conta,
          numero: i.numero,
          tipoConta: i.tipoConta,
          convenio: i.convenio,
          procedimento: i.procedimento,
          receitaBruta: 0,
          glosa: 0,
          recurso: 0,
        },
        porCentro: new Map(),
      };
      contas.set(i.conta, c);
    }
    c.base = {
      ...c.base,
      receitaBruta: c.base.receitaBruta + i.bruta,
      glosa: c.base.glosa + i.glosa,
      recurso: c.base.recurso + i.recurso,
    };
    if (i.centro !== null) {
      const p = c.porCentro.get(i.centro) ?? { receita: 0, custo: 0 };
      p.receita += i.bruta;
      c.porCentro.set(i.centro, p);
      receitaPorCentro.set(i.centro, (receitaPorCentro.get(i.centro) ?? 0) + i.bruta);
    }
  }

  const ids = [...contas.keys()].sort((a, b) => a - b);
  let custoNasContas = 0;
  let custoSemConta = 0;
  const semReceita: LinhaApuracaoCentro[] = [];
  for (const l of linhas) {
    if (l.classe !== 'produtivo' || l.custoFinal === 0) continue;
    const pesos = ids.map((id) => Math.max(0, contas.get(id)!.porCentro.get(l.centro)?.receita ?? 0));
    const partes = repartir(l.custoFinal, pesos);
    if (partes === null) {
      custoSemConta += l.custoFinal;
      semReceita.push(l);
      continue;
    }
    ids.forEach((id, k) => {
      const v = partes[k] ?? 0;
      if (v === 0) return;
      const p = contas.get(id)!.porCentro.get(l.centro)!;
      p.custo += v;
      custoNasContas += v;
    });
  }

  const resultado: CustoConta[] = ids.map((id) => {
    const c = contas.get(id)!;
    const parcelas = [...c.porCentro]
      .filter(([, p]) => p.custo !== 0 || p.receita !== 0)
      .map(([centro, p]) => ({ centro, receita: p.receita, custo: p.custo }))
      .sort((a, b) => a.centro - b.centro);
    const custo = parcelas.reduce((s, p) => s + p.custo, 0);
    const receitaLiquida = c.base.receitaBruta - c.base.glosa + c.base.recurso;
    const margem = receitaLiquida - custo;
    return {
      ...c.base,
      receitaLiquida,
      custo,
      margem,
      margemPercentualCent: margemPercentualCent(margem, receitaLiquida),
      parcelas,
    };
  });

  const pendencias: PendenciaApuracaoCustos[] = [];
  if (semReceita.length > 0)
    pendencias.push({
      tipo: 'produtivo-sem-receita',
      bloqueia: false,
      centros: semReceita.map((l) => l.centro),
      centavos: custoSemConta,
      mensagem: `${brl(custoSemConta)} de custo de centro(s) produtivo(s) sem faturamento no mês não chegaram a nenhuma conta: ${semReceita
        .slice(0, 5)
        .map((l) => `${l.codigo} ${l.nome}`)
        .join(', ')}${semReceita.length > 5 ? ` e mais ${semReceita.length - 5}` : ''}.`,
    });
  return { contas: resultado, receitaPorCentro, custoNasContas, custoSemConta, pendencias };
}

/** Agrupa as contas (as parcelas do total são os grupos). `rotulo` traduz a chave para o nome mostrado. */
export function agruparResultado(
  contas: readonly CustoConta[],
  agrupamento: AgrupamentoResultado,
  rotulo: (chave: string) => string = (k) => k,
): { grupos: GrupoResultado[]; total: Omit<GrupoResultado, 'chave' | 'rotulo'> } {
  const vazio = () => ({
    contas: 0,
    receitaBruta: 0,
    glosa: 0,
    recurso: 0,
    receitaLiquida: 0,
    custo: 0,
    margem: 0,
  });
  const g = new Map<string, ReturnType<typeof vazio>>();
  const somar = (
    chave: string,
    x: { receitaBruta: number; glosa: number; recurso: number; receitaLiquida: number; custo: number },
    contaUma: boolean,
  ) => {
    const a = g.get(chave) ?? vazio();
    a.contas += contaUma ? 1 : 0;
    a.receitaBruta += x.receitaBruta;
    a.glosa += x.glosa;
    a.recurso += x.recurso;
    a.receitaLiquida += x.receitaLiquida;
    a.custo += x.custo;
    a.margem += x.receitaLiquida - x.custo;
    g.set(chave, a);
  };
  for (const c of contas) {
    if (agrupamento === 'centro') {
      // Por unidade: a receita bruta e o custo de cada centro; glosa e recurso ficam na conta (não têm centro).
      for (const p of c.parcelas)
        somar(
          String(p.centro),
          { receitaBruta: p.receita, glosa: 0, recurso: 0, receitaLiquida: p.receita, custo: p.custo },
          true,
        );
      const semCentro = c.receitaBruta - c.parcelas.reduce((s, p) => s + p.receita, 0);
      if (semCentro !== 0 || c.glosa !== 0 || c.recurso !== 0)
        somar(
          'sem-centro',
          {
            receitaBruta: semCentro,
            glosa: c.glosa,
            recurso: c.recurso,
            receitaLiquida: semCentro - c.glosa + c.recurso,
            custo: 0,
          },
          false,
        );
      continue;
    }
    const chave =
      agrupamento === 'convenio'
        ? String(c.convenio ?? 'sem-convenio')
        : agrupamento === 'procedimento'
          ? (c.procedimento ?? 'sem-procedimento')
          : (c.tipoConta ?? 'sem-tipo');
    somar(chave, c, true);
  }
  const grupos: GrupoResultado[] = [...g]
    .map(([chave, a]) => ({
      chave,
      rotulo: rotulo(chave),
      ...a,
      margemPercentualCent: margemPercentualCent(a.margem, a.receitaLiquida),
    }))
    .sort((x, y) => y.receitaLiquida - x.receitaLiquida || x.chave.localeCompare(y.chave));
  const t = vazio();
  for (const x of grupos) {
    t.contas += x.contas;
    t.receitaBruta += x.receitaBruta;
    t.glosa += x.glosa;
    t.recurso += x.recurso;
    t.receitaLiquida += x.receitaLiquida;
    t.custo += x.custo;
    t.margem += x.margem;
  }
  return { grupos, total: { ...t, margemPercentualCent: margemPercentualCent(t.margem, t.receitaLiquida) } };
}
