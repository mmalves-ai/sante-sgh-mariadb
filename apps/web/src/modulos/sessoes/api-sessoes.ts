// Cliente da agenda de sessões e recursos (M50, etapa 6), validado pelos contratos. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção de gravar); Problem Details viram ErroApi e o código da recusa (ex.: recurso-ocupado,
// fora-da-faixa-etaria, sessao-futura) fica em `problema.codigo`.
import {
  type AgendarSessaoEntrada,
  type AtualizarSessaoEntrada,
  esquemaGradeSessoes,
  esquemaGravacaoSessoes,
  esquemaPreviaSerieSessoes,
  esquemaResultadoSessao,
  esquemaSessoesDoPaciente,
  type GradeSessoes,
  type GravacaoSessoes,
  type PreviaSerieSessoes,
  type ResultadoSessao,
  type SessoesDoPaciente,
} from '@sgh/contratos';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const S = '/api/sessoes';

let sequencia = 0;
export function novaChaveSessao(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m506s.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

export const lerGravacaoSessoes = (): Promise<GravacaoSessoes> =>
  ler(`${S}/gravacao`, esquemaGravacaoSessoes);
export const lerGradeSessoes = (
  de: string | null,
  dias: number,
  agenda: number | null,
): Promise<GradeSessoes> => ler(`${S}/grade${qs({ de, dias, agenda })}`, esquemaGradeSessoes);
export const lerSessoesDoPaciente = (paciente: number): Promise<SessoesDoPaciente> =>
  ler(`${S}/pacientes/${paciente}`, esquemaSessoesDoPaciente);
export const previaSerie = (e: AgendarSessaoEntrada, chave: string): Promise<PreviaSerieSessoes> =>
  enviar(`${S}/previa`, e, esquemaPreviaSerieSessoes, chave);
export const agendarSerie = (e: AgendarSessaoEntrada, chave: string): Promise<ResultadoSessao> =>
  enviar(S, e, esquemaResultadoSessao, chave);
export const atualizarSessao = (e: AtualizarSessaoEntrada, chave: string): Promise<ResultadoSessao> =>
  enviar(`${S}/${e.sessao}/situacao`, e, esquemaResultadoSessao, chave);
