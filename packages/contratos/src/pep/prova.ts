// Prova do documento clínico (ficha do M22, seção 6 e regra 11; cap-11 §11.1 "documento com hash"): JSON canônico
// (JCS, RFC 8785), SHA-256 e os eventos do documento encadeados por hash. Puro e compartilhado: o adaptador grava a
// cadeia na mesma transação do registro e a tela e o servidor a conferem com as mesmas funções.
/** JSON canônico (RFC 8785). Recusa número não finito e valor que não é JSON. */
export function jcs(v: unknown): string {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('JCS: número não finito.');
    return JSON.stringify(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const chaves = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${chaves.map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`).join(',')}}`;
  }
  throw new Error('JCS: valor fora do JSON.');
}

export async function sha256Hex(texto: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const TIPOS_EVENTO_DOCUMENTO = [
  'criado',
  'suspenso',
  'visualizado',
  'impresso',
  'alterado-fora',
] as const;
export type TipoEventoDocumento = (typeof TIPOS_EVENTO_DOCUMENTO)[number];

export interface EventoDocumento {
  readonly tipo: TipoEventoDocumento;
  readonly registro: number;
  readonly hashDocumento: string;
  /** Instante ISO (UTC). */
  readonly em: string;
  readonly usuario: string;
  readonly justificativa?: string | null;
  /** Feito numa sessão "como" do suporte técnico (ADR 0021, R1); ausente nos eventos sem a marca. */
  readonly comoSuporte?: true;
}

/** Hash do evento encadeado ao anterior (o primeiro encadeia em 64 zeros). */
export async function hashDoEvento(e: EventoDocumento, anterior: string | null): Promise<string> {
  return sha256Hex(`${anterior ?? '0'.repeat(64)}\n${jcs(e)}`);
}

/** Confere a cadeia (cada hash recalculado a partir do anterior). */
export async function cadeiaIntegra(
  eventos: readonly { readonly evento: EventoDocumento; readonly hash: string }[],
): Promise<boolean> {
  let anterior: string | null = null;
  for (const x of eventos) {
    if ((await hashDoEvento(x.evento, anterior)) !== x.hash) return false;
    anterior = x.hash;
  }
  return true;
}

// ── M23: eventos dos documentos do novo fora do registro clínico (SGH_PEP_DOCUMENTO_EVENTO) ─────────────────

export const TIPOS_EVENTO_DOCUMENTO_PEP = [
  'emitido',
  'assinado',
  'suspenso',
  'retificado',
  'visualizado',
  'impresso',
  'segunda-via',
  'exportado',
  'alterado-fora',
  'inativado',
] as const;
export type TipoEventoDocumentoPep = (typeof TIPOS_EVENTO_DOCUMENTO_PEP)[number];

export interface EventoDocumentoPep {
  readonly tipo: TipoEventoDocumentoPep;
  /** ID do documento do novo (SGH_PEP_DOCUMENTO). */
  readonly documento: number;
  readonly hashDocumento: string;
  readonly em: string;
  readonly usuario: string;
  readonly justificativa?: string | null;
  readonly nivel?: string | null;
  readonly comoSuporte?: true;
}

/** Hash do evento do documento do novo, encadeado ao anterior (o mesmo esquema do registro clínico). */
export async function hashDoEventoPep(e: EventoDocumentoPep, anterior: string | null): Promise<string> {
  return sha256Hex(`${anterior ?? '0'.repeat(64)}\n${jcs(e)}`);
}

/** Hash do conteúdo canônico de um documento do novo (JCS + SHA-256). */
export function hashCanonico(v: unknown): Promise<string> {
  return sha256Hex(jcs(v));
}
