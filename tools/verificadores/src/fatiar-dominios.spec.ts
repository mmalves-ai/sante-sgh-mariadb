// W0-01 (revisão): a integração dos domínios pelo fatiador (planejamento/crud/ferramentas/fatiar-catalogo.mjs) é em
// três vias, com a base do git, como a do catálogo de operações. Repositório sintético em .tmp/: o lado "nosso" já
// fatiado (dominios/prefixos/<prefixo>.ts) e um ramo anterior ao fatiamento com DOMINIOS_Mxx em catalogo.ts.
// Mudou só do nosso lado: vale o nosso (sem conflito falso). Mudou só do lado deles: vale o deles. Retirado do nosso
// lado e intacto do outro: fica retirado (não ressuscita). Mudou dos dois lados de forma diferente: conflito.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const RAIZ = resolve(import.meta.dirname, '../../..');
const FERRAMENTA = resolve(RAIZ, 'planejamento/crud/ferramentas/fatiar-catalogo.mjs');
const DOM = 'packages/contratos/src/dominios';

const base = resolve(RAIZ, '.tmp');
mkdirSync(base, { recursive: true });
const tmp = mkdtempSync(join(base, 'fatiar-dominios-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'teste',
  GIT_AUTHOR_EMAIL: 'teste@exemplo.invalid',
  GIT_COMMITTER_NAME: 'teste',
  GIT_COMMITTER_EMAIL: 'teste@exemplo.invalid',
};
const git = (repo: string, ...a: string[]): string =>
  execFileSync('git', a, { cwd: repo, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
const fatiar = (repo: string) =>
  spawnSync(process.execPath, [FERRAMENTA, '--so=dominios', `--raiz=${repo}`], {
    cwd: repo,
    encoding: 'utf8',
    env,
  });
const ler = (repo: string, rel: string) => readFileSync(join(repo, DOM, rel), 'utf8');
const gravar = (repo: string, rel: string, texto: string) => writeFileSync(join(repo, DOM, rel), texto);
const trocar = (repo: string, rel: string, de: string, para: string) => {
  const t = ler(repo, rel);
  expect(t, `${rel}: ${de}`).toContain(de);
  gravar(repo, rel, t.replace(de, para));
};

/** O catalogo.ts de antes do fatiamento (DOMINIOS_M10 com três domínios e um auxiliar). */
const CATALOGO_ANTIGO = `import type { DominioPublico } from './tipos.js';

const ROTULO_PADRAO = 'Tipo de consulta';

export const DOMINIOS_M10: readonly DominioPublico[] = [
  { modulo: 'cadastro', recurso: 'estadoCivil', rotulo: 'Estado civil' },
  { modulo: 'cadastro', recurso: 'religiao', rotulo: 'Religião' },
  { modulo: 'agenda', recurso: 'tipoConsulta', rotulo: ROTULO_PADRAO },
];

export const DOMINIOS_DECLARADOS: readonly DominioPublico[] = [...DOMINIOS_M10];

export function dominioPublico(modulo: string, recurso: string): DominioPublico | undefined {
  return DOMINIOS_DECLARADOS.find((d) => d.modulo === modulo && d.recurso === recurso);
}
`;

/** Repositório com a base (antes do fatiamento), o ramo `antigo` e o `nosso` (fatiado), sem integração ainda. */
function montar(nome: string): string {
  const repo = join(tmp, nome);
  mkdirSync(join(repo, DOM), { recursive: true });
  mkdirSync(join(repo, 'tools/verificadores/src'), { recursive: true });
  copyFileSync(
    resolve(RAIZ, 'tools/verificadores/src/caminhos-sgh.ts'),
    join(repo, 'tools/verificadores/src/caminhos-sgh.ts'),
  );
  writeFileSync(join(repo, 'tsconfig.base.json'), '{ "compilerOptions": { "paths": {} } }\n');
  gravar(
    repo,
    'tipos.ts',
    'export interface DominioPublico {\n  modulo: string;\n  recurso: string;\n  rotulo: string;\n}\n',
  );
  gravar(repo, 'catalogo.ts', CATALOGO_ANTIGO);
  git(repo, 'init', '-q', '-b', 'nosso');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'branch', 'antigo');
  const r = fatiar(repo);
  expect(r.status, r.stderr).toBe(0);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'fatiamento');
  return repo;
}

function integrar(repo: string) {
  try {
    git(repo, 'merge', '-q', 'antigo');
  } catch {
    /* conflito esperado em catalogo.ts */
  }
  git(repo, 'checkout', '--theirs', `${DOM}/catalogo.ts`);
  return fatiar(repo);
}

describe('fatiador: junção dos domínios em três vias (W0-01, revisão)', () => {
  it('mudou só do nosso lado: vale o nosso; só do deles: vale o deles; retirado de um lado: não volta', () => {
    const repo = montar('tres-vias');
    // Nosso lado (depois do fatiamento): altera estadoCivil e retira agenda.tipoConsulta.
    trocar(repo, 'prefixos/cadastro.ts', "rotulo: 'Estado civil'", "rotulo: 'Estado civil (nosso)'");
    trocar(
      repo,
      'prefixos/agenda.ts',
      "  { modulo: 'agenda', recurso: 'tipoConsulta', rotulo: ROTULO_PADRAO },\n",
      '',
    );
    gravar(
      repo,
      'prefixos/agenda.ts',
      ler(repo, 'prefixos/agenda.ts').replace(/import \{ ROTULO_PADRAO \} from '\.\.\/ajudantes\.js';\n/, ''),
    );
    git(repo, 'commit', '-qam', 'nosso');
    // Ramo antigo (antes do fatiamento): altera religiao e acrescenta cadastro.raca.
    git(repo, 'checkout', '-q', 'antigo');
    trocar(
      repo,
      'catalogo.ts',
      "  { modulo: 'cadastro', recurso: 'religiao', rotulo: 'Religião' },\n",
      "  { modulo: 'cadastro', recurso: 'religiao', rotulo: 'Religião (deles)' },\n  { modulo: 'cadastro', recurso: 'raca', rotulo: 'Raça/cor' },\n",
    );
    git(repo, 'commit', '-qam', 'antigo');
    git(repo, 'checkout', '-q', 'nosso');

    const r = integrar(repo);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/junção em três vias/);
    expect(r.stdout).toMatch(/igual ao resultado da junção/);
    const cadastro = ler(repo, 'prefixos/cadastro.ts');
    expect(cadastro).toContain("rotulo: 'Estado civil (nosso)'");
    expect(cadastro).toContain("rotulo: 'Religião (deles)'");
    expect(cadastro).toContain("recurso: 'raca'");
    expect(ler(repo, 'prefixos/agenda.ts')).not.toContain('tipoConsulta');
    expect(ler(repo, 'catalogo.ts')).not.toMatch(/DOMINIOS_M10/);
  }, 120_000);

  it('mudou dos dois lados de forma diferente: conflito, nada é gravado', () => {
    const repo = montar('conflito');
    trocar(repo, 'prefixos/cadastro.ts', "rotulo: 'Religião'", "rotulo: 'Religião (nosso)'");
    git(repo, 'commit', '-qam', 'nosso');
    git(repo, 'checkout', '-q', 'antigo');
    trocar(repo, 'catalogo.ts', "rotulo: 'Religião'", "rotulo: 'Religião (deles)'");
    git(repo, 'commit', '-qam', 'antigo');
    git(repo, 'checkout', '-q', 'nosso');

    const antes = ler(repo, 'prefixos/cadastro.ts');
    const r = integrar(repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/cadastro\.religiao .*mudou dos dois lados/);
    expect(r.stderr).toMatch(/nada foi gravado/);
    expect(ler(repo, 'prefixos/cadastro.ts')).toBe(antes);
  }, 120_000);
});
