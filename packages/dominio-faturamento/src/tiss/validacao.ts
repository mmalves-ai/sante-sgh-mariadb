// Validação da mensagem no XSD oficial 04.03.00 pelo libxml2 (xmllint compilado para WebAssembly; sem rede,
// sem instalação no sistema). O XSD é versionado com SHA-256 (xsd/04.03.00/SHA256SUMS): arquivo alterado ou
// faltando recusa a validação. Lote só é "pronto" depois de válido e com o hash do epílogo conferido.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateXML } from 'xmllint-wasm';
import { conferirHashEpilogo, type MensagemTiss, PADRAO_TISS, VERSAO_TISS } from './lote.js';

export const PASTA_XSD = new URL('./xsd/04.03.00/', import.meta.url);

/**
 * M31: a pasta do XSD quando o código roda empacotado (a API num arquivo só: o XSD vai ao lado do main.js, copiado no
 * build), com TISS_XSD_PASTA para a implantação e a pasta do código-fonte no repositório como último recurso.
 */
export function pastaXsd(): URL {
  const candidatos = [
    PASTA_XSD,
    ...(process.env['TISS_XSD_PASTA'] ? [pathToFileURL(`${resolve(process.env['TISS_XSD_PASTA'])}/`)] : []),
    ...(process.argv[1] ? [pathToFileURL(`${resolve(dirname(process.argv[1]), 'xsd/04.03.00')}/`)] : []),
    pathToFileURL(`${resolve(process.cwd(), 'packages/dominio-faturamento/src/tiss/xsd/04.03.00')}/`),
  ];
  return candidatos.find((u) => existsSync(new URL('SHA256SUMS', u))) ?? PASTA_XSD;
}
export const XSD_RAIZ = 'tissV4_03_00.xsd';

export interface ArquivoEsquema {
  readonly fileName: string;
  readonly contents: Uint8Array;
}

export class ErroEsquemaTiss extends Error {
  override readonly name = 'ErroEsquemaTiss';
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lê os XSD da pasta e confere cada um contra o SHA256SUMS versionado. */
export async function carregarEsquemas(pasta: URL = pastaXsd()): Promise<ArquivoEsquema[]> {
  const manifesto = readFileSync(new URL('SHA256SUMS', pasta), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(l);
      if (!m) throw new ErroEsquemaTiss(`Linha inválida no SHA256SUMS: ${l}`);
      return { hash: m[1]!, arquivo: m[2]! };
    });
  if (!manifesto.some((m) => m.arquivo === XSD_RAIZ))
    throw new ErroEsquemaTiss(`${XSD_RAIZ} fora do SHA256SUMS.`);
  const arquivos: ArquivoEsquema[] = [];
  for (const { hash, arquivo } of manifesto) {
    const contents = new Uint8Array(readFileSync(new URL(arquivo, pasta)));
    const atual = await sha256Hex(contents);
    if (atual !== hash)
      throw new ErroEsquemaTiss(`XSD ${arquivo} alterado (SHA-256 não confere com o SHA256SUMS).`);
    arquivos.push({ fileName: arquivo, contents });
  }
  return arquivos;
}

export interface ResultadoValidacao {
  readonly valido: boolean;
  readonly erros: readonly string[];
}

/** Valida bytes ISO-8859-1 da mensagem no XSD raiz 04.03.00 (os demais entram por include/import). */
export async function validarNoXsd(
  bytes: Uint8Array,
  esquemas: readonly ArquivoEsquema[],
): Promise<ResultadoValidacao> {
  const raiz = esquemas.find((e) => e.fileName === XSD_RAIZ);
  if (!raiz) throw new ErroEsquemaTiss(`Esquema raiz ${XSD_RAIZ} ausente.`);
  const r = await validateXML({
    xml: [{ fileName: 'mensagem.xml', contents: bytes }],
    schema: [raiz],
    preload: esquemas.filter((e) => e !== raiz),
    // Sem rede: o DTD citado pelo xmldsig-core-schema.xsd nunca é baixado.
    modifyArguments: (args) => ['--nonet', ...args],
  });
  return { valido: r.valid, erros: r.errors.map((e) => e.message.trim()) };
}

export type EstadoLote = 'pronto' | 'invalido';

export interface LoteConferido {
  readonly estado: EstadoLote;
  readonly versao: typeof VERSAO_TISS;
  readonly hash: string;
  readonly erros: readonly string[];
}

/** Decodificação ISO-8859-1 exata: cada byte vira o caractere de mesmo código (0x80–0x9F são controles C1). */
export function iso88591(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 8192)));
  return s;
}

/** "Pronto" só com XSD 04.03.00 válido e hash do epílogo conferido (regra 7 da ficha do M09). */
export async function conferirLote(
  m: MensagemTiss,
  esquemas: readonly ArquivoEsquema[],
): Promise<LoteConferido> {
  const erros: string[] = [];
  if (m.versao !== VERSAO_TISS)
    erros.push(`versão ${String(m.versao)} recusada: só ${VERSAO_TISS} (DP-47.7)`);
  // ISO-8859-1 de verdade, byte a byte: o TextDecoder('latin1') do WHATWG é o windows-1252 e trocaria os
  // bytes 0x80–0x9F (€, aspas curvas…) por caracteres que a mensagem TISS não pode ter.
  const texto = iso88591(m.bytes);
  const padrao = /<ans:Padrao>([^<]*)<\/ans:Padrao>/.exec(texto)?.[1] ?? null;
  // O XSD 04.03.00 ainda aceita 4.00.00 a 4.02.00 em dm_versao: a regra do novo é só 4.03.00.
  if (padrao !== PADRAO_TISS)
    erros.push(`Padrao ${padrao ?? '(ausente)'} recusado: só ${PADRAO_TISS} (DP-47.7)`);
  const v = await validarNoXsd(m.bytes, esquemas);
  erros.push(...v.erros);
  if (!v.valido && v.erros.length === 0) erros.push('XSD recusou a mensagem');
  const h = conferirHashEpilogo(texto);
  if (!h.confere) erros.push('hash do epílogo não confere');
  return { estado: erros.length === 0 ? 'pronto' : 'invalido', versao: VERSAO_TISS, hash: m.hash, erros };
}

/** Nada sai fora de produção (regra 1.10): o envio à operadora só existe em `producao`, no M31. */
export function exigirProducaoParaEnvio(ambiente: string): void {
  if (ambiente !== 'producao') {
    throw new Error(
      `Envio de lote TISS recusado em AMBIENTE=${ambiente || '(vazio)'}: só em produção (regra 1.10).`,
    );
  }
}
