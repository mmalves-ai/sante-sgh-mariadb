// F3.8, 07-FIN linhas 100 e 109: o de-para contábil por evento e as retenções na fonte (contabil-fiscal.controller.ts).
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/contabil-fiscal';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export type Lado = 'debito' | 'credito' | 'ambos';
export interface RegraDePara {
  readonly id: number;
  readonly evento: string;
  readonly lado: Lado;
  readonly natureza: number | null;
  readonly conta: string;
  readonly ativo: boolean;
  readonly versao: number;
}
export interface DeParaCompleto {
  readonly eventos: readonly { codigo: string; descricao: string }[];
  readonly regras: readonly RegraDePara[];
  readonly naturezas: readonly { id: number; codigo: string; descricao: string }[];
  readonly centros: readonly { id: number; codigo: string; nome: string; externo: string | null }[];
  readonly credores: readonly { id: number; externo: string }[];
}
export interface FaltaDePara {
  readonly evento: string;
  readonly natureza: number | null;
  readonly lado: 'debito' | 'credito';
  readonly fatos: number;
}
export interface RegraRetencao {
  readonly id: number;
  readonly tributoId: number;
  readonly tributo: string;
  readonly descricao: string;
  readonly momento: string;
  readonly participante: string;
  readonly municipio: number | null;
  readonly aliquota: number;
  readonly percentualBase: number;
  readonly minimo: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly codigoReceita: string | null;
}
export interface RetidoEmAberto {
  readonly tributo: number;
  readonly sigla: string;
  readonly codigoReceita: string | null;
  readonly retencoes: number;
  readonly valor: number;
}

export const lerDeParaCompleto = () => ler(`${P}/de-para`, confiar<DeParaCompleto>());
export const lerSemDePara = (periodo: string, regua: string) =>
  ler(`${P}/sem-de-para${qs({ periodo, regua })}`, z.array(confiar<FaltaDePara>()));
export const gravarDePara = (corpo: unknown, chave: string) =>
  enviar(`${P}/de-para`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const lerRegrasRetencao = () => ler(`${P}/retencao/regras`, z.array(confiar<RegraRetencao>()));
export const gravarRegraRetencao = (corpo: unknown, chave: string) =>
  enviar(`${P}/retencao/regras`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const lerRetidoEmAberto = (competencia: string) =>
  ler(`${P}/retencao/em-aberto${qs({ competencia })}`, z.array(confiar<RetidoEmAberto>()));
export const gerarRecolhimento = (corpo: unknown, chave: string) =>
  enviar(`${P}/retencao/recolhimento`, corpo, confiar<ResultadoFinanceiro>(), chave);
