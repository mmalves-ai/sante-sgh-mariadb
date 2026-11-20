// Varredura do repositório: as chaves de ambiente que o código de produção (API, worker e pacotes) lê. Fica de fora o
// que não vai ao servidor: testes (*.spec.ts, *.spec-util.ts, e2e) e as ferramentas (tools/).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { varrerChaves } from './variaveis.ts';

const FORA = /(\.spec\.ts|\.spec-util\.ts|\.d\.ts)$/;

function arquivosTs(pasta: string, saida: string[] = []): string[] {
  let nomes: string[];
  try {
    nomes = readdirSync(pasta);
  } catch {
    return saida;
  }
  for (const n of nomes) {
    if (n === 'node_modules' || n === 'dist' || n === 'e2e' || n === '__fixtures__') continue;
    const c = join(pasta, n);
    if (statSync(c).isDirectory()) arquivosTs(c, saida);
    else if (n.endsWith('.ts') && !FORA.test(n)) saida.push(c);
  }
  return saida;
}

/** As pastas de código de produção: apps/api, apps/worker e packages/<x>/src. */
export function pastasDeProducao(raiz: string): string[] {
  const pacotes = readdirSync(join(raiz, 'packages')).map((p) => join(raiz, 'packages', p, 'src'));
  return [join(raiz, 'apps/api/src'), join(raiz, 'apps/worker/src'), ...pacotes];
}

export function chavesDoRepositorio(raiz: string): Set<string> {
  const achadas = new Set<string>();
  for (const pasta of pastasDeProducao(raiz))
    for (const a of arquivosTs(pasta)) for (const k of varrerChaves(readFileSync(a, 'utf8'))) achadas.add(k);
  return achadas;
}
