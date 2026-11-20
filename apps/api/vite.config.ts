// Build da API: pacote ESM único para o Node 24 (os @sgh/* entram no pacote; node_modules fica externo).
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { marcarCommit } from './src/versao.js';

const raiz = resolve(import.meta.dirname, '../..');

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function commitAtual(): string | null {
  try {
    return marcarCommit(git('rev-parse', '--short=12', 'HEAD'), git('status', '--porcelain'));
  } catch {
    return null; // sem git: a versão fica rastreável pela data do build
  }
}

const pacote = JSON.parse(readFileSync(resolve(raiz, 'package.json'), 'utf8')) as { version: string };

/** M31: o XSD oficial da TISS 04.03.00 (bytes originais, conferidos pelo SHA256SUMS) vai ao lado do main.js. */
const copiarXsdTiss = {
  name: 'sgh-copiar-xsd-tiss',
  closeBundle() {
    cpSync(
      resolve(raiz, 'packages/dominio-faturamento/src/tiss/xsd/04.03.00'),
      resolve(import.meta.dirname, 'dist/xsd/04.03.00'),
      { recursive: true },
    );
    // M53.6: o XSD oficial do eSocial (um pacote por leiaute, conferido pelo SHA256SUMS) vai ao lado do main.js.
    cpSync(
      resolve(raiz, 'packages/dominio-pessoas/src/esocial/xsd'),
      resolve(import.meta.dirname, 'dist/xsd-esocial'),
      { recursive: true },
    );
  },
};

export default defineConfig({
  root: import.meta.dirname,
  plugins: [copiarXsdTiss],
  envDir: false,
  resolve: { tsconfigPaths: true },
  define: {
    __SGH_VERSAO__: JSON.stringify(pacote.version),
    __SGH_COMMIT__: JSON.stringify(commitAtual()),
    __SGH_CONSTRUIDO_EM__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node24',
    sourcemap: true,
  },
});
