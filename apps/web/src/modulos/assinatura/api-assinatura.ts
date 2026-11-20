// Cliente das telas da assinatura ICP-Brasil, etapa 1 (M49): Meu certificado (vincular em nuvem pelo provedor ou a
// parte pública do A1/A3, desvincular e a assinatura de conferência), a política por tipo de documento e os provedores
// em nuvem (o segredo vai ao cofre e nunca volta). As gravações levam o CSRF; Problem Details viram ErroApi.
import type {
  PainelVerificador,
  VerificacaoPublica,
  LoteIcpPreparado,
  PedidoAssinaturaIcpResposta,
  PendenciasIcpResposta,
  PreviaIcp,
  SituacaoAssinaturaDocumento,
  AutorizacaoPsc,
  CertificadoVinculadoResumo,
  DesafioAgenteLocal,
  MeuCertificadoResposta,
  PoliticasAssinaturaResposta,
  ProvedoresPscResposta,
  ResultadoFluxoAssinatura,
  TesteConexaoProvedor,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { ler } from '../exames/api-exames.js';

const D = '/api/documento';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

async function enviar<X>(metodo: 'POST' | 'PUT', url: string, corpo: unknown): Promise<X> {
  const r = await fetch(url, {
    method: metodo,
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-csrf': tokenCsrf() },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return confiar<X>().parse(await r.json());
}

export const lerMeuCertificado = () => ler(`${D}/certificados`, confiar<MeuCertificadoResposta>());
export const vincularArquivo = (midia: 'a1' | 'a3', certificado: string) =>
  enviar<CertificadoVinculadoResumo>('POST', `${D}/certificados`, { midia, provedor: null, certificado });
export const vincularNuvem = (provedor: string) =>
  enviar<AutorizacaoPsc>('POST', `${D}/certificados/nuvem`, { provedor });
export const desvincular = (id: number) =>
  enviar<CertificadoVinculadoResumo>('POST', `${D}/certificados/${id}/desvincular`, {});
export const testarAssinatura = (id: number) =>
  enviar<AutorizacaoPsc | DesafioAgenteLocal>('POST', `${D}/certificados/${id}/teste`, {});
export const responderAgente = (corpo: unknown) =>
  enviar<ResultadoFluxoAssinatura>('POST', `${D}/assinatura/agente`, corpo);

export const lerPoliticas = () => ler(`${D}/assinatura/politica`, confiar<PoliticasAssinaturaResposta>());
export const definirPolitica = (corpo: unknown) =>
  enviar<PoliticasAssinaturaResposta>('PUT', `${D}/assinatura/politica`, corpo);
export const removerPolitica = (corpo: unknown) =>
  enviar<PoliticasAssinaturaResposta>('POST', `${D}/assinatura/politica/remocao`, corpo);

export const lerProvedores = () => ler(`${D}/assinatura/provedores`, confiar<ProvedoresPscResposta>());
export const salvarProvedor = (corpo: unknown) =>
  enviar<ProvedoresPscResposta>('PUT', `${D}/assinatura/provedores`, corpo);
export const definirSegredo = (codigo: string, corpo: unknown) =>
  enviar<ProvedoresPscResposta>(
    'PUT',
    `${D}/assinatura/provedores/${encodeURIComponent(codigo)}/segredo`,
    corpo,
  );
export const testarProvedor = (codigo: string) =>
  enviar<TesteConexaoProvedor>('POST', `${D}/assinatura/provedores/${encodeURIComponent(codigo)}/teste`, {});

/** Parte pública do certificado em base64 a partir do arquivo (DER ou PEM); null se não parece certificado. */
export function certificadoDoArquivo(bytes: Uint8Array): string | null {
  const texto = new TextDecoder('latin1').decode(bytes);
  if (texto.includes('PRIVATE KEY')) return null;
  const pem = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(texto);
  if (pem) return pem[1]!.replace(/\s+/g, '');
  // DER: começa por SEQUENCE (0x30) com tamanho longo.
  if (bytes[0] !== 0x30 || bytes.length < 64 || bytes.length > 16_384) return null;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** O agente local (A1/A3) assina o desafio neste computador; a chave nunca sai dele. */
export async function assinarNoAgente(
  endereco: string,
  d: DesafioAgenteLocal,
): Promise<{ assinaturas: { hash: string; assinatura: string }[]; certificado: string }> {
  const r = await fetch(`${endereco.replace(/\/+$/, '')}/assinar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ desafio: d.desafio, hashes: d.hashes, algoritmo: d.algoritmo }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error('agente');
  return (await r.json()) as { assinaturas: { hash: string; assinatura: string }[]; certificado: string };
}

// ── M49, etapa 2: assinar os documentos emitidos (um ou o lote), pendências, reprocessamento e PDF assinado ──

export const lerFilaIcp = () => ler(`${D}/assinatura/documentos`, confiar<PendenciasIcpResposta>());
export const gerarPrevia = (documento: number, certificado: number) =>
  enviar<PreviaIcp>('POST', `${D}/assinatura/documentos/${documento}/previa`, { certificado });
export const enderecoPdfPrevia = (documento: number) => `${D}/assinatura/documentos/${documento}/previa.pdf`;
export const prepararLote = (documentos: readonly number[], certificado: number) =>
  enviar<LoteIcpPreparado>('POST', `${D}/assinatura/lote/preparar`, { documentos, certificado });
export const pedirAssinatura = (corpo: { documentos: number[]; hashes: string[]; certificado: number }) =>
  enviar<PedidoAssinaturaIcpResposta>('POST', `${D}/assinatura/documentos`, corpo);
export const reprocessarAssinatura = (assinatura: number, direcaoTecnica = false) =>
  enviar<SituacaoAssinaturaDocumento>(
    'POST',
    direcaoTecnica
      ? `${D}/assinatura/estabelecimento/${assinatura}/reprocessar`
      : `${D}/assinatura/assinaturas/${assinatura}/reprocessar`,
    {},
  );
export const enderecoPdfAssinado = (assinatura: number) => `${D}/assinatura/assinaturas/${assinatura}/pdf`;
export const marcarAvisos = (avisos: readonly number[], direcaoTecnica = false) =>
  enviar<{ lidos: number }>(
    'POST',
    direcaoTecnica ? `${D}/assinatura/estabelecimento/avisos/lidos` : `${D}/assinatura/avisos/lidos`,
    { avisos },
  );

// ── M49, etapa 3: verificador público (sem login) e o painel interno das consultas ──

/** A consulta pública pelo código do QR (sem sessão; o servidor limita a taxa por origem). */
export async function verificarDocumento(
  codigo: string,
  buscar: typeof fetch = fetch,
): Promise<VerificacaoPublica> {
  const r = await buscar(`/api/publico/verificar/${encodeURIComponent(codigo)}`, {
    headers: { accept: 'application/json' },
    credentials: 'omit',
  });
  if (!r.ok) throw await erroDaResposta(r);
  return confiar<VerificacaoPublica>().parse(await r.json());
}

export const lerPainelVerificador = () => ler(`${D}/verificador/painel`, confiar<PainelVerificador>());

/** SHA-256 do arquivo, em hexadecimal, calculado no navegador (o arquivo não sai do computador). */
export async function sha256DoArquivo(f: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
