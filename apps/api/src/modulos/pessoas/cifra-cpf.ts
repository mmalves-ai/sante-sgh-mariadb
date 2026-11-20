// CPF do colaborador e do dependente em SGH_PES_* (M52.1; ficha, seção 6: "CPF cifrado como chave natural"; D-CPF-52):
// nunca em claro no banco. Duas chaves derivadas (HKDF-SHA256) de uma chave mestra de 32 bytes do cofre
// (`PESSOAS_CHAVE_CPF`, ou a chave mestra da plataforma): o HMAC-SHA256 do CPF é a chave natural (busca exata, a
// mesma pessoa em vários vínculos) e o AES-256-GCM guarda o número para a ficha (mascarada) e para a folha (M53). Sem
// a chave fora de dev/ci, a admissão fica desligada com o motivo (POL-3); a sessão sintética usa chave aleatória.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const VERSAO = 'v1';

export class CifraCpf {
  private readonly chaveHmac: Buffer;
  private readonly chaveCifra: Buffer;
  private readonly chaveTexto: Buffer;

  constructor(mestra: Buffer) {
    if (mestra.length !== 32) throw new Error('A chave do CPF precisa ter 32 bytes.');
    this.chaveHmac = Buffer.from(hkdfSync('sha256', mestra, Buffer.alloc(0), 'sgh-pessoas-cpf-hmac', 32));
    this.chaveCifra = Buffer.from(hkdfSync('sha256', mestra, Buffer.alloc(0), 'sgh-pessoas-cpf-cifra', 32));
    this.chaveTexto = Buffer.from(hkdfSync('sha256', mestra, Buffer.alloc(0), 'sgh-pessoas-texto-cifra', 32));
  }

  /**
   * M53.6: texto pessoal livre (a ficha do eSocial do colaborador, o XML do evento do trabalhador), com chave derivada
   * própria; ao contrário do CPF, o texto é guardado como veio (UTF-8).
   */
  cifrarTexto(texto: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.chaveTexto, iv, { authTagLength: 16 });
    const corpo = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return [
      't1',
      iv.toString('base64url'),
      corpo.toString('base64url'),
      c.getAuthTag().toString('base64url'),
    ].join('.');
  }

  /** null quando o texto não decifra com esta chave. */
  decifrarTexto(texto: string | null): string | null {
    if (!texto) return null;
    const [v, iv, corpo, tag] = texto.split('.');
    if (v !== 't1' || !iv || corpo === undefined || !tag) return null;
    try {
      const d = createDecipheriv('aes-256-gcm', this.chaveTexto, Buffer.from(iv, 'base64url'), {
        authTagLength: 16,
      });
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(corpo, 'base64url')), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  /** Chave natural: 64 caracteres hexadecimais; o mesmo CPF dá sempre o mesmo valor. */
  hmac(cpf: string): string {
    return createHmac('sha256', this.chaveHmac).update(soDigitos(cpf)).digest('hex');
  }

  cifrar(cpf: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.chaveCifra, iv, { authTagLength: 16 });
    const corpo = Buffer.concat([c.update(soDigitos(cpf), 'utf8'), c.final()]);
    return [
      VERSAO,
      iv.toString('base64url'),
      corpo.toString('base64url'),
      c.getAuthTag().toString('base64url'),
    ].join('.');
  }

  /** null quando o texto não decifra com esta chave (chave trocada, valor adulterado). */
  decifrar(texto: string | null): string | null {
    if (!texto) return null;
    const [v, iv, corpo, tag] = texto.split('.');
    if (v !== VERSAO || !iv || !corpo || !tag) return null;
    try {
      const d = createDecipheriv('aes-256-gcm', this.chaveCifra, Buffer.from(iv, 'base64url'), {
        authTagLength: 16,
      });
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(corpo, 'base64url')), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}

const soDigitos = (v: string) => v.replace(/\D/g, '');

/** A chave mestra do ambiente: 32 bytes em hexadecimal (64) ou base64; inválida ou ausente: null. */
export function chaveCpfDoAmbiente(env: NodeJS.ProcessEnv): Buffer | null {
  const bruto = (env['PESSOAS_CHAVE_CPF'] ?? env['PLATAFORMA_CHAVE_MESTRA'] ?? '').trim();
  if (!bruto) return null;
  const b = /^[0-9a-f]{64}$/i.test(bruto) ? Buffer.from(bruto, 'hex') : Buffer.from(bruto, 'base64');
  return b.length === 32 ? b : null;
}
