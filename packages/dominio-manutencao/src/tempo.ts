// Datas civis (AAAA-MM-DD) e instantes locais (AAAA-MM-DDTHH:MM, horário de Brasília, sem fuso) em minutos UTC, para
// não depender do fuso do processo. Desde 2019 não há horário de verão no Brasil: o instante local é contínuo. O
// "agora" e o "hoje" vêm sempre de quem chama (a API resolve no fuso America/Sao_Paulo); o domínio nunca lê o relógio.

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function utc(ano: number, mes: number, dia: number, hora = 0, minuto = 0): number {
  const t = Date.UTC(ano, mes - 1, dia, hora, minuto);
  const d = new Date(t);
  if (
    d.getUTCFullYear() !== ano ||
    d.getUTCMonth() !== mes - 1 ||
    d.getUTCDate() !== dia ||
    d.getUTCHours() !== hora ||
    d.getUTCMinutes() !== minuto
  )
    throw new Error('Data inválida.');
  return t;
}

/** Dia (contado desde 1970-01-01) da data civil. */
export function diaDe(data: string): number {
  const m = DATA.exec(data);
  if (!m) throw new Error(`Data inválida: ${data}`);
  return utc(Number(m[1]), Number(m[2]), Number(m[3])) / 86_400_000;
}

/** Minutos (desde 1970-01-01 00:00) do instante local ou da data (meia-noite). */
export function minutoDe(instanteOuData: string): number {
  const d = DATA.exec(instanteOuData);
  if (d) return utc(Number(d[1]), Number(d[2]), Number(d[3])) / 60_000;
  const m = INSTANTE.exec(instanteOuData);
  if (!m) throw new Error(`Instante inválido: ${instanteOuData}`);
  return utc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) / 60_000;
}

/** Instante local de volta ao texto AAAA-MM-DDTHH:MM. */
export function instanteDe(minutos: number): string {
  return new Date(minutos * 60_000).toISOString().slice(0, 16);
}

export function dataDoDia(dia: number): string {
  return new Date(dia * 86_400_000).toISOString().slice(0, 10);
}

/** Dias de `de` até `ate` (positivo quando `ate` vem depois). */
export function diasEntre(de: string, ate: string): number {
  return diaDe(ate) - diaDe(de);
}

export function somarDias(data: string, dias: number): string {
  return dataDoDia(diaDe(data) + dias);
}

/** Soma meses mantendo o dia; no mês mais curto, fica no último dia (31/01 + 1 mês = 28/02 ou 29/02). */
export function somarMeses(data: string, meses: number): string {
  const m = DATA.exec(data);
  if (!m) throw new Error(`Data inválida: ${data}`);
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dia = Math.min(Number(m[3]), ultimo);
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Horas com 2 casas (as parcelas impressas dos indicadores). */
export function horas2(minutos: number): number {
  return Math.round((minutos / 60) * 100) / 100;
}

export function arred2(v: number): number {
  return Math.round(v * 100) / 100;
}
