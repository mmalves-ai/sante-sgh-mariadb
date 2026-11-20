// Carregador do arquivo de ambiente do projeto (.env.sante), com caminho explícito (ADR 0001, divergência 5).
// Nunca lê o .env da raiz, que é do legado (regra 1.8). Nada daqui vai para log: pode haver segredo.
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export const ARQUIVO_AMBIENTE_PADRAO = '.env.sante';

export type Ambiente = Readonly<Record<string, string | undefined>>;

/** Caminho do arquivo de ambiente: SGH_ARQUIVO_AMBIENTE (do processo) ou .env.sante na pasta de trabalho. */
export function caminhoArquivoAmbiente(env: Ambiente = process.env, pasta: string = process.cwd()): string {
  return resolve(pasta, env['SGH_ARQUIVO_AMBIENTE'] ?? ARQUIVO_AMBIENTE_PADRAO);
}

/** Lê o arquivo (sem aplicar ao processo). Devolve null se não existir. Recusa o .env da raiz. */
export function lerArquivoAmbiente(caminho: string): Record<string, string> | null {
  if (basename(caminho) === '.env') {
    throw new Error('O .env da raiz é do legado e não é lido pelo projeto; use .env.sante.');
  }
  if (!existsSync(caminho)) return null;
  return parseEnv(readFileSync(caminho, 'utf8')) as Record<string, string>;
}

/**
 * Ambiente efetivo: o do processo tem precedência sobre o do arquivo (o arquivo só preenche o que falta).
 * Não altera o process.env.
 */
export function ambienteEfetivo(
  caminho: string,
  processo: Ambiente = process.env,
): { readonly env: Record<string, string | undefined>; readonly carregado: boolean } {
  const arquivo = lerArquivoAmbiente(caminho);
  return { env: { ...(arquivo ?? {}), ...processo }, carregado: arquivo !== null };
}

/** Aplica o arquivo ao destino (padrão: process.env) sem sobrescrever o que já veio do processo. */
export function aplicarArquivoAmbiente(
  caminho: string,
  destino: Record<string, string | undefined> = process.env,
): boolean {
  const arquivo = lerArquivoAmbiente(caminho);
  if (arquivo === null) return false;
  for (const [chave, valor] of Object.entries(arquivo)) {
    if (destino[chave] === undefined) destino[chave] = valor;
  }
  return true;
}
