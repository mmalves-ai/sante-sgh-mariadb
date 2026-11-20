// A árvore de arquivos de uma versão, com o sha256 de cada um (links simbólicos pelo alvo: o node_modules do pnpm é
// feito de links). Usada no empacotamento (gera o manifesto) e na instalação (confere a árvore desempacotada).
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ArquivoManifesto } from './pacote.ts';

export const ARQUIVO_MANIFESTO = 'manifesto.json';

export function listarArvore(
  raiz: string,
  ignorar: (rel: string) => boolean = () => false,
): ArquivoManifesto[] {
  const saida: ArquivoManifesto[] = [];
  const andar = (pasta: string) => {
    for (const n of readdirSync(pasta).sort()) {
      const c = join(pasta, n);
      const rel = relative(raiz, c).split(sep).join('/');
      if (rel === ARQUIVO_MANIFESTO || ignorar(rel)) continue;
      const s = lstatSync(c);
      if (s.isSymbolicLink()) {
        const alvo = readlinkSync(c);
        saida.push({
          caminho: rel,
          sha256: createHash('sha256').update(`link:${alvo}`).digest('hex'),
          bytes: 0,
        });
      } else if (s.isDirectory()) andar(c);
      else if (s.isFile())
        saida.push({
          caminho: rel,
          sha256: createHash('sha256').update(readFileSync(c)).digest('hex'),
          bytes: s.size,
        });
    }
  };
  andar(raiz);
  return saida;
}
