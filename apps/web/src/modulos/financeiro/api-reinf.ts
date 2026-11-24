// F3.8, 07-FIN linha 111: a EFD-REINF por evento (reinf-eventos.controller.ts): competência, beneficiário, processo
// com suspensão, transmissão ao simulador e retorno.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/reinf';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export interface EventoReinfTela {
  readonly id: number;
  readonly evento: string;
  readonly acao: string;
  readonly situacao: string;
  readonly recibo: string | null;
  readonly retifica: number | null;
  readonly beneficiario: string;
  readonly valorBruto: number;
  readonly valorRetido: number;
  readonly valorSuspenso: number;
  readonly documentos: number;
  readonly processos: number;
  readonly retornos: number;
  readonly lote: number | null;
  readonly protocolo: string | null;
  readonly mensagem: string | null;
}
export interface ProcessoReinfTela {
  readonly id: number;
  readonly tipo: string;
  readonly numero: string;
  readonly indicativo: string;
  readonly tributo: string;
  readonly beneficiario: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly situacao: string;
}
export interface PainelReinf {
  readonly periodo: string;
  readonly eventos: readonly EventoReinfTela[];
  readonly processos: readonly ProcessoReinfTela[];
}

export const lerPainelReinf = (periodo: string) =>
  ler(`${P}/painel${qs({ periodo })}`, confiar<PainelReinf>());
export const lerXmlReinf = (id: number) => ler(`${P}/eventos/${id}/xml`, confiar<{ xml: string }>());
export const gravarProcessoReinf = (corpo: unknown, chave: string) =>
  enviar(`${P}/processos`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const gerarEventosReinf = (corpo: unknown, chave: string) =>
  enviar(`${P}/gerar`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const transmitirReinf = (corpo: unknown, chave: string) =>
  enviar(`${P}/transmitir`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const registrarRetornoReinf = (corpo: unknown, chave: string) =>
  enviar(`${P}/retorno`, corpo, confiar<ResultadoFinanceiro>(), chave);
