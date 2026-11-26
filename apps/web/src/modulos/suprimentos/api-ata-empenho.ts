// Cliente da tela da ata de registro de preços e do empenho (C2-030, 05-SUP linha 26). As gravações levam o CSRF e a
// Idempotency-Key (o mesmo pedido reenviado não grava duas vezes).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const S = '/api/suprimentos';
const JSON_ACEITO = { accept: 'application/json' };

export interface ItemAtaTela {
  readonly id: number;
  readonly sequencia: number;
  readonly insumo: number;
  readonly insumoNome: string;
  readonly fornecedor: number;
  readonly fornecedorNome: string;
  readonly registrada: number;
  readonly utilizada: number;
  readonly saldo: number;
  readonly valorUnitario: number;
  readonly situacao: 'ativo' | 'suspenso' | 'cancelado' | 'esgotado';
}
export interface AtaTela {
  readonly id: number;
  readonly numero: string;
  readonly objeto: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string;
  readonly situacao: 'rascunho' | 'vigente' | 'encerrada' | 'cancelada';
  readonly processo: string | null;
  readonly itens: readonly ItemAtaTela[];
}
export interface EmpenhoTela {
  readonly id: number;
  readonly numero: string;
  readonly emitidoEm: string;
  readonly fornecedor: string;
  readonly fonteRecurso: string;
  readonly valorTotal: number;
  readonly situacao: string;
  readonly ata: string | null;
  readonly itens: number;
  readonly versao: number;
  readonly motivoAnulacao: string | null;
}
export interface ProcessoParaAtaTela {
  readonly id: number;
  readonly numero: string;
  readonly objeto: string;
  readonly itens: readonly {
    readonly insumo: number;
    readonly insumoNome: string;
    readonly fornecedor: number;
    readonly fornecedorNome: string;
    readonly quantidade: number;
    readonly valor: number;
  }[];
}
export interface ResultadoAtaEmpenhoTela {
  readonly id: number;
  readonly numero: string;
  readonly itens: number;
  readonly valorTotal: number;
}

let sequencia = 0;
export function novaChaveAtaEmpenho(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `arp.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}
async function enviar<T>(url: string, corpo: Record<string, unknown>, chave: string): Promise<T> {
  const r = await fetch(url, {
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
  return (await r.json()) as T;
}

export const listarAtas = () => ler<AtaTela[]>(`${S}/atas-registro-preco`);
export const listarProcessosParaAta = () => ler<ProcessoParaAtaTela[]>(`${S}/atas-registro-preco/processos`);
export const listarEmpenhos = () => ler<EmpenhoTela[]>(`${S}/empenhos`);
export const registrarAta = (corpo: Record<string, unknown>, chave: string) =>
  enviar<ResultadoAtaEmpenhoTela>(`${S}/atas-registro-preco`, corpo, chave);
export const emitirEmpenho = (corpo: Record<string, unknown>, chave: string) =>
  enviar<ResultadoAtaEmpenhoTela>(`${S}/empenhos`, corpo, chave);
export const anularEmpenho = (id: number, corpo: { motivo: string; versao: number }, chave: string) =>
  enviar<ResultadoAtaEmpenhoTela>(`${S}/empenhos/${id}/anulacao`, corpo, chave);

// C3-025 (07-FIN linha 132): só a referência do empenho no pedido e no título, com a exportação para o ente.
export interface ReferenciasEmpenhoTela {
  readonly empenho: number;
  readonly numero: string;
  readonly valorTotal: number;
  readonly referido: number;
  readonly saldo: number;
  readonly pedidos: readonly { id: number; numero: string; situacao: string }[];
  readonly titulos: readonly {
    id: number;
    numero: string;
    documento: string;
    valorLiquido: number;
    situacao: string;
  }[];
}
export interface CandidatoReferenciaTela {
  readonly id: number;
  readonly rotulo: string;
  readonly versao: number;
  readonly valor: number | null;
}
export const listarReferenciasEmpenho = (empenho: number) =>
  ler<ReferenciasEmpenhoTela>(`${S}/empenhos/${empenho}/referencias`);
export const listarCandidatosReferencia = (empenho: number, termo: string) =>
  ler<{ pedidos: CandidatoReferenciaTela[]; titulos: CandidatoReferenciaTela[] }>(
    `${S}/empenhos/${empenho}/candidatos?termo=${encodeURIComponent(termo)}`,
  );
export const referirEmpenho = (
  empenho: number,
  alvo: 'pedidos' | 'titulos',
  corpo: { id: number; versao: number },
  chave: string,
) => enviar<ResultadoAtaEmpenhoTela>(`${S}/empenhos/${empenho}/${alvo}`, corpo, chave);
export const urlExportacaoEmpenhos = (inicio: string, fim: string) =>
  `${S}/empenhos/exportacao?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`;
