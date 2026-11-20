// Gancho de resolução para os comandos da raiz rodados direto pelo Node (sem build): mapeia os aliases
// @sgh/* do tsconfig.base.json para o código-fonte e, dentro de packages/, troca o sufixo .js das
// importações relativas pelo .ts existente (os pacotes seguem a convenção do TypeScript "nodenext").
// Uso: node --import ./tools/verificadores/src/caminhos-sgh.ts <script.ts>
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = resolve(import.meta.dirname, '../../..');
const base = JSON.parse(readFileSync(resolve(raiz, 'tsconfig.base.json'), 'utf8')) as {
  compilerOptions: { paths: Record<string, string[]> };
};
const aliases = new Map(
  Object.entries(base.compilerOptions.paths).map(([nome, [alvo = '']]) => [
    nome,
    pathToFileURL(resolve(raiz, alvo)).href,
  ]),
);
const pacotes = resolve(raiz, 'packages') + sep;

registerHooks({
  resolve(especificador, contexto, proximo) {
    const alias = aliases.get(especificador);
    if (alias) return { url: alias, shortCircuit: true };
    const pai = contexto.parentURL?.startsWith('file:') ? fileURLToPath(contexto.parentURL) : null;
    if (pai?.startsWith(pacotes) && especificador.startsWith('.') && especificador.endsWith('.js')) {
      const ts = resolve(dirname(pai), especificador.slice(0, -3) + '.ts');
      if (existsSync(ts)) return { url: pathToFileURL(ts).href, shortCircuit: true };
    }
    return proximo(especificador, contexto);
  },
});
