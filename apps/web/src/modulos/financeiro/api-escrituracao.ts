// F3.8, 07-FIN linha 108: a escrituração fiscal das entradas e a EFD-Contribuições (escrituracao-efd.controller.ts).
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type {
  ApuracaoReceitas,
  ConferenciaEfd,
  ItemEfd,
  PendenciaFiscal,
  RegimeEfd,
} from '@sgh/dominio-financeiro';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/fiscal/escrituracao';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export interface ItemEscrituracao extends ItemEfd {
  readonly pendencias: readonly PendenciaFiscal[];
}
export interface EntradaEscrituracao {
  readonly id: number;
  readonly versao: number;
  readonly servico: boolean;
  readonly participanteDocumento: string;
  readonly participanteNome: string;
  readonly modelo: string;
  readonly serie: string | null;
  readonly numero: string;
  readonly dataEmissao: string;
  readonly dataEntrada: string;
  readonly situacaoDocumento: string;
  readonly situacao: string;
  readonly valorDocumento: number;
  readonly valorPis: number;
  readonly valorCofins: number;
  readonly itens: readonly ItemEscrituracao[];
  readonly pendencias: number;
}
export interface ArquivoEfd {
  readonly id: number;
  readonly sequencia: number;
  readonly finalidade: 'original' | 'retificadora';
  readonly regime: RegimeEfd;
  readonly situacao: string;
  readonly recibo: string | null;
  readonly geradoEm: string | null;
  readonly entregueEm: string | null;
  readonly confere: boolean;
  /** O texto gerado está guardado: o entregue continua baixável depois de uma correção. */
  readonly guardado: boolean;
}
export interface PainelEscrituracao {
  readonly periodo: string;
  readonly entradas: readonly EntradaEscrituracao[];
  readonly conferencia: ConferenciaEfd;
  /** A receita das notas de serviço da competência e a contribuição apurada, por regime. */
  readonly receitas: { readonly cumulativo: ApuracaoReceitas; readonly naoCumulativo: ApuracaoReceitas };
  readonly arquivos: readonly ArquivoEfd[];
  readonly cfops: readonly { codigo: string; descricao: string }[];
  readonly naturezas: readonly string[];
}

export const lerEscrituracao = (periodo: string) =>
  ler(`${P}${qs({ periodo })}`, confiar<PainelEscrituracao>());
export const classificarEntrada = (id: number, corpo: unknown, chave: string) =>
  enviar(`${P}/entradas/${id}/classificacao`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const gerarEfdContribuicoes = (corpo: { periodo: string; regime: RegimeEfd }, chave: string) =>
  enviar(`${P}/efd-contribuicoes`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const registrarEntregaEfd = (id: number, recibo: string, chave: string) =>
  enviar(`${P}/efd-contribuicoes/${id}/entrega`, { recibo }, confiar<ResultadoFinanceiro>(), chave);
export const lerArquivoEfd = (id: number) =>
  ler(`${P}/efd-contribuicoes/${id}/arquivo`, confiar<{ nome: string; conteudo: string }>());
