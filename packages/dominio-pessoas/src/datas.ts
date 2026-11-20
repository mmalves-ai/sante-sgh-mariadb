// Datas civis (AAAA-MM-DD) sem fuso: a diferença em dias é feita em UTC, para não depender do horário de verão.
// O "hoje" vem sempre de quem chama (a API resolve no fuso America/Sao_Paulo); o domínio nunca lê o relógio.

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function diaUtc(data: string): number {
  const m = FORMATO.exec(data);
  if (!m) throw new Error(`Data inválida: ${data}`);
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(ano, mes - 1, dia);
  const d = new Date(t);
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia)
    throw new Error(`Data inválida: ${data}`);
  return t / 86_400_000;
}

/** Dias de `de` até `ate` (positivo quando `ate` vem depois). */
export function diasEntre(de: string, ate: string): number {
  return diaUtc(ate) - diaUtc(de);
}

/** A parte da data de um instante ISO local (`2026-10-24T19:00`) ou a própria data. */
export function dataDe(instanteOuData: string): string {
  return instanteOuData.slice(0, 10);
}
