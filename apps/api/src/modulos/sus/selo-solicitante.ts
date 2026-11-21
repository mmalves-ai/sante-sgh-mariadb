// A chave opaca do médico solicitante da APAC (M51.3, D-SOLICITANTE-513): o cadastro de solicitantes SUS tem o
// CPF como chave, e o CPF não vai ao navegador. O servidor sela o CPF num identificador opaco (AES-256-GCM com o vetor
// derivado do próprio CPF por HMAC: o mesmo médico dá sempre a mesma chave, e o combo da tela compara valores) e o abre
// de volta só na gravação do laudo. As duas chaves derivam (HKDF-SHA256) da chave mestra da plataforma; sem ela (dev/ci,
// sessão sintética), de uma chave aleatória do processo: a chave vale até o processo reiniciar e, depois, o laudo
// aberto na tela é recusado com "solicitante não encontrado" (basta buscar o médico de novo).
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const PREFIXO = 's1';

export class SeloSolicitanteApac {
  private readonly chaveVetor: Buffer;
  private readonly chaveCifra: Buffer;

  constructor(mestra: Buffer | null = null) {
    const m = mestra && mestra.length === 32 ? mestra : randomBytes(32);
    this.chaveVetor = Buffer.from(hkdfSync('sha256', m, Buffer.alloc(0), 'sgh-sus-apac-solicitante-iv', 32));
    this.chaveCifra = Buffer.from(hkdfSync('sha256', m, Buffer.alloc(0), 'sgh-sus-apac-solicitante', 32));
  }

  /** A chave opaca (base64url, sem dígito do CPF legível). */
  selar(cpf: string): string {
    const d = cpf.replace(/\D/g, '');
    const iv = createHmac('sha256', this.chaveVetor).update(d).digest().subarray(0, 12);
    const c = createCipheriv('aes-256-gcm', this.chaveCifra, iv, { authTagLength: 16 });
    const corpo = Buffer.concat([c.update(d, 'utf8'), c.final()]);
    return `${PREFIXO}_${Buffer.concat([iv, corpo, c.getAuthTag()]).toString('base64url')}`;
  }

  /** O CPF da chave; null quando ela não foi selada por este servidor (adulterada, de outra chave, CPF em claro). */
  abrir(chave: string): string | null {
    if (!chave.startsWith(`${PREFIXO}_`)) return null;
    const b = Buffer.from(chave.slice(PREFIXO.length + 1), 'base64url');
    if (b.length < 12 + 1 + 16) return null;
    try {
      const d = createDecipheriv('aes-256-gcm', this.chaveCifra, b.subarray(0, 12), { authTagLength: 16 });
      d.setAuthTag(b.subarray(b.length - 16));
      const cpf = Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString('utf8');
      return /^\d{1,11}$/.test(cpf) ? cpf : null;
    } catch {
      return null;
    }
  }
}

/** A chave mestra da plataforma (`PLATAFORMA_CHAVE_MESTRA`, 32 bytes em base64); ausente ou inválida: null. */
export function chaveMestraDoAmbiente(env: NodeJS.ProcessEnv): Buffer | null {
  const t = (env['PLATAFORMA_CHAVE_MESTRA'] ?? '').trim();
  if (!t) return null;
  const b = Buffer.from(t, 'base64');
  return b.length === 32 ? b : null;
}
