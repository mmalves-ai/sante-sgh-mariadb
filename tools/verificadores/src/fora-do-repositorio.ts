// Prova da POL-4 no verificar:tudo: as pastas globais onde npm, pnpm, Nx e Node gravariam por padrão
// não podem mudar durante a execução. Compara a data de modificação (mtime) antes e depois.
// Uma pasta só muda de data quando se cria ou apaga algo direto nela; outra sessão da VM pode mexer
// nelas ao mesmo tempo, e aí basta repetir o verificar:tudo sozinho para confirmar.
// Revisão do M09: (1) as subpastas de /tmp/node-compile-cache também entram (o Node grava dentro da pasta da
// versão, e só ela muda de data); (2) rastro persistente: um log do npm em ~/.npm/_logs com `cwd` neste
// repositório prova execução fora do wrapper ./pnpm mesmo antes do verificar:tudo (o npm guarda os 10 últimos).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function pastasVigiadas(casa: string = homedir(), uid: number = process.getuid?.() ?? 0): string[] {
  return [
    join(casa, '.npm'),
    join(casa, '.npm/_logs'),
    join(casa, '.npm/_npx'),
    join(casa, '.npm/_cacache'),
    join(casa, '.cache'),
    join(casa, '.config'),
    join(casa, '.local/share/pnpm'),
    join(casa, '.local/share/pnpm/store'),
    join(casa, '.nx'),
    join(casa, '.docker'),
    '/tmp/.nx',
    '/tmp/node-compile-cache',
    `/run/user/${uid}/pnpm-store-operation-locks-${uid}`,
  ];
}

/** As pastas vigiadas mais as subpastas diretas das que recebem gravação por dentro (cache de compilação). */
export function pastasVigiadasComSubpastas(casa: string = homedir(), uid?: number): string[] {
  const base = pastasVigiadas(casa, uid);
  const sub: string[] = [];
  for (const p of ['/tmp/node-compile-cache']) {
    try {
      for (const d of readdirSync(p, { withFileTypes: true })) if (d.isDirectory()) sub.push(join(p, d.name));
    } catch {
      // não existe
    }
  }
  return [...base, ...sub];
}

/** Logs do npm em `pasta` cujo `cwd` é este repositório (ou uma pasta dele): execução fora do wrapper. */
export function logsDoNpmDoRepositorio(
  raiz: string,
  pasta: string = join(homedir(), '.npm/_logs'),
): string[] {
  let arquivos: string[];
  try {
    arquivos = readdirSync(pasta).filter((f) => f.endsWith('.log'));
  } catch {
    return [];
  }
  const raizEsc = raiz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cwd = new RegExp(`\\bverbose cwd ${raizEsc}(?:/|$)`, 'm');
  return arquivos.filter((f) => {
    try {
      return cwd.test(readFileSync(join(pasta, f), 'utf8'));
    } catch {
      return false;
    }
  });
}

export type Retrato = Record<string, number | null>;

export function retratar(pastas: string[]): Retrato {
  const r: Retrato = {};
  for (const p of pastas) {
    try {
      r[p] = statSync(p).mtimeMs;
    } catch {
      r[p] = null; // não existe
    }
  }
  return r;
}

/** Pastas cuja data mudou (ou que passaram a existir / deixaram de existir) entre os dois retratos. */
export function mudancas(antes: Retrato, depois: Retrato): string[] {
  return Object.keys(antes).filter((p) => antes[p] !== depois[p]);
}
