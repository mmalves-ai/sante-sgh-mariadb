// Os internados da unidade mudam devagar (admissão, alta, troca de leito): guardados por 30 s por cliente,
// estabelecimento e unidade, para a linha do tempo do turno de vários aparelhos não reler o censo a cada abertura.
// A falha não fica guardada.
import type { ContextoNucleo } from '@sgh/nucleo';
import type { Internado } from './tipos.js';

const INTERNADOS_TTL_MS = 30_000;
const cacheInternados = new Map<string, { ate: number; valor: Promise<Internado[]> }>();

export function internadosEmCache(
  c: Pick<ContextoNucleo, 'cliente' | 'estabelecimento'>,
  unidade: string,
  ler: () => Promise<Internado[]>,
  agora = Date.now(),
): Promise<Internado[]> {
  const k = `${c.cliente}|${c.estabelecimento ?? '-'}|${unidade}`;
  const guardado = cacheInternados.get(k);
  if (guardado && guardado.ate > agora) return guardado.valor;
  const valor = ler();
  cacheInternados.set(k, { ate: agora + INTERNADOS_TTL_MS, valor });
  valor.catch(() => cacheInternados.delete(k));
  return valor;
}
