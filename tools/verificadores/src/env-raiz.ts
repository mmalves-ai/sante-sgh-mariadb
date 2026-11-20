// Regra 1 da ficha do M00 (opção B): o .env da raiz não muda. Só metadados (stat), nunca o conteúdo.
import { readFileSync, statSync } from 'node:fs';

export interface MetadadosEnv {
  readonly permissao: string;
  readonly tamanho: number;
  readonly mtime: number;
}

export interface RegistroEnv extends MetadadosEnv {
  /** Pasta onde o .env do legado foi registrado (num clone ou no CI ele não existe). */
  readonly raiz?: string;
}

export function lerRegistro(caminho: string): RegistroEnv {
  const r = JSON.parse(readFileSync(caminho, 'utf8')) as RegistroEnv;
  return { permissao: r.permissao, tamanho: r.tamanho, mtime: r.mtime, ...(r.raiz ? { raiz: r.raiz } : {}) };
}

/** Equivale a `stat -c '%a %s %Y'`; devolve null se o arquivo não existir. */
export function medirEnv(caminho: string): MetadadosEnv | null {
  try {
    const s = statSync(caminho);
    return { permissao: (s.mode & 0o777).toString(8), tamanho: s.size, mtime: Math.floor(s.mtimeMs / 1000) };
  } catch {
    return null;
  }
}

/** Lista as diferenças entre o registro e o medido (vazia = intocado). */
export function compararEnv(registro: MetadadosEnv, medido: MetadadosEnv | null): string[] {
  if (!medido) return ['o .env da raiz não existe mais (renomeado, movido ou apagado)'];
  const diferencas: string[] = [];
  if (medido.permissao !== registro.permissao)
    diferencas.push(`permissão ${medido.permissao}, registrada ${registro.permissao}`);
  if (medido.tamanho !== registro.tamanho)
    diferencas.push(`tamanho ${medido.tamanho}, registrado ${registro.tamanho}`);
  if (medido.mtime !== registro.mtime) diferencas.push(`data ${medido.mtime}, registrada ${registro.mtime}`);
  return diferencas;
}
