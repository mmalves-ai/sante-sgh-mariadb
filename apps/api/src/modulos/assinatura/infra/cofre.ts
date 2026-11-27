// Cofre dos segredos da assinatura ICP-Brasil (M49, etapa 1; ICP-06; cap-08 §8.11): o client secret de cada provedor
// em nuvem (e, quando houver, o certificado A1 do serviço) fica FORA de tabela, log, tela e repositório. A tabela
// guarda só a referência (`cofre:psc/<estab>/<codigo>/client-secret`); a tela vê "definido" ou "não definido".
//   - `CofreArquivo`: um arquivo por referência num diretório FORA do repositório (COFRE_DIR, criado com 0700), cada
//     valor cifrado em AES-256-GCM com a chave mestra do deploy (PLATAFORMA_CHAVE_MESTRA; DP-15). Sem a chave ou sem o
//     diretório, o cofre fica indisponível (falha fechada) e a assinatura em nuvem não liga.
//   - `CofreMemoria`: a sessão sintética de dev/ci e os testes (nada vai a disco).
// A mesma chave cifra o verificador do PKCE guardado no pedido (pedido de assinatura).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { lerReferenciaCofreIntegracao, lerReferenciaSegredoLegado } from '@sgh/contratos';
import { chaveCofreEmailValida } from '@sgh/dominio-acesso';
import { lerReferenciaCofre, lerReferenciaCofreConector } from '@sgh/dominio-documento';

export interface Cofre {
  readonly disponivel: boolean;
  existe(referencia: string): Promise<boolean>;
  ler(referencia: string): Promise<string | null>;
  gravar(referencia: string, valor: string): Promise<void>;
  /** Cifra curta (o verificador do PKCE) com a chave do cofre; null quando indisponível. */
  cifrar(valor: string): string | null;
  decifrar(envelope: string): string | null;
}

const VERSAO = 'v1';

export function cifrarComChave(chave: Buffer, valor: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave, iv, { authTagLength: 16 });
  const corpo = Buffer.concat([c.update(valor, 'utf8'), c.final()]);
  return [
    VERSAO,
    iv.toString('base64url'),
    c.getAuthTag().toString('base64url'),
    corpo.toString('base64url'),
  ].join('.');
}

export function decifrarComChave(chave: Buffer, envelope: string): string | null {
  const [v, iv, tag, corpo] = envelope.split('.');
  if (v !== VERSAO || !iv || !tag || corpo === undefined) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64url'), { authTagLength: 16 });
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(corpo, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Referências aceitas: as dos provedores de assinatura (M49) e, desde o M59-F3, as das credenciais de parceiro que
 * substituem os segredos guardados nas tabelas do banco (`cofre:parceiro/<estab>/<tabela>/<resumo>/<coluna>`) e, desde a
 * obra carga-painel, a senha do servidor Firebird do cliente (`cofre:conector/<cliente>/firebird-senha`).
 */
function exigirReferencia(r: string): void {
  if (
    !lerReferenciaCofre(r) &&
    !lerReferenciaSegredoLegado(r) &&
    !lerReferenciaCofreConector(r) &&
    // 01-ADM L77: a senha do servidor de e-mail cadastrado, presa ao cliente
    // (email/cliente/<cliente>/<servidor_email.referencia_cofre>; chaveCofreEmail do domínio).
    !chaveCofreEmailValida(r) &&
    // Central de integrações externas (decisão 53): cofre:integracao/<cliente>/<integração>/<campo>.
    !lerReferenciaCofreIntegracao(r)
  )
    throw new Error('Referência de cofre inválida.');
}

export class CofreMemoria implements Cofre {
  readonly disponivel = true;
  private readonly valores = new Map<string, string>();
  private readonly chave = randomBytes(32);
  async existe(r: string) {
    exigirReferencia(r);
    return this.valores.has(r);
  }
  async ler(r: string) {
    exigirReferencia(r);
    return this.valores.get(r) ?? null;
  }
  async gravar(r: string, valor: string) {
    exigirReferencia(r);
    this.valores.set(r, valor);
  }
  cifrar(valor: string) {
    return cifrarComChave(this.chave, valor);
  }
  decifrar(envelope: string) {
    return decifrarComChave(this.chave, envelope);
  }
}

export class CofreArquivo implements Cofre {
  readonly disponivel = true;
  constructor(
    private readonly diretorio: string,
    private readonly chave: Buffer,
  ) {
    if (chave.length !== 32) throw new Error('Chave do cofre com 32 bytes.');
  }
  private caminho(r: string): string {
    exigirReferencia(r);
    // O nome do arquivo é o resumo da referência: nada do provedor aparece no disco.
    return join(this.diretorio, `${createHash('sha256').update(r).digest('hex')}.seg`);
  }
  async existe(r: string) {
    try {
      await stat(this.caminho(r));
      return true;
    } catch {
      return false;
    }
  }
  async ler(r: string) {
    try {
      return decifrarComChave(this.chave, (await readFile(this.caminho(r), 'utf8')).trim());
    } catch {
      return null;
    }
  }
  async gravar(r: string, valor: string) {
    await mkdir(this.diretorio, { recursive: true, mode: 0o700 });
    const destino = this.caminho(r);
    const temporario = `${destino}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporario, cifrarComChave(this.chave, valor), { mode: 0o600 });
    await rename(temporario, destino);
  }
  cifrar(valor: string) {
    return cifrarComChave(this.chave, valor);
  }
  decifrar(envelope: string) {
    return decifrarComChave(this.chave, envelope);
  }
}

/** Cofre sem chave ou sem diretório: nada lê nem grava (a tela diz "cofre indisponível"). */
export const cofreIndisponivel: Cofre = {
  disponivel: false,
  existe: async () => false,
  ler: async () => null,
  gravar: async () => {
    throw new Error('Cofre indisponível.');
  },
  cifrar: () => null,
  decifrar: () => null,
};

/**
 * O cofre de arquivo nunca fica dentro do repositório (o diretório de trabalho da API): um COFRE_DIR relativo ou
 * dentro do repositório é recusado (falha fechada).
 */
export function cofreDoAmbiente(
  env: Readonly<Record<string, string | undefined>>,
  chave: Buffer | null,
  raizRepo: string,
): Cofre {
  const dir = env['COFRE_DIR']?.trim();
  if (!chave || !dir || !isAbsolute(dir)) return cofreIndisponivel;
  const rel = relative(raizDoRepositorio(raizRepo), resolve(dir));
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return cofreIndisponivel;
  return new CofreArquivo(resolve(dir), chave);
}

/** A raiz do repositório (onde está o pnpm-workspace.yaml), subindo de onde a API roda. */
export function raizDoRepositorio(de: string): string {
  let d = resolve(de);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
    const pai = dirname(d);
    if (pai === d) break;
    d = pai;
  }
  return resolve(de);
}
