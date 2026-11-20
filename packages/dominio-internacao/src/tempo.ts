// Tempo do movimento (M16): o legado guarda a data sem fuso e a hora como texto "HHMM". O motor trabalha com o
// relógio de parede do estabelecimento codificado em milissegundos "como se fosse UTC" (Date.UTC dos campos), o
// que torna dia, mês e hora aritmética simples, sem horário de verão (o processo roda em TZ=UTC; codec.ts).

export const MINUTO = 60_000;
export const HORA = 60 * MINUTO;
export const DIA = 24 * HORA;

/** "HHMM" (ou "HH:MM") → minutos do dia; vazio ou inválido → 0 (meia-noite, como o legado lê). */
export function minutosDaHora(hora: string | null | undefined): number {
  const t = (hora ?? '').replace(':', '').trim();
  if (!/^\d{3,4}$/.test(t)) return 0;
  const n = t.padStart(4, '0');
  const h = Number(n.slice(0, 2));
  const m = Number(n.slice(2, 4));
  if (h > 23 || m > 59) return 0;
  return h * 60 + m;
}

/** Data de calendário (meia-noite UTC) + hora "HHMM" → instante do relógio de parede (ms). */
export function instante(data: Date, hora: string | null | undefined): number {
  return (
    Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()) + minutosDaHora(hora) * MINUTO
  );
}

/** Dia (número de dias desde 1970-01-01) de uma data ISO "AAAA-MM-DD". */
export function diaDaData(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1) / DIA);
}

/** Data ISO "AAAA-MM-DD" de um dia. */
export function dataDoDia(dia: number): string {
  return new Date(dia * DIA).toISOString().slice(0, 10);
}

/** Mês "AAAA-MM" de um dia. */
export function mesDoDia(dia: number): string {
  return dataDoDia(dia).slice(0, 7);
}

/** Primeiro dia de um mês "AAAA-MM". */
export function primeiroDiaDoMes(mes: string): number {
  return diaDaData(`${mes}-01`);
}

/** Último dia de um mês "AAAA-MM". */
export function ultimoDiaDoMes(mes: string): number {
  const [a, m] = mes.split('-').map(Number);
  return Math.floor(Date.UTC(a ?? 1970, m ?? 1, 1) / DIA) - 1;
}

/** Meses "AAAA-MM" de `de` a `ate`, inclusive. */
export function mesesEntre(de: string, ate: string): string[] {
  const r: string[] = [];
  let [a, m] = de.split('-').map(Number) as [number, number];
  const [aa, mm] = ate.split('-').map(Number) as [number, number];
  while (a < aa || (a === aa && m <= mm)) {
    r.push(`${a}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
  }
  return r;
}

/** O mesmo mês do ano anterior. */
export function mesDoAnoAnterior(mes: string): string {
  const [a, m] = mes.split('-');
  return `${Number(a) - 1}-${m}`;
}

/**
 * Hora de fechamento do censo (regra 7): o dia D fecha em D 00:00 + h horas (h de 1 a 24; 24 = meia-noite do fim
 * do dia). O movimento de D é o que acontece em (fechamento(D-1), fechamento(D)].
 */
export function fechamento(dia: number, horaFechamento: number): number {
  return dia * DIA + horaFechamento * HORA;
}

/** Dia do censo a que um instante pertence: o D com fechamento(D-1) < t ≤ fechamento(D). */
export function diaDoCenso(t: number, horaFechamento: number): number {
  return Math.ceil((t - horaFechamento * HORA) / DIA);
}

/** Dia de calendário do relógio de parede. */
export function diaDoInstante(t: number): number {
  return Math.floor(t / DIA);
}

/** Idade em anos completos numa data (nascimento e data à meia-noite UTC). */
export function idadeEm(nascimento: Date | null, em: Date): number | null {
  if (!nascimento || nascimento.getUTCFullYear() < 1901) return null;
  let anos = em.getUTCFullYear() - nascimento.getUTCFullYear();
  const antes =
    em.getUTCMonth() < nascimento.getUTCMonth() ||
    (em.getUTCMonth() === nascimento.getUTCMonth() && em.getUTCDate() < nascimento.getUTCDate());
  if (antes) anos--;
  return anos >= 0 && anos < 150 ? anos : null;
}

export const FUSO_PADRAO = 'America/Sao_Paulo';

const formatadores = new Map<string, Intl.DateTimeFormat>();

function partes(instanteReal: number, fuso: string): Record<string, number> {
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
  const r: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(instanteReal)))
    if (p.type !== 'literal') r[p.type] = Number(p.value);
  return r;
}

/** Instante real (ms UTC) → relógio de parede do estabelecimento codificado como UTC (o "agora" do motor). */
export function relogioDeParede(instanteReal: number, fuso = FUSO_PADRAO): number {
  const p = partes(instanteReal, fuso);
  return Date.UTC(p['year']!, p['month']! - 1, p['day']!, p['hour']!, p['minute']!, p['second']!);
}

/** Relógio de parede (codificado como UTC) → instante real, pelo deslocamento do fuso naquele momento. */
export function instanteReal(relogio: number, fuso = FUSO_PADRAO): number {
  const deslocamento = relogioDeParede(relogio, fuso) - relogio;
  return relogio - deslocamento;
}
