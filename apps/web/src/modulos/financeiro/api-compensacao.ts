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
export interface ItemApoio {
  readonly id: number;
  readonly rotulo: string;
}
export interface ApoiosPrevisao {
  readonly naturezas: readonly { readonly id: number; readonly rotulo: string; readonly tipo: string }[];
  /** Contas contábeis do passivo (provisão). */
  readonly contas: readonly ItemApoio[];
  readonly fornecedores?: readonly ItemApoio[];
  readonly fontesPagadoras?: readonly ItemApoio[];
  readonly centrosCusto?: readonly ItemApoio[];
  readonly contasBancarias?: readonly ItemApoio[];
  readonly profissionais?: readonly ItemApoio[];
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
  /** Despesa: o credor; receita: a fonte pagadora (a realização só aceita título de quem foi escolhido). */
  readonly fornecedor?: number;
  readonly fontePagadora?: number;
  readonly centroCusto?: number;
  readonly contaBancaria?: number;
}
export const TIPOS_PROVISAO = [
  'honorario_medico',
  'tributo',
  'imposto_retido',
  'ferias',
  'decimo_terceiro',
  'contingencia',
  'outro',
] as const;
export interface NovaProvisao {
  readonly tipo: (typeof TIPOS_PROVISAO)[number];
  /** Primeiro dia do mês (AAAA-MM-01). */
  readonly competencia: string;
  readonly descricao: string;
  readonly contaContabil: number;
  readonly valor: number;
  /** Obrigatório no honorário médico. */
  readonly profissional?: number;
  readonly fornecedor?: number;
  readonly centroCusto?: number;
}

const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoFinanceiro>();

export const lerPrevistoRealizado = (f: { de: string; ate: string }): Promise<OcorrenciaPrevista[]> =>
  ler(`${P}/previsoes${qs(f)}`, z.array(confiar<OcorrenciaPrevista>()));
export const lerTitulosParaRealizar = (ocorrencia: number): Promise<TituloCandidato[]> =>
  ler(`${P}/previsoes/titulos${qs({ ocorrencia })}`, z.array(confiar<TituloCandidato>()));
export const lerTitulosParaLiquidar = (provisao: number): Promise<TituloCandidato[]> =>
  ler(`${P}/provisoes/titulos${qs({ provisao })}`, z.array(confiar<TituloCandidato>()));
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

export const criarProvisao = (p: NovaProvisao, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/provisoes`, p, resultado, chave);
/** Liquida (parcial ou total) a provisão pelo título a pagar do mesmo credor. */
export const liquidarProvisao = (
  provisao: number,
  tituloPagar: number,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/provisoes/liquidar`, { provisao, tituloPagar }, resultado, chave);
/** Reverte parte ou todo o saldo, com motivo; o ajuste fica no histórico da provisão. */
export const reverterProvisao = (
  provisao: number,
  valor: number,
  motivo: string,
  data: string,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/provisoes/reverter`, { provisao, valor, motivo, data }, resultado, chave);
