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
}
export interface SaldoACompensar {
  readonly tributo: string;
  readonly tributoId: number;
  readonly retido: number;
  readonly compensado: number;
  readonly aCompensar: number;
  readonly desde: string | null;
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
export const buscarMunicipiosRetencao = (termo: string) =>
  ler(`${P}/municipios${qs({ termo })}`, z.array(confiar<MunicipioEncontrado>()));
