// Cliente das telas dos consignados e da manipulação (M46, etapa 4). As leituras vêm tipadas pelos contratos; as
// gravações levam o CSRF e a Idempotency-Key, que vai também no corpo como `chave` (o mesmo pedido reenviado não grava
// duas vezes).
import type {
  CapelaManipulacao,
  ConsumoConsignado,
  GravacaoAgenda,
  IndicadorConsignado,
  ItemAManipular,
  ItemBusca,
  MovimentoConsignado,
  NotaEntradaConsignado,
  OrdemManipulacao,
  SaldoConsignado,
  SaldoItem,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const C = '/api/suprimentos/consignados';
const M = '/api/farmacia/manipulacao';
const JSON_ACEITO = { accept: 'application/json' };

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChaveM464(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m46.e4.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(
    0,
    80,
  );
}

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function gravar<T>(url: string, corpo: Record<string, unknown>, chave: string): Promise<T> {
  const r = await fetch(url, {
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
  return (await r.json()) as T;
}

const qs = (o: Record<string, string | number | null | undefined>) => {
  const p = Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return p.length ? `?${new URLSearchParams(p.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

// ── Consignados ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface PainelConsignado {
  readonly hoje: string;
  readonly saldos: SaldoConsignado[];
  readonly consumos: ConsumoConsignado[];
  readonly movimentos: MovimentoConsignado[];
  readonly indicador: IndicadorConsignado;
  readonly semFornecedor: number;
  readonly cortada: boolean;
  readonly gravacao: GravacaoAgenda;
}

export interface ResultadoConsignado {
  readonly ok: true;
  readonly grupo: number;
  readonly movimentos: readonly number[];
  readonly repetido: boolean;
  readonly mensagem: string;
  readonly aviso: string | null;
}

export const lerPainelConsignado = (fornecedor: number | null) =>
  ler<PainelConsignado>(`${C}${qs({ fornecedor })}`);
export const buscarFornecedoresConsignado = (termo: string) =>
  ler<{ itens: { codigo: number; nome: string }[]; cortada: boolean }>(`${C}/fornecedores${qs({ termo })}`);
export const buscarItensConsignado = (termo: string) =>
  ler<{ itens: ItemBusca[] }>(`${C}/itens${qs({ termo })}`);
export const lerNotasConsignado = (fornecedor: number, item: number) =>
  ler<{ itens: NotaEntradaConsignado[] }>(`${C}/notas${qs({ fornecedor, item })}`);
export const registrarRemessaConsignado = (
  corpo: Record<string, unknown>,
  chave = novaChaveM464('remessa'),
) => gravar<ResultadoConsignado>(`${C}/remessas`, corpo, chave);
export const reporConsignado = (corpo: Record<string, unknown>, chave = novaChaveM464('repor')) =>
  gravar<ResultadoConsignado>(`${C}/reposicoes`, corpo, chave);

// ── Manipulação ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface PainelManipulacao {
  readonly hoje: string;
  readonly de: string;
  readonly ate: string;
  readonly itens: ItemAManipular[];
  readonly ordens: OrdemManipulacao[];
  readonly capelas: CapelaManipulacao[];
  readonly locais: { codigo: number; nome: string }[];
  readonly centros: { codigo: number; nome: string }[];
  readonly regraSobra: { versao: string; horasMaximas: number };
  readonly cortada: boolean;
  readonly gravacao: GravacaoAgenda;
}

export interface ResultadoManipulacao {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly mensagem: string;
}

export const lerPainelManipulacao = (de: string | null, ate: string | null) =>
  ler<PainelManipulacao>(`${M}${qs({ de, ate })}`);
export const buscarInsumosManipulacao = (termo: string) =>
  ler<{ itens: ItemBusca[] }>(`${M}/insumos${qs({ termo })}`);
export const lerInsumoManipulacao = (item: number, local: number) =>
  ler<{ saldo: SaldoItem | null }>(`${M}/insumos/${item}${qs({ local })}`);
export const abrirOrdemManipulacao = (corpo: Record<string, unknown>, chave = novaChaveM464('ordem')) =>
  gravar<ResultadoManipulacao>(M, corpo, chave);
export const conferirOrdemManipulacao = (
  ordem: number,
  corpo: Record<string, unknown>,
  chave = novaChaveM464('conferir'),
) => gravar<ResultadoManipulacao>(`${M}/${ordem}/conferencias`, { ordem, ...corpo }, chave);
export const baixarOrdemManipulacao = (
  ordem: number,
  corpo: Record<string, unknown>,
  chave = novaChaveM464('baixa'),
) => gravar<{ ok: true; mensagem: string }>(`${M}/${ordem}/baixa`, { ordem, ...corpo }, chave);
