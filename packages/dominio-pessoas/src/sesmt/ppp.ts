// Perfil Profissiográfico Previdenciário de consulta (M52.5, corretor; D-PPP-525; IN PRES/INSS 128/2022, art. 284; o
// PPP eletrônico sai do evento S-2240 do eSocial, que chega com o eSocial): os períodos de atribuição do vínculo pela
// função efetiva (a função, ou o cargo sem função) lida do histórico funcional só de inclusão, e as linhas do mapa de
// riscos e do EPI exigido que valeram em cada período (a linha sem unidade vale em todas).
import { diasEntre } from '../datas.js';
import { somarDias } from './cat.js';
import { chaveFuncao, type LinhaRiscoLida } from './epi.js';

export interface MudancaHistoricoPpp {
  readonly tipo: string;
  readonly vigencia: string;
  readonly antes: string | null;
  readonly depois: string | null;
}

export interface PeriodoAtribuicao {
  readonly inicio: string;
  /** Nulo: em curso. */
  readonly fim: string | null;
  readonly funcao: string;
}

/**
 * Os períodos da função efetiva desde a admissão: o estado inicial é o "antes" da primeira mudança de cargo e de
 * função (ou o atual, sem mudança); cada mudança com vigência fecha o período anterior na véspera. Mudança que não
 * altera a função efetiva não abre período.
 */
export function periodosDeAtribuicao(
  v: {
    readonly admissao: string;
    readonly desligamento: string | null;
    readonly cargo: string;
    readonly funcao: string | null;
  },
  historico: readonly MudancaHistoricoPpp[],
): PeriodoAtribuicao[] {
  const mudancas = historico
    .filter((h) => h.tipo === 'cargo' || h.tipo === 'funcao')
    .slice()
    .sort((a, b) => (a.vigencia < b.vigencia ? -1 : a.vigencia > b.vigencia ? 1 : 0));
  const primeira = (t: string) => mudancas.find((m) => m.tipo === t);
  let cargo = primeira('cargo') ? (primeira('cargo')?.antes ?? v.cargo) : v.cargo;
  let funcao = primeira('funcao') ? (primeira('funcao')?.antes ?? null) : v.funcao;
  const efetiva = () => (funcao && funcao.trim() ? funcao : cargo);
  const r: { inicio: string; fim: string | null; funcao: string }[] = [
    { inicio: v.admissao, fim: null, funcao: efetiva() },
  ];
  for (const m of mudancas) {
    if (m.tipo === 'cargo') cargo = m.depois ?? cargo;
    else funcao = m.depois;
    const atual = r[r.length - 1];
    if (!atual || chaveFuncao(efetiva()) === chaveFuncao(atual.funcao)) continue;
    if (diasEntre(atual.inicio, m.vigencia) <= 0) {
      atual.funcao = efetiva();
      continue;
    }
    atual.fim = somarDias(m.vigencia, -1);
    r.push({ inicio: m.vigencia, fim: null, funcao: efetiva() });
  }
  const ultimo = r[r.length - 1];
  if (ultimo && v.desligamento) ultimo.fim = v.desligamento;
  return r;
}

/** As linhas do mapa da função e da unidade que valeram em algum dia do período (com o início e o fim recortados). */
export function linhasNoPeriodo<T extends LinhaRiscoLida>(
  mapa: readonly T[],
  p: PeriodoAtribuicao,
  unidade: number | null,
  hoje: string,
): (T & { readonly vigenteDe: string; readonly vigenteAte: string | null })[] {
  const chave = chaveFuncao(p.funcao);
  const fimP = p.fim ?? hoje;
  return mapa
    .filter(
      (l) =>
        l.funcaoChave === chave &&
        (l.unidade === null || l.unidade === unidade) &&
        diasEntre(l.inicio, fimP) >= 0 &&
        (l.fim === null || diasEntre(p.inicio, l.fim) >= 0),
    )
    .map((l) => ({
      ...l,
      vigenteDe: diasEntre(p.inicio, l.inicio) > 0 ? l.inicio : p.inicio,
      vigenteAte:
        l.fim === null ? p.fim : p.fim === null ? l.fim : diasEntre(l.fim, p.fim) > 0 ? l.fim : p.fim,
    }));
}
