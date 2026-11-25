// F3.8, 07-FIN linha 109: a retenção sofrida no recebimento e o saldo a compensar (retencao-sofrida.controller.ts).
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/retencao-sofrida';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export interface RetencaoSofrida {
  readonly id: number;
  readonly tributoId: number;
  readonly tributo: string;
  readonly base: number;
  readonly aliquota: number;
  readonly valor: number;
  readonly data: string;
  readonly compensada: boolean;
}
export interface SugestaoSofrida {
  readonly tributo: string;
  readonly tributoId: number;
  readonly regra: number;
  readonly base: number;
  readonly aliquota: number;
  readonly valor: number;
  readonly dispensada: boolean;
}
export interface RetencaoSofridaDoTitulo {
  readonly titulo: number;
  readonly versao: string;
  readonly emAberto: boolean;
  readonly valorFatura: number;
  readonly saldoParcela: number;
  readonly retido: number;
  readonly retencoes: readonly RetencaoSofrida[];
  readonly sugestoes: readonly SugestaoSofrida[];
  /** Município do serviço usado na regra do ISS (nota ligada ao título ou o estabelecimento). */
  readonly municipio?: number | null;
  /** Tributos ativos: o tomador pode reter fora da regra e a ficha deixa incluir. */
  readonly tributos?: readonly { readonly id: number; readonly sigla: string; readonly descricao: string }[];
}
export interface SaldoACompensar {
  readonly tributo: string;
  readonly tributoId: number;
  readonly retido: number;
  readonly compensado: number;
  readonly aCompensar: number;
  readonly desde: string | null;
  /** O crédito ainda não compensado, por competência. */
  readonly creditos: readonly { readonly competencia: string; readonly valor: number }[];
}
export interface CompensacaoSofrida {
  readonly id: number;
  readonly numero: string;
  readonly tributoId: number;
  readonly tributo: string;
  readonly competencia: string;
  readonly valor: number;
  readonly retencoes: number;
  readonly em: string;
}
export interface MunicipioEncontrado {
  readonly id: number;
  readonly nome: string;
  readonly uf: string;
}

export const lerRetencaoSofrida = (titulo: number, data: string) =>
  ler(`${P}/titulo/${titulo}${qs({ data })}`, confiar<RetencaoSofridaDoTitulo>());
export const registrarRetencaoSofrida = (corpo: unknown, chave: string) =>
  enviar(`${P}/registrar`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const estornarRetencaoSofrida = (corpo: unknown, chave: string) =>
  enviar(`${P}/estornar`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const lerSaldoACompensar = () => ler(`${P}/saldo`, z.array(confiar<SaldoACompensar>()));
export const compensarRetencaoSofrida = (corpo: unknown, chave: string) =>
  enviar(`${P}/compensar`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const lerCompensacoesSofridas = () => ler(`${P}/compensacoes`, z.array(confiar<CompensacaoSofrida>()));
export const cancelarCompensacaoSofrida = (corpo: unknown, chave: string) =>
  enviar(`${P}/cancelar-compensacao`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const buscarMunicipiosRetencao = (termo: string) =>
  ler(`${P}/municipios${qs({ termo })}`, z.array(confiar<MunicipioEncontrado>()));
