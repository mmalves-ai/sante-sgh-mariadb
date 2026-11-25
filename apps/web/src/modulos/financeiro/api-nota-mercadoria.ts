// Cliente da tela da NF-e de saída de mercadoria (F7, 07-FIN linha 114, C2-059): o apoio (naturezas com o CFOP dentro e
// fora do estado, devoluções ao fornecedor ainda sem nota, fornecedores, clientes, insumos e motivos de cancelamento),
// as notas do estabelecimento, o histórico (itens, referências e eventos), o DANFE e as gravações (emitir da devolução,
// do conserto ou avulsa; cancelar; carta de correção). A regra (CFOP, tributos, prazos) é a do domínio: a tela a mostra
// na hora e o servidor confere de novo na gravação.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/fiscal/notas-mercadoria';

export interface NaturezaNfeTela {
  readonly codigo: string;
  readonly descricao: string;
  readonly finalidade: 'devolucao' | 'conserto' | 'simples_remessa' | 'venda';
  readonly cfopDentro: string;
  readonly cfopFora: string;
  readonly exigeReferencia: boolean;
  readonly ativa: boolean;
}
export interface DevolucaoSemNota {
  readonly devolucao: number;
  readonly numero: string;
  readonly consignado: boolean;
  readonly fornecedor: string;
  readonly valor: number;
  readonly itens: number;
  readonly devolvidaEm: string | null;
}
export interface OpcaoNfe {
  readonly id: number;
  readonly rotulo: string;
  readonly ncm?: string;
}
export interface ApoioNotaMercadoria {
  readonly destino: 'simulador' | 'sefaz';
  readonly naturezas: readonly NaturezaNfeTela[];
  readonly devolucoes: readonly DevolucaoSemNota[];
  readonly fornecedores: readonly OpcaoNfe[];
  readonly clientes: readonly OpcaoNfe[];
  readonly motivos: readonly OpcaoNfe[];
  readonly insumos: readonly OpcaoNfe[];
}
export interface NotaMercadoriaTela {
  readonly nota: number;
  readonly numero: number;
  readonly serie: string;
  readonly situacao: string;
  readonly homologacao: boolean;
  readonly chave: string | null;
  readonly protocolo: string | null;
  readonly emissao: string | null;
  readonly autorizadaEm: string | null;
  readonly valorTotal: number;
  readonly devolucao: number | null;
  readonly natureza: string;
  readonly naturezaDescricao: string;
  readonly cfop: string;
  readonly destinatario: string;
  readonly cartasCorrecao: number;
  readonly retorno: string | null;
}
export interface HistoricoNotaMercadoria {
  readonly nota: NotaMercadoriaTela;
  readonly itens: readonly {
    readonly sequencia: number;
    readonly codigo: string;
    readonly descricao: string;
    readonly ncm: string;
    readonly cfop: string;
    readonly unidade: string;
    readonly quantidade: number;
    readonly valorUnitario: number;
    readonly desconto: number;
    readonly valorTotal: number;
    readonly lote: string | null;
    readonly validade: string | null;
    readonly cstIcms: string;
  }[];
  readonly eventos: readonly {
    readonly tipo: string;
    readonly sequencia: number;
    readonly protocolo: string | null;
    readonly codigo: string | null;
    readonly mensagem: string | null;
    readonly texto: string | null;
    readonly em: string | null;
  }[];
  readonly referencias: readonly { readonly tipo: string; readonly chave: string }[];
}
export interface ItemEmissaoNfe {
  readonly insumo: number;
  readonly quantidade: number;
  readonly valorUnitario: number;
  readonly desconto?: number;
  readonly lote?: string | null;
}
export type EmissaoNfe =
  | { readonly origem: 'devolucao_fornecedor'; readonly devolucao: number }
  | {
      readonly origem: 'conserto' | 'avulsa';
      readonly natureza?: string | null;
      readonly fornecedor?: number | null;
      readonly cliente?: number | null;
      readonly itens: readonly ItemEmissaoNfe[];
      readonly tributos: {
        readonly cstIcms: string;
        readonly aliquotaIcms: number;
        readonly aliquotaIpi: number;
      };
      readonly valorFrete: number;
      readonly informacaoComplementar?: string | null;
    };

const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoFinanceiro>();

export const lerApoioNotaMercadoria = (): Promise<ApoioNotaMercadoria> =>
  ler(`${P}/apoio`, confiar<ApoioNotaMercadoria>());
export const lerNotasMercadoria = (situacao: string | null): Promise<NotaMercadoriaTela[]> =>
  ler(`${P}${qs({ situacao })}`, z.array(confiar<NotaMercadoriaTela>()));
export const lerHistoricoNotaMercadoria = (nota: number): Promise<HistoricoNotaMercadoria> =>
  ler(`${P}/${nota}/historico`, confiar<HistoricoNotaMercadoria>());
export const lerDanfeNotaMercadoria = (nota: number): Promise<{ html: string }> =>
  ler(`${P}/${nota}/danfe`, confiar<{ html: string }>());

/** Emite a NF-e (da devolução ao fornecedor com um clique, ou o conserto e a saída avulsa montados na tela). */
export const emitirNotaMercadoria = (e: EmissaoNfe, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(P, e, resultado, chave);
/** Cancela a nota autorizada (motivo do cadastro e justificativa); ela fica no histórico. */
export const cancelarNotaMercadoria = (
  nota: number,
  motivo: number,
  justificativa: string,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/${nota}/cancelar`, { motivo, justificativa }, resultado, chave);
/** Carta de correção (evento com sequência; a última substitui as anteriores). */
export const corrigirNotaMercadoria = (
  nota: number,
  texto: string,
  chave: string,
): Promise<ResultadoFinanceiro> => enviar(`${P}/${nota}/corrigir`, { texto }, resultado, chave);
