// Regra 16 do M32 (cap-06b §6.8; ref 01 §0 achado 11): a DRE gerencial com DUAS réguas declaradas.
//   - competência: a receita da conta hospitalar pela competência dela (ano e mês), menos a glosa aceita;
//   - caixa: o que entrou e saiu nas datas de recebimento e de pagamento.
// A divergência mensal entre as réguas de receita chega a 55% (o recebimento atrasa meses): a tela mostra as duas, a
// régua escolhida e a divergência; nunca soma uma com a outra.
import { centavos } from '@sgh/contratos/regras-financeiro';

export type Regua = 'competencia' | 'caixa';

export interface ReceitaCompetencia {
  /** ANOPRO*100 + MESPRO da conta (ex.: 202603). */
  readonly competencia: number;
  readonly valor: number;
  readonly glosaAceita: number;
}

export interface MovimentoCaixa {
  /** AAAA-MM-DD do recebimento ou do pagamento. */
  readonly data: string;
  readonly valor: number;
  readonly natureza: 'receita' | 'despesa';
  /** Grupo gerencial para a abertura da DRE. */
  readonly grupo: number;
}

export interface DespesaCompetencia {
  readonly competencia: number;
  readonly valor: number;
  readonly grupo: number;
}

export interface LinhaDre {
  readonly mes: string;
  readonly receitaCompetencia: number;
  readonly glosaAceita: number;
  readonly receitaLiquidaCompetencia: number;
  readonly receitaCaixa: number;
  readonly despesaCompetencia: number;
  readonly despesaCaixa: number;
  readonly resultadoCompetencia: number;
  readonly resultadoCaixa: number;
  /** |competência − caixa| / competência (receita), em %; nulo sem receita de competência. */
  readonly divergenciaReceita: number | null;
}

export const mesDaCompetencia = (c: number): string =>
  `${Math.floor(c / 100)}-${String(c % 100).padStart(2, '0')}`;

/** A DRE dos meses (AAAA-MM) pedidos, com as duas réguas lado a lado. */
export function montarDre(
  meses: readonly string[],
  receitas: readonly ReceitaCompetencia[],
  despesas: readonly DespesaCompetencia[],
  caixa: readonly MovimentoCaixa[],
): LinhaDre[] {
  return meses.map((mes) => {
    const rc = receitas.filter((r) => mesDaCompetencia(r.competencia) === mes);
    const bruta = centavos(rc.reduce((s, r) => s + r.valor, 0));
    const glosa = centavos(rc.reduce((s, r) => s + r.glosaAceita, 0));
    const liquida = centavos(bruta - glosa);
    const cx = caixa.filter((m) => m.data.slice(0, 7) === mes);
    const receitaCaixa = centavos(
      cx.filter((m) => m.natureza === 'receita').reduce((s, m) => s + m.valor, 0),
    );
    const despesaCaixa = centavos(
      cx.filter((m) => m.natureza === 'despesa').reduce((s, m) => s + m.valor, 0),
    );
    const despesaCompetencia = centavos(
      despesas.filter((d) => mesDaCompetencia(d.competencia) === mes).reduce((s, d) => s + d.valor, 0),
    );
    return {
      mes,
      receitaCompetencia: bruta,
      glosaAceita: glosa,
      receitaLiquidaCompetencia: liquida,
      receitaCaixa,
      despesaCompetencia,
      despesaCaixa,
      resultadoCompetencia: centavos(liquida - despesaCompetencia),
      resultadoCaixa: centavos(receitaCaixa - despesaCaixa),
      divergenciaReceita:
        liquida > 0 ? Math.round((Math.abs(liquida - receitaCaixa) / liquida) * 10_000) / 100 : null,
    };
  });
}

/** A abertura de uma régua por grupo gerencial (parcelas que somam o total da régua). */
export function aberturaPorGrupo(
  linhas: readonly { grupo: number; valor: number }[],
): { grupo: number; valor: number }[] {
  const m = new Map<number, number>();
  for (const l of linhas) m.set(l.grupo, centavos((m.get(l.grupo) ?? 0) + l.valor));
  return [...m.entries()].map(([grupo, valor]) => ({ grupo, valor })).sort((a, b) => a.grupo - b.grupo);
}
