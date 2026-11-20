// Cliente da digitalização certificada (M50, etapa 6), validado pelos contratos. As gravações vão com o CSRF e a
// Idempotency-Key; o PDF vai em base64 com o SHA-256 calculado aqui (o servidor recalcula e confere). Problem Details
// viram ErroApi e o código da recusa (ex.: ja-digitalizado, resolucao-baixa, mesma-pessoa) fica em `problema.codigo`.
import {
  type AssinarDigitalizacaoEntrada,
  type AutorizacaoPsc,
  type ConferirDigitalizacaoEntrada,
  type DesafioAgenteLocal,
  type DigitalizarDocumentoEntrada,
  esquemaFilaDigitalizacao,
  esquemaGravacaoDigitalizacao,
  esquemaPacienteDigitalizacao,
  esquemaResultadoDigitalizacao,
  type FilaDigitalizacao,
  type GravacaoDigitalizacao,
  type PacienteDigitalizacao,
  type ResultadoDigitalizacao,
  type SituacaoDigitalizacao,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const D = '/api/digitalizacao';

let sequencia = 0;
export function novaChaveDigitalizacao(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m506d.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

export const lerGravacaoDigitalizacao = (): Promise<GravacaoDigitalizacao> =>
  ler(`${D}/gravacao`, esquemaGravacaoDigitalizacao);
export const lerFilaDigitalizacao = (situacao: SituacaoDigitalizacao | null): Promise<FilaDigitalizacao> =>
  ler(`${D}/fila${qs({ situacao })}`, esquemaFilaDigitalizacao);
export const lerPacienteDigitalizacao = (prontuario: number): Promise<PacienteDigitalizacao> =>
  ler(`${D}/pacientes/${prontuario}`, esquemaPacienteDigitalizacao);
export const enderecoArquivo = (id: number) => `${D}/${id}/arquivo`;
export const digitalizar = (e: DigitalizarDocumentoEntrada, chave: string): Promise<ResultadoDigitalizacao> =>
  enviar(D, e, esquemaResultadoDigitalizacao, chave);
export const conferir = (e: ConferirDigitalizacaoEntrada, chave: string): Promise<ResultadoDigitalizacao> =>
  enviar(`${D}/${e.id}/conferencia`, e, esquemaResultadoDigitalizacao, chave);
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
export const pedirAssinaturaDigitalizacao = (
  e: AssinarDigitalizacaoEntrada,
  chave: string,
): Promise<AutorizacaoPsc | DesafioAgenteLocal> =>
  enviar(`${D}/assinatura`, e, confiar<AutorizacaoPsc | DesafioAgenteLocal>(), chave);

/** O SHA-256 em hexadecimal (Web Crypto) e o base64 do arquivo escolhido. */
export async function lerArquivo(f: Blob): Promise<{ base64: string; hash: string; bytes: number }> {
  const buf = new Uint8Array(await f.arrayBuffer());
  const resumo = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  const hash = [...resumo].map((b) => b.toString(16).padStart(2, '0')).join('');
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(s), hash, bytes: buf.length };
}
