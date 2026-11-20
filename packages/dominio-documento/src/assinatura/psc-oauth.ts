// Conector do provedor de certificado em nuvem (PSC) pelo DOC-ICP-17.01 v3.0 (IN ITI 20/2020), item 6.4 (M49; regras
// 1 e 10; DP-47.13): OAuth 2.0 com PKCE (RFC 7636, S256) sobre TLS, URI-base com a versão "v0", escopos
// single_signature, multi_signature e signature_session, e o parâmetro do algoritmo do hash. Só os HASHES vão ao
// provedor: o documento nunca sai do servidor. Aqui, o que é puro: PKCE, state, o endereço de autorização, os corpos
// das chamadas e a conferência das respostas. O HTTP é do serviço isolado; o segredo do cliente vem do cofre.
// Nomes de campo das respostas conferidos contra o texto da especificação no construtor (ver preparo-e1.md, riscos).
import { createHash, randomBytes } from 'node:crypto';
import type { EscopoPsc } from '@sgh/contratos';
import { OID_SHA256 } from './oids.js';

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');

export interface Pkce {
  readonly verificador: string;
  readonly desafio: string;
  readonly metodo: 'S256';
}

/** PKCE S256: verificador de 43 caracteres (32 bytes aleatórios) e o desafio = base64url(SHA-256(verificador)). */
export function gerarPkce(aleatorio: (n: number) => Uint8Array = randomBytes): Pkce {
  const verificador = b64url(aleatorio(32));
  return { verificador, desafio: desafioDe(verificador), metodo: 'S256' };
}

export const desafioDe = (verificador: string) =>
  b64url(createHash('sha256').update(verificador, 'ascii').digest());

/** `state` opaco do OAuth: amarra a volta do provedor ao pedido gravado (contra CSRF na volta). */
export const gerarEstado = (aleatorio: (n: number) => Uint8Array = randomBytes) => b64url(aleatorio(32));

export interface ConfiguracaoPsc {
  /** URI-base com a versão (termina em /v0). */
  readonly uriBase: string;
  readonly clientId: string;
  /** Endereço de volta do novo (cadastrado no provedor). */
  readonly retorno: string;
}

/** Escopo pelo tamanho do lote: um documento, single; vários, multi (uma autorização para o lote todo). */
export const escopoDoLote = (n: number): EscopoPsc => (n <= 1 ? 'single_signature' : 'multi_signature');

const base = (u: string) => u.replace(/\/+$/, '');

export function enderecoAutorizacao(
  cfg: ConfiguracaoPsc,
  p: {
    readonly estado: string;
    readonly pkce: Pkce;
    readonly documentos: number;
    readonly validadeSeg: number;
  },
): string {
  if (!/^https:\/\/.+\/v0\/?$/.test(cfg.uriBase))
    throw new Error('O provedor precisa de URI-base https terminada em /v0.');
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.retorno,
    scope: escopoDoLote(p.documentos),
    state: p.estado,
    code_challenge: p.pkce.desafio,
    code_challenge_method: p.pkce.metodo,
    lifetime: String(p.validadeSeg),
  });
  if (p.documentos > 1) q.set('num_signatures', String(p.documentos));
  return `${base(cfg.uriBase)}/oauth/authorize?${q.toString()}`;
}

/** Corpo da troca do código pelo token (application/x-www-form-urlencoded). O segredo só passa por aqui, do cofre. */
export function corpoTroca(
  cfg: ConfiguracaoPsc,
  p: { readonly codigo: string; readonly verificador: string; readonly segredo: string },
): { readonly endereco: string; readonly corpo: string } {
  return {
    endereco: `${base(cfg.uriBase)}/oauth/token`,
    corpo: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      client_secret: p.segredo,
      code: p.codigo,
      redirect_uri: cfg.retorno,
      code_verifier: p.verificador,
    }).toString(),
  };
}

export interface ItemHash {
  /** Identificador do documento no novo (volta na resposta). */
  readonly id: string;
  readonly alias: string;
  /** SHA-256 em hexadecimal (o que a prévia mostrou). */
  readonly hashHex: string;
}

/** Corpo do pedido de assinatura: só os hashes (base64), o OID do algoritmo e o formato RAW (a assinatura PKCS#1 do hash; o envelope CMS/PAdES é montado pelo serviço com o certificado, D-RAW-49). */
export function corpoAssinatura(
  cfg: Pick<ConfiguracaoPsc, 'uriBase'>,
  itens: readonly ItemHash[],
): { readonly endereco: string; readonly corpo: { hashes: readonly Record<string, string>[] } } {
  if (itens.length === 0) throw new Error('Nada para assinar.');
  for (const i of itens) if (!/^[0-9a-f]{64}$/.test(i.hashHex)) throw new Error('Hash SHA-256 inválido.');
  return {
    endereco: `${base(cfg.uriBase)}/oauth/signature`,
    corpo: {
      hashes: itens.map((i) => ({
        id: i.id,
        alias: i.alias,
        hash: Buffer.from(i.hashHex, 'hex').toString('base64'),
        hash_algorithm: OID_SHA256,
        signature_format: 'RAW',
      })),
    },
  };
}

export type ConferenciaToken =
  | { readonly ok: true; readonly token: string; readonly expiraEm: Date }
  | { readonly ok: false; readonly motivo: 'resposta-invalida' | 'escopo-divergente' | 'titular-divergente' };

/**
 * Resposta do token: o escopo é o pedido e, quando o provedor informa o titular autorizado (CPF), é o do usuário da
 * sessão (regra 2 antes mesmo de ver o certificado).
 */
export function conferirToken(
  r: unknown,
  esperado: { readonly escopo: EscopoPsc; readonly cpf: string | null },
  agora: Date,
): ConferenciaToken {
  if (typeof r !== 'object' || r === null) return { ok: false, motivo: 'resposta-invalida' };
  const x = r as Record<string, unknown>;
  if (
    typeof x['access_token'] !== 'string' ||
    x['access_token'] === '' ||
    typeof x['expires_in'] !== 'number'
  )
    return { ok: false, motivo: 'resposta-invalida' };
  if (typeof x['scope'] === 'string' && !x['scope'].split(' ').includes(esperado.escopo))
    return { ok: false, motivo: 'escopo-divergente' };
  const tipoId = x['authorized_identification_type'];
  const id = x['authorized_identification'];
  if (
    tipoId === 'CPF' &&
    typeof id === 'string' &&
    esperado.cpf !== null &&
    id.replace(/\D/g, '') !== esperado.cpf
  )
    return { ok: false, motivo: 'titular-divergente' };
  return {
    ok: true,
    token: x['access_token'],
    expiraEm: new Date(agora.getTime() + Math.max(0, x['expires_in']) * 1000),
  };
}

export type ConferenciaAssinaturas =
  | {
      readonly ok: true;
      readonly assinaturas: ReadonlyMap<string, Uint8Array>;
      readonly certificado: string | null;
    }
  | { readonly ok: false; readonly motivo: 'resposta-invalida' | 'faltou-assinatura' | 'assinatura-a-mais' };

/** Resposta da assinatura: uma assinatura (crua, base64) para cada ID pedido, nem mais nem menos. */
export function conferirAssinaturas(r: unknown, ids: readonly string[]): ConferenciaAssinaturas {
  if (typeof r !== 'object' || r === null) return { ok: false, motivo: 'resposta-invalida' };
  const x = r as Record<string, unknown>;
  const lista = x['signatures'];
  if (!Array.isArray(lista)) return { ok: false, motivo: 'resposta-invalida' };
  const m = new Map<string, Uint8Array>();
  for (const s of lista as unknown[]) {
    const e = s as Record<string, unknown> | null;
    const id = e?.['id'];
    const raw = e?.['raw_signature'];
    if (typeof id !== 'string' || typeof raw !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw))
      return { ok: false, motivo: 'resposta-invalida' };
    if (!ids.includes(id) || m.has(id)) return { ok: false, motivo: 'assinatura-a-mais' };
    m.set(id, Uint8Array.from(Buffer.from(raw, 'base64')));
  }
  if (m.size !== ids.length) return { ok: false, motivo: 'faltou-assinatura' };
  const cert = x['certificate_alias'];
  return { ok: true, assinaturas: m, certificado: typeof cert === 'string' ? cert : null };
}
