// Cliente da devolução de compra ao fornecedor (C2-015, 05-SUP linha 22): a lista das devoluções, a busca da nota de
// compra com item a devolver, a nota com o disponível por item e o saldo a pagar, os motivos e a gravação (com o CSRF e
// a Idempotency-Key: a repetição do mesmo pedido devolve o resultado da primeira).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChaveContrato } from './api-contrato.js';

export interface NotaDevolvivelTela {
  readonly id: number;
  readonly numero: number;
  readonly documento: string;
  readonly fornecedor: string;
  readonly entradaEm: string;
  readonly valorTotal: number;
  readonly itensDisponiveis: number;
}

export interface ItemNotaDevolucaoTela {
  readonly notaItem: number;
  readonly item: number;
  readonly nome: string;
  readonly recebida: number;
  readonly jaDevolvida: number;
  readonly disponivel: number;
  readonly custoUnitario: number;
  readonly lotes: string;
}

export interface NotaParaDevolverTela {
  readonly id: number;
  readonly numero: number;
  readonly documento: string;
  readonly fornecedor: string;
  readonly entradaEm: string;
  readonly local: number;
  readonly localNome: string;
  readonly situacao: string;
  /** Soma dos saldos das parcelas a pagar em aberto do título da nota. */
  readonly saldoAPagar: number;
  readonly itens: readonly ItemNotaDevolucaoTela[];
}

export interface MotivoDevolucaoTela {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipoFiscal: string;
}

export interface DevolucaoRegistradaTela {
  readonly id: number;
  readonly numero: string;
  readonly tipo: string;
  readonly fornecedor: string;
  readonly documentoEntrada: string;
  readonly devolvidaEm: string;
  readonly motivo: string;
  readonly numeroNotaFiscal: string | null;
  readonly itens: number;
  readonly valorTotal: number;
  readonly valorAbatido: number;
  readonly creditoPendente: number;
  readonly situacao: string;
}

export interface DevolucaoFornecedorEntradaTela {
  readonly nota: number;
  readonly motivo: number;
  readonly abaterContasPagar: boolean;
  readonly numeroNotaFiscal?: string | null;
  readonly serieNotaFiscal?: string | null;
  readonly chaveAcesso?: string | null;
  readonly dataEmissao?: string | null;
  readonly observacao?: string | null;
  readonly itens: readonly { notaItem: number; quantidade: number }[];
}

export interface ResultadoDevolucaoTela {
  readonly id: number;
  readonly numero: string;
  readonly tipo: 'total' | 'parcial';
  readonly valorTotal: number;
  readonly valorAbatido: number;
  readonly creditoPendente: number;
  readonly notasCredito: string;
}

const B = '/api/suprimentos/devolucoes-fornecedor';

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const listarDevolucoesFornecedor = () => ler<DevolucaoRegistradaTela[]>(B);

export const buscarNotasDevolucao = (busca: string) =>
  ler<NotaDevolvivelTela[]>(`${B}/notas?${new URLSearchParams({ busca }).toString()}`);

export const lerNotaDevolucao = (id: number) => ler<NotaParaDevolverTela>(`${B}/notas/${id}`);

export const motivosDevolucaoFornecedor = () => ler<MotivoDevolucaoTela[]>(`${B}/motivos`);

export async function registrarDevolucaoFornecedor(
  e: DevolucaoFornecedorEntradaTela,
  chave = novaChaveContrato('devolucao-forn'),
): Promise<ResultadoDevolucaoTela> {
  const r = await fetch(B, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(e),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as ResultadoDevolucaoTela;
}
