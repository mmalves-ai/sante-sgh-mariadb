// Cifra das contas da plataforma (ADR 0021). Senha: Argon2id do node:crypto (Node 24, sem dependência
// nova), com sal aleatório de 16 bytes, guardada no formato PHC ($argon2id$v=19$m=…,t=…,p=…$sal$hash).
// Parâmetros acima do mínimo da OWASP (m=19 MiB, t=2): m=64 MiB, t=3, p=1. Verificação em tempo constante;
// cifra em formato desconhecido nunca confere. Segredo TOTP: AES-256-GCM em envelope, com a chave mestra fora
// do banco (PLATAFORMA_CHAVE_MESTRA, 32 bytes em base64, no cofre do deploy). Nada daqui vai a log.
import {
  argon2,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export interface ParametrosArgon2 {
  readonly memoria: number;
  readonly passes: number;
  readonly paralelismo: number;
}

export const ARGON2_PADRAO: ParametrosArgon2 = { memoria: 65_536, passes: 3, paralelismo: 1 };
const TAMANHO_TAG = 32;

function argon2id(senha: string, sal: Buffer, p: ParametrosArgon2): Promise<Buffer> {
  return new Promise((ok, falha) =>
    argon2(
      'argon2id',
      {
        message: Buffer.from(senha, 'utf8'),
        nonce: sal,
        parallelism: p.paralelismo,
        tagLength: TAMANHO_TAG,
        memory: p.memoria,
        passes: p.passes,
      },
      (erro, chave) => (erro ? falha(erro) : ok(Buffer.from(chave))),
    ),
  );
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

/** Cifra da senha no formato PHC (o sal vai junto; nunca a senha). */
export async function cifrarSenha(senha: string, p: ParametrosArgon2 = ARGON2_PADRAO): Promise<string> {
  const sal = randomBytes(16);
  const hash = await argon2id(senha, sal, p);
  return `$argon2id$v=19$m=${p.memoria},t=${p.passes},p=${p.paralelismo}$${b64(sal)}$${b64(hash)}`;
}

const PHC =
  /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]{16,})\$([A-Za-z0-9+/]{16,})$/;

/** Confere a senha com a cifra guardada; cifra ausente ou fora do formato: false (com o custo de uma conferência). */
export async function conferirSenha(senha: string, cifra: string | null): Promise<boolean> {
  const m = cifra ? PHC.exec(cifra) : null;
  if (!m) {
    await argon2id(senha, Buffer.alloc(16), ARGON2_PADRAO);
    return false;
  }
  const p = { memoria: Number(m[1]), passes: Number(m[2]), paralelismo: Number(m[3]) };
  if (p.memoria < 8_192 || p.memoria > 1_048_576 || p.passes < 1 || p.paralelismo < 1) return false;
  const esperado = Buffer.from(m[5] as string, 'base64');
  const calculado = await argon2id(senha, Buffer.from(m[4] as string, 'base64'), {
    ...p,
  });
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

/** Chave mestra do envelope (32 bytes); null quando ausente ou inválida. */
export function chaveMestra(valor: string | undefined): Buffer | null {
  const t = (valor ?? '').trim();
  if (!t) return null;
  const b = Buffer.from(t, 'base64');
  return b.length === 32 ? b : null;
}

/** Envelope AES-256-GCM: "v1.<iv>.<tag>.<cifrado>" (base64url). */
export function cifrarSegredo(segredo: string, chave: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave, iv, { authTagLength: 16 });
  const cifrado = Buffer.concat([c.update(segredo, 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), cifrado]
    .map((x) => (typeof x === 'string' ? x : x.toString('base64url')))
    .join('.');
}

export function decifrarSegredo(envelope: string, chave: Buffer): string {
  const [v, iv, tag, cifrado] = envelope.split('.');
  if (v !== 'v1' || !iv || !tag || !cifrado) throw new Error('Envelope do segredo em formato desconhecido.');
  // Tag de 16 bytes exigida: sem authTagLength, o GCM aceitaria uma tag truncada (falsificação mais fácil).
  const d = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64url'), { authTagLength: 16 });
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(cifrado, 'base64url')), d.final()]).toString('utf8');
}

/** Token de convite (32 bytes aleatórios, base64url) e o hash que fica no banco (SHA-256 hex). */
export function novoConvite(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashConvite(token) };
}

export function hashConvite(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
