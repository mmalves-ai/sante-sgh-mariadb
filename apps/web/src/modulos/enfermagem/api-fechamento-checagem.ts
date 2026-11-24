// Cliente das rotas do fechamento da checagem do turno (03-PEP L113; fechamento-checagem.controller.ts). A gravação
// leva CSRF e a Idempotency-Key (uma por ato: repetir o pedido não fecha duas vezes).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const BASE = '/api/enfermagem/fechamento-checagem';

export interface FechamentoChecagem {
  id: number;
  atendimento: number | null;
  inicio: string;
  fim: string;
  horarios: number;
  situacao: 'fechado' | 'reaberto';
  fechadoEm: string;
  fechadoPor: string | null;
  reabertoEm: string | null;
  motivoReabertura: string | null;
}

export interface FechamentoFeito {
  id: number;
  travados: number;
  pendentes: number[];
  mensagem: string;
}

async function postar<T>(url: string, corpo: unknown, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': `fech-${crypto.randomUUID()}`,
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export async function lerFechamentos(
  unidade: string,
  data: string,
  buscar: typeof fetch = fetch,
): Promise<FechamentoChecagem[]> {
  const q = new URLSearchParams({ unidade, data });
  const r = await buscar(`${BASE}?${q}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return ((await r.json()) as { itens: FechamentoChecagem[] }).itens;
}

export function fecharTurno(
  p: { unidade: string; data: string; turno: 'diurno' | 'noturno'; justificativa: string | null },
  buscar: typeof fetch = fetch,
): Promise<FechamentoFeito> {
  return postar(BASE, { ...p, atendimento: null }, buscar);
}

export function reabrirFechamento(id: number, motivo: string, buscar: typeof fetch = fetch) {
  return postar<{ id: number; horarios: number; mensagem: string }>(
    `${BASE}/${id}/reabertura`,
    { motivo },
    buscar,
  );
}
