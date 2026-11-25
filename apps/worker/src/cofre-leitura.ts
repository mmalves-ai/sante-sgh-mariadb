// Leitura de segredo do cofre de arquivo (01-ADM L77): o worker lê a senha do servidor de e-mail cadastrado pela
// referência guardada em servidor_email.referencia_cofre. O formato é o do cofre da API (um arquivo por referência,
// nomeado pelo SHA-256 dela, em COFRE_DIR, cifrado em AES-256-GCM com a chave mestra do deploy): o worker só lê.
// Sem COFRE_DIR absoluto ou sem a chave mestra, o cofre fica indisponível e o envio autenticado falha fechado.
// O valor lido nunca vai a log nem a erro. A chave lida é sempre a do cliente da fila (chaveCofreEmail), nunca o texto
// cadastrado sozinho: um cliente não alcança a senha de outro.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { chaveCofreEmailValida, chaveMestra, decifrarSegredo } from '@sgh/dominio-acesso';

export type LerSegredo = (referencia: string) => Promise<string | null>;

/** O leitor do cofre do ambiente; null quando indisponível. */
export function leitorDoCofre(env: NodeJS.ProcessEnv): LerSegredo | null {
  const dir = env['COFRE_DIR']?.trim();
  const chave = chaveMestra(env['PLATAFORMA_CHAVE_MESTRA']);
  if (!dir || !isAbsolute(dir) || !chave) return null;
  return async (referencia) => {
    // Só a chave da senha de e-mail presa ao cliente (chaveCofreEmail): nenhum outro segredo do cofre.
    if (!chaveCofreEmailValida(referencia)) return null;
    try {
      const nome = `${createHash('sha256').update(referencia).digest('hex')}.seg`;
      return decifrarSegredo((await readFile(join(dir, nome), 'utf8')).trim(), chave);
    } catch {
      return null;
    }
  };
}
