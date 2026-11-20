// Cliente das telas da anestesia no bloco (M46, etapa 1: APA, ficha anestésica e SRPA). As leituras vêm tipadas pelos
// contratos; as gravações levam o CSRF e a Idempotency-Key, que vai também no corpo como `chave` (o mesmo pedido
// reenviado não grava duas vezes, inclusive o que a fila sem rede reenvia). Problem Details viram ErroApi; o código da
// recusa (ex.: ficha-lacuna-sinais) fica em `problema.codigo`.
import type {
  CirurgiasParaAnestesiaResposta,
  QuadroSrpaResposta,
  ResultadoAnestesia,
  TelaApaResposta,
  TelaFichaResposta,
  TelaSrpaResposta,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

export { codigoDaRecusa } from './api-cirurgia.js';

const A = '/api/cirurgia/anestesia';
const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste aparelho). */
export function novaChaveAnestesia(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m46.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

export async function gravarAnestesia(
  url: string,
  corpo: Record<string, unknown>,
  chave: string = novaChaveAnestesia('ato'),
): Promise<ResultadoAnestesia> {
  const r = await fetch(`${A}${url}`, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify({ ...corpo, chave }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as ResultadoAnestesia;
}

const qs = (o: Record<string, string | null | undefined>) => {
  const p = Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return p.length ? `?${new URLSearchParams(p as [string, string][]).toString()}` : '';
};

export const lerCirurgiasAnestesia = (data: string | null) =>
  ler<CirurgiasParaAnestesiaResposta>(`${A}/cirurgias${qs({ data })}`);
export const lerApa = (agenda: number) => ler<TelaApaResposta>(`${A}/${agenda}/apa`);
export const lerFicha = (agenda: number) => ler<TelaFichaResposta>(`${A}/${agenda}/ficha`);
export const lerSrpa = (agenda: number) => ler<TelaSrpaResposta>(`${A}/${agenda}/srpa`);
export const lerQuadroSrpa = () => ler<QuadroSrpaResposta>(`${A}/srpa/quadro`);
export const buscarAnestesistas = (q: string) =>
  ler<{ id: number; cod: number; nome: string }[]>(`${A}/profissionais${qs({ q })}`);
export const buscarFarmacos = (q: string) =>
  ler<{ codigo: number; nome: string; unidade: string | null }[]>(`${A}/itens${qs({ q })}`);
