// Cliente das telas do repasse médico (M33): regras e simulador, versões e aprovação, apuração e demonstrativo,
// lançamentos (ajuste e estorno por glosa), RPA (prévia com as retenções e emissão) e o extrato do próprio médico. As
// gravações vão com o CSRF e a Idempotency-Key (uma por intenção de gravar); Problem Details viram ErroApi e a recusa
// de negócio traz o texto em português do servidor.
import type {
  ApoioRepasse,
  ApuracaoResposta,
  ContaDoMedicoResposta,
  DemonstrativoResposta,
  ExtratoRepasseResposta,
  IndicadorRepasse,
  LancamentoRepasseResposta,
  ListaRegrasRepasse,
  PendentesApuracaoResposta,
  PrestadorRepasseResposta,
  PreviaRpaResposta,
  ResultadoRepasse,
  RpaResposta,
  SimulacaoRepasseResposta,
  VersaoRegraResposta,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const R = '/api/repasse';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const lista = <X>() => z.array(confiar<X>());

let sequencia = 0;
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m33.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}
const gravar = <X = ResultadoRepasse>(url: string, corpo: unknown, chave: string): Promise<X> =>
  enviar(url, corpo, confiar<X>(), chave);

export const lerApoio = () => ler(`${R}/apoio`, confiar<ApoioRepasse>());
export const lerIndicadores = () => ler(`${R}/indicadores`, lista<IndicadorRepasse>());
export const lerRegras = (f: {
  convenio: number;
  data: string;
  procedimento?: number | undefined;
  profissional?: number | undefined;
  depoisDe?: number | undefined;
}) => ler(`${R}/regras${qs(f)}`, confiar<ListaRegrasRepasse>());
export const buscarPrestadores = (termo: string) =>
  ler(`${R}/prestadores${qs({ termo })}`, lista<PrestadorRepasseResposta>());
export const lerVersoes = () => ler(`${R}/regras/versoes`, lista<VersaoRegraResposta>());
export const proporRegra = (corpo: unknown, chave: string) => gravar(`${R}/regras/versoes`, corpo, chave);
export const decidirRegra = (versao: number, corpo: unknown, chave: string) =>
  gravar(`${R}/regras/versoes/${versao}/decisao`, corpo, chave);
export const simular = (corpo: unknown, chave: string) =>
  gravar<SimulacaoRepasseResposta>(`${R}/regras/simular`, corpo, chave);
export const lerApuracao = (empresa: number, competencia: string) =>
  ler(`${R}/apuracoes${qs({ empresa, competencia })}`, confiar<ApuracaoResposta>());
export const apurar = (corpo: unknown, chave: string) => gravar(`${R}/apuracoes`, corpo, chave);
export const decidirApuracao = (id: number, corpo: unknown, chave: string) =>
  gravar(`${R}/apuracoes/${id}/decisao`, corpo, chave);
export const lancarApuracao = (id: number, evento: number, chave: string) =>
  gravar(`${R}/apuracoes/${id}/lancamentos`, { evento }, chave);
export const lerPendentes = (id: number, f: { motivo?: string; pagina: number; tamanho: number }) =>
  ler(`${R}/apuracoes/${id}/pendentes${qs(f)}`, confiar<PendentesApuracaoResposta>());
export const lerDemonstrativo = (id: number, prestador: number) =>
  ler(`${R}/apuracoes/${id}/demonstrativo/${prestador}`, confiar<DemonstrativoResposta>());
export const urlDemonstrativoPdf = (id: number, prestador: number) =>
  `${R}/apuracoes/${id}/demonstrativo/${prestador}/pdf`;
export const lerLancamentos = (competencia: string, prestador?: number) =>
  ler(`${R}/lancamentos${qs({ empresa: 1, competencia, prestador })}`, lista<LancamentoRepasseResposta>());
export const lancar = (corpo: unknown, chave: string) => gravar(`${R}/lancamentos`, corpo, chave);
export const lerRpas = (competencia: string) =>
  ler(`${R}/rpas${qs({ empresa: 1, competencia })}`, lista<RpaResposta>());
export const previaRpa = (corpo: unknown, chave: string) =>
  gravar<PreviaRpaResposta>(`${R}/rpas/previa`, corpo, chave);
export const emitirRpa = (corpo: unknown, chave: string) => gravar(`${R}/rpas`, corpo, chave);
export const urlRpaPdf = (id: number) => `${R}/rpas/${id}/pdf`;
export const lerExtrato = (competencia?: string) =>
  ler(`${R}/meu-extrato${qs({ competencia: competencia || undefined })}`, confiar<ExtratoRepasseResposta>());
export const lerContaDoMedico = (competencia: string) =>
  ler(`${R}/meu-extrato/conta${qs({ competencia })}`, confiar<ContaDoMedicoResposta>());
