// F3.8, 07-FIN linha 113: o ciclo da nota de serviço (nota-servico.controller.ts): notas do estabelecimento, apoio
// (faturas sem nota, motivos do catálogo e prazos do município), lote, cancelamento, substituição e histórico.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/fiscal/notas-servico';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export interface NotaServico {
  readonly id: number;
  readonly rps: number;
  readonly numero: string | null;
  readonly emitidaEm: string | null;
  readonly tituloReceber: number | null;
  readonly tituloNumero: string | null;
  readonly conta: number | null;
  readonly tomador: string;
  readonly valorServicos: number;
  readonly valorDeducoes: number;
  readonly baseCalculo: number;
  readonly aliquotaIss: number;
  readonly valorIss: number;
  readonly issRetido: boolean;
  readonly valorLiquido: number;
  readonly situacao: string;
  readonly lote: number | null;
  readonly substitui: number | null;
  readonly substituta: number | null;
}
export interface FaturaSemNota {
  readonly titulo: number;
  readonly numero: string;
  readonly documento: string;
  readonly emissao: string;
  readonly valor: number;
  readonly devedor: string;
}
export interface MotivoNotaServico {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly justificativaPadrao: string | null;
}
export interface ApoioNotaServico {
  readonly destino: 'simulador' | 'prefeitura';
  readonly parametros: {
    readonly municipio: { readonly ibge: string; readonly nome: string } | null;
    readonly aliquota: number | null;
    readonly issRetido: boolean;
    readonly prazoCancelamentoDias: number;
    readonly prazoSubstituicaoDias: number;
    readonly prazoPadrao: boolean;
    readonly temRegra: boolean;
  };
  readonly motivos: readonly MotivoNotaServico[];
  readonly faturas: readonly FaturaSemNota[];
}
export interface HistoricoNotaServico {
  readonly nota: number;
  readonly numero: string | null;
  readonly situacao: string;
  readonly eventos: readonly {
    readonly id: number;
    readonly tipo: string;
    readonly em: string | null;
    readonly protocolo: string | null;
    readonly motivo: string | null;
    readonly justificativa: string | null;
    readonly substituta: number | null;
    readonly usuario: string | null;
  }[];
  readonly deducoes: readonly {
    readonly sequencia: number;
    readonly tipo: string;
    readonly descricao: string;
    readonly valor: number;
    readonly documento: string | null;
  }[];
  readonly tributos: readonly {
    readonly tributo: string;
    readonly retido: boolean;
    readonly base: number;
    readonly aliquota: number;
    readonly valor: number;
  }[];
}

export const listarNotasServico = (situacao: string | null = null) =>
  ler(`${P}${qs({ situacao })}`, z.array(confiar<NotaServico>()));
export const lerApoioNotaServico = () => ler(`${P}/apoio`, confiar<ApoioNotaServico>());
export const lerHistoricoNotaServico = (nota: number) =>
  ler(`${P}/${nota}/historico`, confiar<HistoricoNotaServico>());
export const emitirLoteNotasServico = (notas: readonly unknown[], chave: string) =>
  enviar(`${P}/lote`, { notas }, confiar<ResultadoFinanceiro>(), chave);
export const cancelarNotaServico = (nota: number, corpo: unknown, chave: string) =>
  enviar(`${P}/${nota}/cancelar`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const substituirNotaServico = (nota: number, corpo: unknown, chave: string) =>
  enviar(`${P}/${nota}/substituir`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const definirPrazoNotaServico = (corpo: unknown, chave: string) =>
  enviar(`${P}/prazo`, corpo, confiar<ResultadoFinanceiro>(), chave);
