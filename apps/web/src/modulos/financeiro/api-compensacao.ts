// Cliente da tela de previsão e provisão de pagamentos (F8, 07-FIN linha 68): previsto × realizado por período, a
// previsão (despesa ou receita) com as ocorrências, os títulos que realizam cada ocorrência (a pagar na despesa, a
// receber na receita), estender, cancelar a ocorrência e encerrar a previsão com motivo, e as provisões do passivo.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/compensacao';

export interface OcorrenciaPrevista {
  readonly id: number;
  readonly previsao: number;
  readonly previsaoAtiva: boolean;
  readonly descricao: string;
  readonly tipo: 'despesa' | 'receita';
  readonly competencia: string;
  readonly dataEsperada: string;
  readonly previsto: number;
  readonly situacao: 'aberta' | 'realizada' | 'cancelada';
  readonly realizado: number | null;
  readonly diferenca: number | null;
  readonly titulo: string | null;
  readonly motivoCancelamento: string | null;
}
export interface TituloCandidato {
  readonly id: number;
  readonly lado: 'pagar' | 'receber';
  readonly numero: string;
  readonly data: string;
  readonly valor: number;
}
export interface Provisao {
  readonly id: number;
  readonly tipo: string;
  readonly competencia: string;
  readonly descricao: string;
  readonly conta: string;
  readonly provisionado: number;
  readonly baixado: number;
  readonly revertido: number;
  readonly saldo: number;
  readonly situacao: string;
}
export interface ApoiosPrevisao {
  readonly naturezas: readonly { readonly id: number; readonly rotulo: string; readonly tipo: string }[];
  readonly contas: readonly { readonly id: number; readonly rotulo: string }[];
}
export interface NovaPrevisao {
  readonly descricao: string;
  readonly tipo: 'despesa' | 'receita';
  readonly natureza: number;
  readonly valor: number;
  readonly periodicidade: string;
  readonly diaVencimento?: number;
  readonly dataInicio: string;
  readonly dataFim?: string;
  readonly ajuste: 'antecipar' | 'postergar' | 'manter';
}

const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoFinanceiro>();

export const lerPrevistoRealizado = (f: { de: string; ate: string }): Promise<OcorrenciaPrevista[]> =>
  ler(`${P}/previsoes${qs(f)}`, z.array(confiar<OcorrenciaPrevista>()));
export const lerTitulosParaRealizar = (ocorrencia: number): Promise<TituloCandidato[]> =>
  ler(`${P}/previsoes/titulos${qs({ ocorrencia })}`, z.array(confiar<TituloCandidato>()));
export const lerProvisoes = (): Promise<Provisao[]> => ler(`${P}/provisoes`, z.array(confiar<Provisao>()));
export const lerApoiosPrevisao = (): Promise<ApoiosPrevisao> => ler(`${P}/apoios`, confiar<ApoiosPrevisao>());

export const criarPrevisao = (p: NovaPrevisao, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/previsoes`, p, resultado, chave);
/** A despesa se realiza pelo título a pagar; a receita, pelo título a receber. */
export const realizarOcorrencia = (
  ocorrencia: number,
  titulo: TituloCandidato,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(
    `${P}/previsoes/realizar`,
    titulo.lado === 'receber'
      ? { ocorrencia, tituloReceber: titulo.id }
      : { ocorrencia, tituloPagar: titulo.id },
    resultado,
    chave,
  );
export const estenderPrevisao = (previsao: number, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/previsoes/estender`, { previsao }, resultado, chave);
export const cancelarOcorrencia = (
  ocorrencia: number,
  motivo: string,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/previsoes/ocorrencias/cancelar`, { ocorrencia, motivo }, resultado, chave);
export const encerrarPrevisao = (
  previsao: number,
  data: string,
  motivo: string,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/previsoes/encerrar`, { previsao, data, motivo }, resultado, chave);
