// Cliente da conferência física do recebimento e da leitura completa do XML da NF-e (C2-038, 05-SUP linha 21). A
// gravação leva o CSRF e a Idempotency-Key (o mesmo pedido reenviado não grava duas vezes).
import type {
  ApontamentoRecebimento,
  SituacaoConferencia,
  TipoRecebimento,
  TributoNota,
} from '@sgh/contratos/regras-suprimentos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const S = '/api/suprimentos/conferencias-recebimento';
const JSON_ACEITO = { accept: 'application/json' };

export interface ConferenciaResumoTela {
  readonly id: number;
  readonly tipo: string;
  readonly fornecedor: number;
  readonly fornecedorNome: string;
  readonly local: number;
  readonly localNome: string;
  readonly numeroNota: string | null;
  readonly chegadaEm: string;
  readonly situacao: SituacaoConferencia;
  readonly conferente: string | null;
  readonly validador: string | null;
  readonly nota: number | null;
  readonly itens: number;
  readonly divergentes: number;
}
export interface ItemConferenciaTela {
  readonly sequencia: number;
  readonly item: number;
  readonly nome: string;
  readonly esperada: number | null;
  readonly conferida: number;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly divergencia: string;
  readonly observacao: string | null;
}
export interface ConferenciaDetalheTela extends ConferenciaResumoTela {
  readonly observacao: string | null;
  readonly motivoCancelamento: string | null;
  readonly itensDetalhe: readonly ItemConferenciaTela[];
}
export interface EsperadoDoPedidoTela {
  readonly item: number;
  readonly nome: string;
  readonly esperada: number;
  readonly controlaLote: boolean;
}
export interface ResultadoConferenciaTela {
  readonly id: number;
  readonly situacao: SituacaoConferencia;
  readonly divergentes: number;
}
export interface NovaConferencia {
  readonly tipo: TipoRecebimento;
  readonly fornecedor: number;
  readonly local: number;
  readonly pedido?: { readonly ano: number; readonly doc: number } | null;
  readonly numeroNota?: string | null;
  readonly serie?: string | null;
  readonly observacao?: string | null;
  readonly itens: readonly {
    readonly item: number;
    readonly esperada: number | null;
    readonly conferida: number;
    readonly lote?: string | null;
    readonly validade?: string | null;
    readonly apontamento?: ApontamentoRecebimento | null;
    readonly observacao?: string | null;
  }[];
}

/** O imposto do item como a API devolve a leitura do XML. */
export interface ImpostoXmlTela {
  readonly tributo: TributoNota;
  readonly base: number;
  readonly aliquota: number;
  readonly valor: number;
  readonly cst: string | null;
}
/** A NF-e lida do XML com os impostos por item e as despesas do total. */
export interface NotaXmlCompletaTela {
  readonly cnpjEmitente: string;
  readonly nomeEmitente: string;
  readonly numero: number;
  readonly serie: string;
  readonly emissao: string;
  readonly frete: number;
  readonly seguro: number;
  readonly outros: number;
  readonly desconto: number;
  readonly itens: readonly {
    readonly codigoFornecedor: string;
    readonly descricao: string;
    readonly unidade: string;
    readonly quantidade: number;
    readonly valorUnitario: number;
    readonly lotes: readonly { lote: string; validade: string; quantidade: number }[];
    readonly impostos: readonly ImpostoXmlTela[];
  }[];
}

let sequencia = 0;
export function novaChaveConferencia(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `conf.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}
async function postar<T>(url: string, corpo: unknown, chave: string): Promise<T> {
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

export const listarConferencias = (situacao: SituacaoConferencia | null) =>
  ler<ConferenciaResumoTela[]>(situacao ? `${S}?situacao=${situacao}` : S);
export const lerConferencia = (id: number) => ler<ConferenciaDetalheTela>(`${S}/${id}`);
export const esperadosDoPedido = (ano: number, doc: number) =>
  ler<EsperadoDoPedidoTela[]>(`${S}/pedido/${ano}/${doc}`);
export const registrarConferencia = (e: NovaConferencia, chave: string) =>
  postar<ResultadoConferenciaTela>(S, e, chave);
export const validarConferencia = (id: number, justificativa: string | null, chave: string) =>
  postar<ResultadoConferenciaTela>(`${S}/${id}/validar`, { justificativa }, chave);
export const cancelarConferencia = (id: number, motivo: string, chave: string) =>
  postar<ResultadoConferenciaTela>(`${S}/${id}/cancelar`, { motivo }, chave);
/** A leitura do XML com os impostos por item e as despesas (a mesma rota da tela de notas, sem cortar campos). */
export const lerXmlNotaCompleta = (xml: string) =>
  postar<NotaXmlCompletaTela>('/api/suprimentos/notas/xml', { xml }, novaChaveConferencia('xml'));
