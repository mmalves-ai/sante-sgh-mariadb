// Utilidades da gestão da qualidade (M48, etapa 5): números no formato brasileiro para as contas impressas (toda conta
// agregada sai com as parcelas), datas civis e a competência. Sem banco nem Nest.
import { msLocal } from '../nsp/prazos.js';

const DIA_MS = 86_400_000;

/** Número no formato brasileiro (milhar com ponto, decimal com vírgula), com até `casas` casas. */
export function numeroBr(v: number, casas = 2): string {
  const negativo = v < 0;
  const fixo = Math.abs(v).toFixed(casas);
  const [inteira = '0', decimal] = fixo.split('.');
  const milhar = inteira.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = decimal?.replace(/0+$/, '') ?? '';
  return `${negativo ? '-' : ''}${milhar}${dec ? `,${dec}` : ''}`;
}

/** Arredonda em duas casas (as parcelas vão inteiras). */
export const duasCasas = (v: number): number => Math.round(v * 100) / 100;

/** A data civil `dias` depois de `data` (AAAA-MM-DD). */
export function somarDiasData(data: string, dias: number): string {
  return new Date(msLocal(data.slice(0, 10)) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** A data civil `meses` depois (o dia fica no último do mês quando o mês de destino é mais curto). */
export function somarMeses(data: string, meses: number): string {
  const a = Number(data.slice(0, 4));
  const m = Number(data.slice(5, 7)) - 1 + meses;
  const d = Number(data.slice(8, 10));
  const ano = a + Math.floor(m / 12);
  const mes = ((m % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

/** A competência de um instante (AAAA-MM). */
export const competenciaDe = (instante: string): string => instante.slice(0, 7);

/** A competência anterior. */
export function competenciaAnterior(c: string): string {
  return somarMeses(`${c}-01`, -1).slice(0, 7);
}

/** A competência já terminou no instante `agora` (o mês corrente e os futuros, não). */
export function competenciaFechada(competencia: string, agora: string): boolean {
  return competencia < agora.slice(0, 7);
}

/** O primeiro e o último dia da competência. */
export function diasDaCompetenciaQualidade(competencia: string): { de: string; ate: string } {
  const de = `${competencia}-01`;
  return { de, ate: somarDiasData(somarMeses(de, 1), -1) };
}

/** Tolerância do relógio para "futuro" (o tablet e o servidor podem divergir alguns minutos). */
export const TOLERANCIA_FUTURO_MS = 5 * 60_000;

export function noFuturo(instante: string, agora: string): boolean {
  return msLocal(instante) > msLocal(agora) + TOLERANCIA_FUTURO_MS;
}
