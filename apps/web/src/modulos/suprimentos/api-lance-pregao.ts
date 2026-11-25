// Cliente da tela dos lances do pregão (C2-030, 05-SUP linha 26). O lance leva o CSRF e a Idempotency-Key (o mesmo
// pedido reenviado não grava duas vezes).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const S = '/api/suprimentos/lances-pregao';
const JSON_ACEITO = { accept: 'application/json' };

export interface ProcessoEmDisputaTela {
  readonly id: number;
  readonly numero: string;
  readonly objeto: string;
  readonly modalidade: string;
}
export interface ItemDisputaTela {
  readonly id: number;
  readonly sequencia: number;
  readonly descricao: string;
  readonly quantidade: number;
  readonly propostas: readonly {
    readonly fornecedor: number;
    readonly fornecedorNome: string;
    readonly valor: number;
    readonly ultimoLance: number | null;
    readonly apta: boolean;
  }[];
  readonly lances: readonly {
    readonly id: number;
    readonly fornecedor: number;
    readonly rodada: number;
    readonly valor: number;
    readonly em: string;
  }[];
  readonly classificacao: readonly { fornecedor: number; valor: number; posicao: number }[];
}
export interface DisputaTela {
  readonly id: number;
  readonly numero: string;
  readonly objeto: string;
  readonly etapa: string;
  readonly modalidade: string;
  readonly sentido: 'menor' | 'maior' | null;
  readonly itens: readonly ItemDisputaTela[];
}
export interface ResultadoLanceTela {
  readonly id: number;
  readonly item: number;
  readonly fornecedor: number;
  readonly rodada: number;
  readonly valor: number;
  readonly posicao: number;
}

let sequencia = 0;
export function novaChaveLance(): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `lance.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const listarProcessosEmDisputa = () => ler<ProcessoEmDisputaTela[]>(S);
export const lerDisputa = (processo: number) => ler<DisputaTela>(`${S}/${processo}`);
export async function registrarLance(
  processo: number,
  corpo: { item: number; fornecedor: number; valor: number; intervaloMinimoPercentual: number | null },
  chave: string,
): Promise<ResultadoLanceTela> {
  const r = await fetch(`${S}/${processo}`, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as ResultadoLanceTela;
}
