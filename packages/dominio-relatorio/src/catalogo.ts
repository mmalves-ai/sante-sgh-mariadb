// Catálogo de relatórios: o que sai sem banco (M34; ficha, regras 3 e 4): os parâmetros relativos resolvidos no dia
// (o envio agendado manda "ontem" e "mês anterior"), as colunas de dado de pessoa mascaradas para quem não tem
// `relatorio.dadoPessoal.ver`, os totais e quando a exportação exige justificativa.
import {
  DATAS_RELATIVAS,
  MESES_RELATIVOS,
  type RelatorioCatalogo,
  type ValoresParametros,
} from '@sgh/contratos';

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Uma data relativa no dia `hoje` (AAAA-MM-DD do relógio de parede). */
export function resolverDataRelativa(v: string, hoje: string): string {
  const h = new Date(`${hoje}T00:00:00Z`);
  switch (v) {
    case 'hoje':
      return hoje;
    case 'ontem':
      return dia(new Date(h.getTime() - 86_400_000));
    case 'inicioDoMes':
      return `${hoje.slice(0, 7)}-01`;
    case 'inicioDoMesAnterior':
      return dia(new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() - 1, 1)));
    case 'fimDoMesAnterior':
      return dia(new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 0)));
    default:
      return v;
  }
}

export function resolverMesRelativo(v: string, hoje: string): string {
  const h = new Date(`${hoje}T00:00:00Z`);
  if (v === 'mesAtual') return hoje.slice(0, 7);
  if (v === 'mesAnterior')
    return dia(new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() - 1, 1))).slice(0, 7);
  return v;
}

/**
 * Os valores dos parâmetros com os relativos resolvidos e os ausentes pelo padrão do relatório (o servidor valida o
 * resultado pelo Zod do relatório).
 */
export function resolverParametros(
  r: Pick<RelatorioCatalogo, 'parametros'>,
  valores: Readonly<Record<string, unknown>>,
  hoje: string,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const p of r.parametros) {
    let v = valores[p.campo];
    if ((v === undefined || v === null || v === '') && p.padrao !== undefined) v = p.padrao;
    if (v === undefined || v === null || v === '') continue;
    if (p.tipo === 'data' && typeof v === 'string' && (DATAS_RELATIVAS as readonly string[]).includes(v))
      v = resolverDataRelativa(v, hoje);
    if (p.tipo === 'mes' && typeof v === 'string' && (MESES_RELATIVOS as readonly string[]).includes(v))
      v = resolverMesRelativo(v, hoje);
    out[p.campo] = typeof v === 'number' ? v : String(v);
  }
  return out;
}

export const MASCARA = '•••';

/** As colunas de dado de pessoa saem mascaradas sem a permissão (regra 4). */
export function mascararLinhas(
  r: Pick<RelatorioCatalogo, 'colunas'>,
  linhas: readonly Record<string, string | number | null>[],
  veDadoPessoal: boolean,
): { linhas: Record<string, string | number | null>[]; mascarado: boolean } {
  const pessoais = r.colunas.filter((c) => c.classe === 'pessoal').map((c) => c.campo);
  if (veDadoPessoal || pessoais.length === 0)
    return { linhas: linhas.map((l) => ({ ...l })), mascarado: false };
  return {
    linhas: linhas.map((l) => ({
      ...l,
      ...Object.fromEntries(pessoais.map((c) => [c, l[c] === null || l[c] === undefined ? null : MASCARA])),
    })),
    mascarado: true,
  };
}

/** Totais das colunas marcadas (contagens e dinheiro). */
export function totaisDasLinhas(
  r: Pick<RelatorioCatalogo, 'colunas'>,
  linhas: readonly Record<string, string | number | null>[],
): Record<string, number> {
  const t: Record<string, number> = {};
  for (const c of r.colunas.filter((x) => x.total)) {
    const s = linhas.reduce((a, l) => a + (typeof l[c.campo] === 'number' ? (l[c.campo] as number) : 0), 0);
    t[c.campo] = c.tipo === 'dinheiro' ? Math.round(s * 100) / 100 : s;
  }
  return t;
}

/** Regra 4: exportar o que sai SEM máscara e tem dado de pessoa exige justificativa. */
export function exportacaoExigeJustificativa(
  r: Pick<RelatorioCatalogo, 'colunas'>,
  mascarado: boolean,
): boolean {
  return !mascarado && r.colunas.some((c) => c.classe === 'pessoal');
}

/** Texto canônico dos parâmetros (chaves em ordem) para o resumo SHA-256 da execução (nunca os valores em si). */
export function textoCanonicoParametros(v: ValoresParametros): string {
  return JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))));
}
