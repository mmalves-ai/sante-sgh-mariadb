// Período da consulta da trilha (ficha do M10, regra 12 e seção 4; cap-08 §8.12; cap-10 §10.11): obrigatório;
// até 31 dias ao vivo (índice por data); mais que isso só na cópia diária, que esta tela não consulta: o pedido é
// recusado com a orientação. Datas civis (AAAA-MM-DD) no fuso do estabelecimento; o fim é inclusivo.

export const DIAS_AO_VIVO = 31;

export type FalhaPeriodo = 'obrigatorio' | 'formato' | 'invertido' | 'longo' | 'futuro';

export interface Periodo {
  readonly inicio: string;
  readonly fim: string;
  readonly dias: number;
}

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

function paraDia(s: string): number | null {
  const m = DATA.exec(s);
  if (!m) return null;
  const d = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const v = new Date(d);
  if (
    v.getUTCFullYear() !== Number(m[1]) ||
    v.getUTCMonth() !== Number(m[2]) - 1 ||
    v.getUTCDate() !== Number(m[3])
  )
    return null;
  return d / 86_400_000;
}

/** Confere o período pedido; `hoje` é a data civil do estabelecimento (AAAA-MM-DD). */
export function conferirPeriodo(
  inicio: string | null | undefined,
  fim: string | null | undefined,
  hoje: string,
): { readonly ok: true; readonly periodo: Periodo } | { readonly ok: false; readonly falha: FalhaPeriodo } {
  if (!inicio || !fim) return { ok: false, falha: 'obrigatorio' };
  const a = paraDia(inicio);
  const b = paraDia(fim);
  const h = paraDia(hoje);
  if (a === null || b === null || h === null) return { ok: false, falha: 'formato' };
  if (b < a) return { ok: false, falha: 'invertido' };
  if (a > h) return { ok: false, falha: 'futuro' };
  const dias = b - a + 1;
  if (dias > DIAS_AO_VIVO) return { ok: false, falha: 'longo' };
  return { ok: true, periodo: { inicio, fim, dias } };
}

export function mensagemPeriodo(f: FalhaPeriodo): string {
  switch (f) {
    case 'obrigatorio':
      return 'Informe o período (início e fim): a consulta da trilha sempre tem período.';
    case 'formato':
      return 'Datas no formato dia/mês/ano válidas.';
    case 'invertido':
      return 'O fim do período é anterior ao início.';
    case 'futuro':
      return 'O início do período está no futuro.';
    case 'longo':
      return `Até ${DIAS_AO_VIVO} dias por consulta. Para períodos maiores, peça o relatório da cópia diária à equipe técnica.`;
  }
}

/** Início do dia seguinte ao fim (o filtro é `>= inicio AND < fimExclusivo`, que usa o índice por data). */
export function fimExclusivo(fim: string): string {
  const d = paraDia(fim);
  if (d === null) throw new Error('Data inválida.');
  return new Date((d + 1) * 86_400_000).toISOString().slice(0, 10);
}
