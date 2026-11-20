// Ambiente do núcleo: o do processo, completado pelo arquivo .env da raiz do projeto. Nada daqui vai para log:
// o arquivo tem segredos (AGENTS, regra 8). O processo tem precedência; o arquivo só preenche o que falta.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export type Ambiente = Readonly<Record<string, string | undefined>>;

export const ARQUIVO_AMBIENTE_PADRAO = '.env';

/** Raiz do projeto: a primeira pasta, subindo, que tem o pnpm-workspace.yaml. */
export function raizDoProjeto(pasta: string = process.cwd()): string | null {
  let atual = resolve(pasta);
  for (;;) {
    if (existsSync(join(atual, 'pnpm-workspace.yaml'))) return atual;
    const acima = dirname(atual);
    if (acima === atual) return null;
    atual = acima;
  }
}

/** Caminho do arquivo de ambiente: SGH_ARQUIVO_AMBIENTE (do processo) ou o .env da raiz do projeto. */
export function caminhoArquivoAmbiente(
  env: Ambiente = process.env,
  pasta: string = process.cwd(),
): string | null {
  const explicito = env['SGH_ARQUIVO_AMBIENTE']?.trim();
  if (explicito) return resolve(pasta, explicito);
  const raiz = raizDoProjeto(pasta);
  return raiz ? join(raiz, ARQUIVO_AMBIENTE_PADRAO) : null;
}

/** Lê o arquivo sem aplicar ao processo. Devolve null se não existir. */
export function lerArquivoAmbiente(caminho: string): Record<string, string> | null {
  if (!existsSync(caminho)) return null;
  return parseEnv(readFileSync(caminho, 'utf8')) as Record<string, string>;
}

/** Ambiente efetivo: o do processo sobre o do arquivo. Não altera o process.env. */
export function ambienteEfetivo(
  processo: Ambiente = process.env,
  caminho: string | null = caminhoArquivoAmbiente(processo),
): { readonly env: Record<string, string | undefined>; readonly carregado: boolean } {
  const arquivo = caminho ? lerArquivoAmbiente(caminho) : null;
  return { env: { ...(arquivo ?? {}), ...processo }, carregado: arquivo !== null };
}
