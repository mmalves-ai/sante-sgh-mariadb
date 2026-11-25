// Cliente das rotas da auditoria das checagens de enfermagem (09-AREA linha 86; auditoria-checagem.controller.ts). A
// gravação leva CSRF e a Idempotency-Key (uma por ato: repetir o pedido não grava duas vezes).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const BASE = '/api/enfermagem/auditoria-checagem';

export type SituacaoAuditoria = 'aberta' | 'em_andamento' | 'concluida' | 'cancelada';
export type ResultadoItem = 'pendente' | 'conforme' | 'nao_conforme' | 'nao_aplicavel';

export interface AuditoriaResumo {
  id: number;
  inicio: string;
  fim: string;
  unidade: string | null;
  atendimento: number | null;
  responsavel: string;
  situacao: SituacaoAuditoria;
  resultado: string | null;
  tamanho: number;
  avaliados: number;
  totalAuditado: number | null;
  totalConforme: number | null;
  criadoEm: string;
}

export interface ItemAuditoria {
  id: number;
  sequencia: number;
  horario: number;
  atendimento: number;
  paciente: string;
  previsto: string;
  checadoEm: string | null;
  situacaoChecagem: string;
  checadoPor: string | null;
  resultado: ResultadoItem;
  motivo: number | null;
  motivoDescricao: string | null;
  justificativa: string | null;
  auditor: string | null;
  auditadoEm: string | null;
}

export interface AuditoriaDetalhe extends AuditoriaResumo {
  criterio: string | null;
  observacao: string | null;
  concluidaEm: string | null;
  auditores: {
    usuario: number;
    login: string;
    nome: string;
    papel: 'responsavel' | 'auditor' | 'observador';
  }[];
  itens: ItemAuditoria[];
}

export interface ApoioAuditoria {
  unidades: { codigo: string; descricao: string }[];
  motivos: { id: number; codigo: string; descricao: string; exigeComplemento: boolean }[];
  usuarios: { id: number; login: string; nome: string }[];
}

export interface PedidoAbertura {
  inicio: string;
  fim: string;
  unidade: string | null;
  atendimento: number | null;
  tamanho: number;
  criterio: string | null;
  auditores: { usuario: number; papel: 'auditor' | 'observador' }[];
  observacao: string | null;
}

async function ler<T>(url: string, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function postar<T>(url: string, corpo: unknown, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': `audchk-${crypto.randomUUID()}`,
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export async function lerAuditorias(
  situacao: SituacaoAuditoria | null,
  buscar: typeof fetch = fetch,
): Promise<AuditoriaResumo[]> {
  const q = situacao ? `?${new URLSearchParams({ situacao })}` : '';
  return (await ler<{ itens: AuditoriaResumo[] }>(`${BASE}${q}`, buscar)).itens;
}

export const lerAuditoria = (id: number, buscar: typeof fetch = fetch) =>
  ler<AuditoriaDetalhe>(`${BASE}/${id}`, buscar);

export const lerApoioAuditoria = (buscar: typeof fetch = fetch) =>
  ler<ApoioAuditoria>(`${BASE}/apoio`, buscar);

export const abrirAuditoria = (p: PedidoAbertura, buscar: typeof fetch = fetch) =>
  postar<{ id: number; candidatas: number; amostra: number[]; semente: string; mensagem: string }>(
    BASE,
    p,
    buscar,
  );

export const avaliarItem = (
  id: number,
  item: number,
  p: { resultado: Exclude<ResultadoItem, 'pendente'>; motivo: number | null; justificativa: string | null },
  buscar: typeof fetch = fetch,
) => postar<{ mensagem: string }>(`${BASE}/${id}/itens/${item}`, p, buscar);

export const concluirAuditoria = (id: number, buscar: typeof fetch = fetch) =>
  postar<{ resultado: string; totalAuditado: number; totalConforme: number; mensagem: string }>(
    `${BASE}/${id}/conclusao`,
    {},
    buscar,
  );

export const cancelarAuditoria = (id: number, motivo: string, buscar: typeof fetch = fetch) =>
  postar<{ mensagem: string }>(`${BASE}/${id}/cancelamento`, { motivo }, buscar);
