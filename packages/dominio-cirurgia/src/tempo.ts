// Tempos do centro cirúrgico (ficha do M18, regra 7; Anexo A): CCAGENDA guarda o início em DATA_HORA (TIMESTAMP) e a
// duração e o intervalo de preparo como TIMESTAMP com a data sentinela 1899-12-30 (a hora é a duração: 1899-12-30
// 02:30 = 150 minutos; 830 de 830 linhas desde 10/2025); CCCADCIR guarda a duração como texto HHMM ("0130") e as
// horas de início e fim como HHMM. A tela trabalha em minutos. Instantes como texto "AAAA-MM-DD HH:MM" (sem fuso: o
// relógio é o do banco), comparáveis lexicalmente.

export class ErroTempoCirurgia extends Error {
  override readonly name = 'ErroTempoCirurgia';
}

const INSTANTE = /^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):([0-5]\d)$/;
const HHMM = /^([01]\d|2[0-3])([0-5]\d)$/;

/** Minutos desde a meia-noite → "HHMM" (dentro do dia). */
export function hhmmDeMinutos(min: number): string {
  if (!Number.isInteger(min) || min < 0 || min >= 1440) throw new ErroTempoCirurgia('Hora fora do dia.');
  return `${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}`;
}

/** "HHMM" → minutos; "0000", vazio ou inválido → null. */
export function minutosDeHhmm(v: string | null | undefined): number | null {
  const s = (v ?? '').trim();
  const m = HHMM.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "HHMM" → "HH:MM" para a tela. */
export function formatarHhmm(v: string | null | undefined): string {
  const s = (v ?? '').trim();
  return HHMM.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : '';
}

/** Duração em minutos (1 a 1.439) da hora da sentinela 1899-12-30 HH:MM (a data é sempre a sentinela). */
export function duracaoValida(min: number): boolean {
  return Number.isInteger(min) && min >= 1 && min <= 1439;
}

/** Duração em minutos → texto HHMM de CCCADCIR.DURACAO (90 → "0130"). */
export function duracaoTexto(min: number): string {
  if (!duracaoValida(min)) throw new ErroTempoCirurgia('Duração entre 1 minuto e 23:59.');
  return hhmmDeMinutos(min);
}

/** Duração em minutos entre duas horas HHMM do mesmo ato (o fim pode passar da meia-noite). */
export function duracaoEntre(inicio: string, fim: string): number | null {
  const a = minutosDeHhmm(inicio);
  const b = minutosDeHhmm(fim);
  if (a === null || b === null) return null;
  const d = b >= a ? b - a : b + 1440 - a;
  return d > 0 ? d : null;
}

export interface InstanteCivil {
  readonly ano: number;
  readonly mes: number;
  readonly dia: number;
  readonly hora: number;
  readonly minuto: number;
}

export function lerInstante(v: string): InstanteCivil {
  const m = INSTANTE.exec(v.trim());
  if (!m) throw new ErroTempoCirurgia('Instante fora do formato AAAA-MM-DD HH:MM.');
  const [ano, mes, dia, hora, minuto] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia)
    throw new ErroTempoCirurgia('Data inexistente no calendário.');
  return { ano, mes, dia, hora, minuto };
}

export function instanteValido(v: string): boolean {
  try {
    lerInstante(v);
    return true;
  } catch {
    return false;
  }
}

/** Minutos desde 1970-01-01 00:00 (aritmética de intervalos sem fuso). */
export function minutosAbsolutos(v: string): number {
  const c = lerInstante(v);
  return Date.UTC(c.ano, c.mes - 1, c.dia, c.hora, c.minuto) / 60_000;
}

export function deMinutosAbsolutos(min: number): string {
  const d = new Date(min * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function somarMinutos(v: string, min: number): string {
  return deMinutosAbsolutos(minutosAbsolutos(v) + min);
}

/** A data do instante ("AAAA-MM-DD"). */
export function diaDoInstante(v: string): string {
  return v.trim().slice(0, 10);
}

/**
 * Data impossível do legado (ex.: ano 3203 numa linha de CCAGENDA, 1899 noutra): fora de 1990–2099 é mostrada com
 * alerta e nunca entra na conta de sobreposição.
 */
export function dataImpossivel(v: string): boolean {
  const ano = Number(v.slice(0, 4));
  return !Number.isFinite(ano) || ano < 1990 || ano > 2099;
}
