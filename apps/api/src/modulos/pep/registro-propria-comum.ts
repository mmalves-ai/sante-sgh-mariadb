// Base comum das portas próprias do PEP: o núcleo de leitura e as datas e horas no fuso do estabelecimento. Fica num
// módulo sem import de volta das portas (a porta do registro, a gravação do registro e o catálogo da prescrição a usam),
// para não haver import circular entre a porta e as suas partes.
import type { Leitor } from '@sgh/nucleo';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoLeituraPep {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

/** Fuso do estabelecimento sem fuso válido no cadastro (o mesmo padrão da coluna estabelecimento.fuso_horario). */
export const FUSO_PADRAO = 'America/Sao_Paulo';

const formatadores = new Map<string, Intl.DateTimeFormat>();
function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatadores.set(fuso, f);
  }
  return f;
}
/** Fuso IANA válido do estabelecimento; inválido ou vazio cai no padrão. */
export function fusoValido(v: unknown): string {
  const f = v === null || v === undefined ? null : String(v);
  if (!f) return FUSO_PADRAO;
  try {
    formatador(f);
    return f;
  } catch {
    return FUSO_PADRAO;
  }
}
/**
 * Instante do banco (UTC) na data e hora civil do estabelecimento (AAAA-MM-DDTHH:MM:SS); null se vazio. Os getters
 * locais do processo não entram: o resultado não depende do TZ da máquina.
 */
export const dataHora = (v: unknown, fuso: string): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const partes = formatador(fuso).formatToParts(d);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '00';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
};
