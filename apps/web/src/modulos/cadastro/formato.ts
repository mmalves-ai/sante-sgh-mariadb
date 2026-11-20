// Formatação das telas do cadastro (M11): datas de calendário AAAA-MM-DD em DD/MM/AAAA (a sentinela do
// legado já vem null do servidor), carimbos ISO em data e hora, e a entrada DD/MM/AAAA de volta em AAAA-MM-DD.
export function dataBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function carimboBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : dataBr(iso);
}

/** DD/MM/AAAA (ou AAAA-MM-DD) → AAAA-MM-DD; null se não for data de calendário válida. */
export function dataDaEntrada(texto: string): string | null {
  const t = texto.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export const somenteDigitos = (s: string): string => s.replace(/\D+/g, '');

/** Diferença entre o que a ficha leu e o que a pessoa digitou: só os campos que mudaram. */
export function diferencas<T extends Record<string, unknown>>(lido: T, atual: T): Partial<T> {
  const r: Partial<T> = {};
  for (const k of Object.keys(atual) as (keyof T)[]) if (atual[k] !== lido[k]) r[k] = atual[k];
  return r;
}
