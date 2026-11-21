// Hora neutra do produto (F2.4): a hora do dia trafega como texto "HH:MM" (00:00 a 23:59) e o momento com data
// trafega como instante ISO 8601 com fuso. Data e hora de calendário viram instante pelo fuso do estabelecimento
// (IANA, por exemplo "America/Sao_Paulo"), nunca pelo fuso do servidor. Sem conversão de valores do sistema de
// origem: isso é do conector.
import { z } from 'zod';
import { ErroValidacao } from '../validacao/erro.js';

/** Fuso padrão do estabelecimento, quando a configuração não traz outro. */
export const FUSO_PADRAO = 'America/Sao_Paulo';

/** Hora do dia "HH:MM", de 00:00 a 23:59. */
export const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MINUTOS_NO_DIA = 1440;

export class ErroHoraInvalida extends ErroValidacao {
  override readonly name: string = 'ErroHoraInvalida';
}

/** Contrato: hora do dia estrita "HH:MM". */
export const esquemaHora = z.string().regex(FORMATO_HORA, 'Hora inválida: use HH:MM (00:00 a 23:59).');

/** Contrato: instante ISO 8601 com fuso explícito (Z ou ±hh:mm). */
export const esquemaInstante = z.iso.datetime({ offset: true });

/**
 * Hora digitada na tela → "HH:MM". Aceita "8:30", "08:30", "830" e "0830"; vazio → null; o resto lança
 * `hora.formato` ou `hora.fora-do-intervalo`.
 */
export function lerHoraDigitada(entrada: string): string | null {
  const t = entrada.trim();
  if (t === '') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t) ?? /^(\d{1,2})(\d{2})$/.exec(t);
  if (!m) {
    throw new ErroHoraInvalida(
      'hora.formato',
      { entrada },
      `Hora inválida: "${entrada}". Use HH:MM, por exemplo 08:30.`,
    );
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) {
    throw new ErroHoraInvalida(
      'hora.fora-do-intervalo',
      { entrada },
      `Hora fora do intervalo: "${entrada}" (00:00 a 23:59).`,
    );
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "HH:MM" → minutos desde 00:00 (0 a 1439). Lança se a hora não for "HH:MM". */
export function horaParaMinutos(hora: string): number {
  if (!FORMATO_HORA.test(hora)) {
    throw new ErroHoraInvalida('hora.formato', { entrada: hora }, `Hora inválida: "${hora}". Use HH:MM.`);
  }
  return Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3));
}

/** Minutos desde 00:00 (inteiro de 0 a 1439) → "HH:MM". Lança fora da faixa. */
export function minutosParaHora(minutos: number): string {
  if (!Number.isInteger(minutos) || minutos < 0 || minutos >= MINUTOS_NO_DIA) {
    throw new ErroHoraInvalida(
      'hora.fora-do-intervalo',
      { entrada: String(minutos) },
      `Minutos fora do dia: ${minutos} (0 a ${MINUTOS_NO_DIA - 1}).`,
    );
  }
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

type Partes = { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number };

const formatadores = new Map<string, Intl.DateTimeFormat>();

function partesNoFuso(ms: number, fuso: string): Partes {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatadores.set(fuso, f);
  }
  const v: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') v[p.type] = Number(p.value);
  return {
    ano: v['year']!,
    mes: v['month']!,
    dia: v['day']!,
    hora: v['hour']!,
    minuto: v['minute']!,
    segundo: v['second']!,
  };
}

function utcDe(p: Partes): number {
  const d = new Date(0);
  d.setUTCFullYear(p.ano, p.mes - 1, p.dia);
  d.setUTCHours(p.hora, p.minuto, p.segundo, 0);
  return d.getTime();
}

const dois = (n: number) => String(n).padStart(2, '0');

/**
 * Data de calendário "AAAA-MM-DD" + hora "HH:MM" no fuso do estabelecimento → instante ISO em UTC
 * ("2026-03-10T11:30:00.000Z"). Na hora que não existe (início do horário de verão) vale o deslocamento anterior.
 */
export function dataHoraParaInstante(data: string, hora: string, fuso: string = FUSO_PADRAO): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!m) {
    throw new ErroHoraInvalida(
      'data.formato',
      { entrada: data },
      `Data inválida: "${data}". Use AAAA-MM-DD.`,
    );
  }
  const minutos = horaParaMinutos(hora);
  const local: Partes = {
    ano: Number(m[1]),
    mes: Number(m[2]),
    dia: Number(m[3]),
    hora: Math.floor(minutos / 60),
    minuto: minutos % 60,
    segundo: 0,
  };
  const alvo = utcDe(local);
  // Deslocamento do fuso medido no próprio instante (duas passagens cobrem a troca de horário de verão).
  let ms = alvo - (utcDe(partesNoFuso(alvo, fuso)) - alvo);
  ms = alvo - (utcDe(partesNoFuso(ms, fuso)) - ms);
  return new Date(ms).toISOString();
}

/** Instante ISO (qualquer fuso) → data "AAAA-MM-DD" e hora "HH:MM" no fuso do estabelecimento. */
export function instanteParaDataHora(
  instante: string,
  fuso: string = FUSO_PADRAO,
): { readonly data: string; readonly hora: string } {
  const ms = Date.parse(instante);
  if (!esquemaInstante.safeParse(instante).success || Number.isNaN(ms)) {
    throw new ErroHoraInvalida(
      'instante.formato',
      { entrada: instante },
      `Instante inválido: "${instante}".`,
    );
  }
  const p = partesNoFuso(ms, fuso);
  return {
    data: `${String(p.ano).padStart(4, '0')}-${dois(p.mes)}-${dois(p.dia)}`,
    hora: `${dois(p.hora)}:${dois(p.minuto)}`,
  };
}

/** Instante ISO → hora "HH:MM" no fuso do estabelecimento. */
export function instanteParaHora(instante: string, fuso: string = FUSO_PADRAO): string {
  return instanteParaDataHora(instante, fuso).hora;
}
