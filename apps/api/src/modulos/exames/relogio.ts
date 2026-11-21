// Relógio civil do estabelecimento (data ISO e hora do dia), pelo fuso do cadastro do estabelecimento
// (estabelecimento.fuso_horario). O processo roda em UTC; o banco guarda instantes.
// Toda hora sai na forma neutra "HH:MM" (formatacao/hora de @sgh/contratos). Este arquivo é compartilhado por cerca
// de 20 módulos (ADT, farmácia, portaria, TISS, pessoas…); instanteCivil ainda aceita a hora digitada em quatro
// dígitos, que o auxiliar neutro converte.
import { ErroHoraInvalida, FUSO_PADRAO, horaParaMinutos, lerHoraDigitada, minutosParaHora } from '@sgh/contratos';
import type { RelogioEstabelecimento } from './tipos.js';

export { FUSO_PADRAO };

/** Hoje ("AAAA-MM-DD") e a hora corrente ("HH:MM") no fuso do estabelecimento. */
export function relogioNoFuso(fuso: string = FUSO_PADRAO, agora: Date = new Date()): RelogioEstabelecimento {
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = formatador(fuso).formatToParts(agora);
  } catch {
    partes = formatador(FUSO_PADRAO).formatToParts(agora);
  }
  const v = (t: string) => partes.find((x) => x.type === t)?.value ?? '00';
  return { hoje: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour')}:${v('minute')}` };
}

/** Hoje e a hora corrente "HH:MM" no fuso do estabelecimento (o `Relogio` do motor da agenda). */
export function relogioDoEstabelecimento(fuso: string = FUSO_PADRAO, agora: Date = new Date()): RelogioEstabelecimento {
  return relogioNoFuso(fuso, agora);
}

function formatador(fuso: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** Hora do dia normalizada para "HH:MM"; recusa (hora.formato / hora.fora-do-intervalo) vazio ou inválido. */
export function normalizarHora(hora: string): string {
  const h = lerHoraDigitada(hora);
  if (h === null) throw new ErroHoraInvalida('hora.formato', { entrada: hora }, 'Hora vazia: use HH:MM.');
  return h;
}

/** "HH:MM" → minutos desde a meia-noite (ou duração em minutos, de 00:00 a 23:59). */
export function minutosDaHora(hora: string): number {
  return horaParaMinutos(normalizarHora(hora));
}

/** Minutos (inteiros, dentro do dia) → "HH:MM"; usado também para a duração gravada em minutos. */
export function horaDeMinutos(min: number): string {
  return minutosParaHora(Math.max(0, Math.round(min)) % 1440);
}

/** Data civil e hora "HH:MM" de um instante, no fuso do estabelecimento. */
export function horaCivil(instante: Date, fuso: string = FUSO_PADRAO): { data: string; hora: string } {
  const r = relogioDoEstabelecimento(fuso, instante);
  return { data: r.hoje, hora: r.hora };
}

/** Data civil e hora "HH:MM" de um instante, no fuso do estabelecimento (o mesmo que horaCivil). */
export function civil(instante: Date, fuso: string = FUSO_PADRAO): { data: string; hora: string } {
  return horaCivil(instante, fuso);
}

/** Instante (UTC) da data civil e hora ("HH:MM", ou digitada sem os dois-pontos) no fuso do estabelecimento. */
export function instanteCivil(data: string, hora: string, fuso: string = FUSO_PADRAO): Date {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const min = minutosDaHora(hora);
  const alvo = Date.UTC(a, m - 1, d, Math.floor(min / 60), min % 60);
  let palpite = alvo;
  // Duas voltas bastam: a diferença entre o relógio civil e o UTC é a do fuso naquele instante.
  for (let i = 0; i < 2; i++) {
    const c = horaCivil(new Date(palpite), fuso);
    const [ca, cm, cd] = c.data.split('-').map(Number) as [number, number, number];
    const cmin = minutosDaHora(c.hora);
    const visto = Date.UTC(ca, cm - 1, cd, Math.floor(cmin / 60), cmin % 60);
    palpite += alvo - visto;
  }
  return new Date(palpite);
}
