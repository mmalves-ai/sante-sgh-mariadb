// Formatação das telas do M16 (sem dependência de fuso do navegador: o estabelecimento é America/Sao_Paulo).
import type { UnidadeIndicador } from '@sgh/contratos';

const FUSO = 'America/Sao_Paulo';
const dataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const reais = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

/** "dd/mm/aaaa hh:mm" no fuso do estabelecimento. */
export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dataHora.format(d).replace(',', '');
}

/** "AAAA-MM-DD" → "dd/mm/aaaa". */
export function formatarData(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "AAAA-MM" → "mm/aaaa". */
export function formatarMes(mes: string): string {
  return /^\d{4}-\d{2}$/.test(mes) ? `${mes.slice(5, 7)}/${mes.slice(0, 4)}` : mes;
}

/** Segundos desde o instante (para o "atualizado há N s"). */
export function segundosDesde(iso: string | null | undefined, agora: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.round((agora - t) / 1000));
}

/** Valor de indicador ou série na unidade (null: "—"). */
export function formatarValor(v: number | null | undefined, unidade: UnidadeIndicador | 'reais'): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (unidade === 'reais') return reais.format(v);
  if (unidade === 'percentual') return `${numero.format(v)}%`;
  if (unidade === 'dias') return `${numero.format(v)} dia(s)`;
  return numero.format(v);
}

export function formatarNumero(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : numero.format(v);
}

/** Mais de 2 dias sem movimento até hoje (AAAA-MM-DD): a tela avisa. */
export function semMovimentoRecente(ultimo: string | null | undefined, hoje: string): boolean {
  if (!ultimo) return false;
  const d = (x: string) => Date.UTC(Number(x.slice(0, 4)), Number(x.slice(5, 7)) - 1, Number(x.slice(8, 10)));
  return (d(hoje) - d(ultimo)) / 86_400_000 > 2;
}

/** Hoje (AAAA-MM-DD) no fuso do estabelecimento. */
export function hojeNoEstabelecimento(agora = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(agora));
}

/** Baixa um texto como arquivo (a planilha exportada). */
export function baixarTexto(conteudo: string, nome: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
