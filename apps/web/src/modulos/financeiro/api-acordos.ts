// Cliente das telas da F3.8, 07-FIN linha 76: acordos de renegociação de títulos a receber e baixa dos títulos pelo
// demonstrativo de pagamento importado da operadora.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const P = '/api/financeiro/receber';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const lista = <X>() => z.custom<X[]>((v) => Array.isArray(v));

export type SituacaoAcordo = 'proposta' | 'aceita' | 'efetivada' | 'quebrada' | 'cancelada';
export interface Acordo {
  readonly id: number;
  readonly numero: string;
  readonly em: string;
  readonly situacao: SituacaoAcordo;
  readonly devedor: string;
  readonly responsavel: string;
  readonly valorOriginal: number;
  readonly juros: number;
  readonly multa: number;
  readonly desconto: number;
  readonly valorRenegociado: number;
  readonly parcelas: number;
  readonly primeiroVencimento: string;
  readonly observacao: string;
  readonly titulo: number | null;
  readonly numeroTitulo: string;
  readonly recebido: number;
  readonly parcelasOriginais: number;
}
export interface DetalheAcordo {
  readonly id: number;
  readonly originais: readonly {
    parcela: number;
    titulo: number;
    numeroTitulo: string;
    documento: string;
    sequencia: number;
    vencimento: string;
    valor: number;
    saldoLevado: number;
    juros: number;
    multa: number;
    desconto: number;
    situacao: string;
  }[];
  readonly novas: readonly {
    parcela: number;
    sequencia: number;
    vencimento: string;
    valor: number;
    recebido: number;
    saldo: number;
    situacao: string;
  }[];
}
export interface NovoAcordo {
  titulos: number[];
  juros: number;
  multa: number;
  desconto: number;
  quantidadeParcelas: number;
  primeiroVencimento: string;
  observacao?: string;
}

export const listarAcordos = () => ler(`${P}/acordos`, lista<Acordo>());
export const lerAcordo = (id: number) => ler(`${P}/acordos/${id}`, confiar<DetalheAcordo>());
export const gravarAcordo = (corpo: NovoAcordo, chave: string) =>
  enviar(`${P}/acordos`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const desfazerAcordo = (id: number, motivo: string, chave: string) =>
  enviar(`${P}/acordos/${id}/desfazer`, { motivo }, confiar<ResultadoFinanceiro>(), chave);

export interface DemonstrativoImportado {
  readonly id: number;
  readonly numero: string;
  readonly emissao: string;
  readonly convenio: string;
  readonly situacao: string;
  readonly informado: number;
  readonly liberado: number;
  readonly glosa: number;
  readonly linhas: number;
  readonly baixado: boolean;
}
export interface PreviaBaixaDemonstrativo {
  readonly id: number;
  readonly impedimento: { codigo: string; mensagem: string } | null;
  readonly plano: {
    totalRecebido: number;
    totalGlosa: number;
    linhasSemTitulo: number;
    valorSemTitulo: number;
    titulos: readonly {
      titulo: number;
      numero: string;
      documento: string;
      saldo: number;
      recebido: number;
      glosa: number;
      saldoRestante: number;
      quita: boolean;
      itens: number;
    }[];
  } | null;
}

export const listarDemonstrativosImportados = () =>
  ler(`${P}/demonstrativos-importados`, lista<DemonstrativoImportado>());
export const lerPreviaDaBaixa = (id: number) =>
  ler(`${P}/demonstrativos-importados/${id}/previa`, confiar<PreviaBaixaDemonstrativo>());
export const baixarDemonstrativo = (
  id: number,
  corpo: { conta: number; dataRecebimento: string },
  chave: string,
) => enviar(`${P}/demonstrativos-importados/${id}/baixa`, corpo, confiar<ResultadoFinanceiro>(), chave);
