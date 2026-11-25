// Cliente da tela da entrada de serviço tomado (F7, 09-AREA linha 78, C2-094): o apoio (fornecedores, pedidos de serviço
// com os itens e o saldo, serviços, centros de custo e moedas), a prévia das retenções (a mesma regra da gravação), as
// entradas por competência e situação, o detalhe (itens, câmbio e retenções por tributo) e as gravações (registrar,
// concluir, cancelar). A regra é a do domínio: a tela a confere na hora e o servidor confere de novo na gravação.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/fiscal/entradas-servico';

export interface OpcaoEntradaServico {
  readonly id: number;
  readonly rotulo: string;
}
export interface ItemPedidoTela {
  readonly id: number;
  readonly servico: number;
  readonly descricao: string;
  readonly saldo: number;
  readonly valorUnitario: number;
}
export interface PedidoServicoTela {
  readonly id: number;
  readonly rotulo: string;
  readonly fornecedor: number;
  readonly situacao: string;
  readonly itens: readonly ItemPedidoTela[];
}
export interface ApoioEntradaServico {
  readonly fornecedores: readonly OpcaoEntradaServico[];
  readonly pedidos: readonly PedidoServicoTela[];
  readonly servicos: readonly OpcaoEntradaServico[];
  readonly centros: readonly OpcaoEntradaServico[];
  readonly moedas: readonly OpcaoEntradaServico[];
}
export interface RetencaoPrevia {
  readonly tributo: string;
  readonly campo: string | null;
  readonly base: number;
  readonly aliquota: number;
  readonly valorTributo: number;
  readonly valorRetido: number;
  readonly valorNaoRetido: number;
  readonly dispensada: boolean;
}
export interface PreviaRetencoes {
  readonly retencoes: readonly RetencaoPrevia[];
  readonly liquido: number;
  readonly reinf: Readonly<Record<string, number>>;
}
export interface EntradaServicoTela {
  readonly id: number;
  readonly versao: number;
  readonly numero: string;
  readonly documento: string;
  readonly serie: string | null;
  readonly fornecedor: string;
  readonly fornecedorDocumento: string;
  readonly pedido: string | null;
  readonly emissao: string | null;
  readonly entrada: string | null;
  readonly competencia: string;
  readonly valorBruto: number;
  readonly retido: number;
  readonly liquido: number;
  readonly situacao: 'aberta' | 'concluida' | 'cancelada';
  readonly titulo: number | null;
  readonly concluidaEm: string | null;
}
export interface DetalheEntradaServico extends EntradaServicoTela {
  readonly itens: readonly {
    readonly sequencia: number;
    readonly servico: string;
    readonly descricao: string | null;
    readonly quantidade: number;
    readonly valorUnitario: number;
    readonly valorDesconto: number;
    readonly valorTotal: number;
    readonly centro: string;
    readonly doPedido: boolean;
    readonly inssNaoRetido: number;
  }[];
  readonly retencoes: readonly {
    readonly tributo: string;
    readonly base: number;
    readonly aliquota: number;
    readonly devido: number;
    readonly retido: number;
    readonly naoRetido: number;
    readonly dispensada: boolean;
  }[];
  readonly cambio: {
    readonly moeda: string;
    readonly dataCotacao: string | null;
    readonly taxa: number;
    readonly valorMoeda: number;
    readonly valorConvertido: number;
  } | null;
}
export interface ItemRegistro {
  readonly servico: number;
  readonly pedidoItem: number | null;
  readonly descricao: string | null;
  readonly quantidade: number;
  readonly valorUnitario: number;
  readonly valorDesconto: number;
  readonly centroCusto: number;
  readonly inssNaoRetido: number;
  readonly processoJudicial: string | null;
}
export interface RegistroEntradaServico {
  readonly fornecedor: number;
  readonly pedido: number | null;
  readonly numeroDocumento: string;
  readonly serie: string | null;
  readonly dataEmissao: string;
  readonly dataEntrada: string;
  readonly competencia: string;
  readonly issRetido: boolean;
  readonly aliquotaIss: number | null;
  readonly observacao: string | null;
  readonly itens: readonly ItemRegistro[];
  readonly cambio: {
    readonly moeda: number;
    readonly dataCotacao: string;
    readonly taxa: number;
    readonly valorMoeda: number;
    readonly sugerido: boolean;
  } | null;
}

const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoFinanceiro>();

export const lerApoioEntradaServico = (): Promise<ApoioEntradaServico> =>
  ler(`${P}/apoio`, confiar<ApoioEntradaServico>());
export const lerEntradasServico = (
  competencia: string | null,
  situacao: string | null,
): Promise<EntradaServicoTela[]> =>
  ler(`${P}${qs({ competencia, situacao })}`, z.array(confiar<EntradaServicoTela>()));
export const lerDetalheEntradaServico = (id: number): Promise<DetalheEntradaServico> =>
  ler(`${P}/${id}`, confiar<DetalheEntradaServico>());
/** A prévia das retenções pela regra vigente (IR, INSS, PIS, COFINS, CSLL) e o ISS pela nota. */
export const lerPreviaRetencoes = (p: {
  fornecedor: number;
  valor: number;
  emissao: string;
  issRetido: boolean;
  aliquotaIss: number | null;
  inssNaoRetido: number;
}): Promise<PreviaRetencoes> =>
  ler(
    `${P}/retencoes${qs({
      fornecedor: String(p.fornecedor),
      valor: String(p.valor),
      emissao: p.emissao,
      issRetido: String(p.issRetido),
      aliquotaIss: p.aliquotaIss === null ? null : String(p.aliquotaIss),
      inssNaoRetido: String(p.inssNaoRetido),
    })}`,
    confiar<PreviaRetencoes>(),
  );

/** Registra a nota de serviço (contra o pedido ou avulsa); as retenções são calculadas e gravadas por item. */
export const registrarEntradaServico = (
  e: RegistroEntradaServico,
  chave: string,
): Promise<ResultadoFinanceiro> => enviar(P, e, resultado, chave);
/** Conclui: o atendido vai ao pedido e a nota vai à escrituração (o título, se já houver, fica ligado). */
export const concluirEntradaServico = (
  id: number,
  versao: number,
  titulo: number | null,
  chave: string,
): Promise<ResultadoFinanceiro> => enviar(`${P}/${id}/concluir`, { versao, titulo }, resultado, chave);
/** Cancela com justificativa: o saldo volta ao pedido e a entrada fica no histórico. */
export const cancelarEntradaServico = (
  id: number,
  versao: number,
  justificativa: string,
  chave: string,
): Promise<ResultadoFinanceiro> => enviar(`${P}/${id}/cancelar`, { versao, justificativa }, resultado, chave);
