// Prova das fronteiras (ficha do M00, regra 3; ficha do M02, regra 1): com cada fixture de importação
// proibida, `nx lint` do projeto falha; sem ela, fica verde. A fixture é copiada para dentro do projeto e
// sempre removida ao final.
import { spawnSync } from 'node:child_process';
import { copyFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '../../..');

const casos = [
  {
    projeto: 'web',
    fixture: 'web-importa-nucleo.ts.txt',
    destino: 'apps/web/src/fixture-importacao-proibida.ts',
  },
  {
    projeto: 'api',
    fixture: 'api-importa-driver-banco.ts.txt',
    destino: 'apps/api/src/fixture-importacao-proibida.ts',
  },
];

function lint(projeto: string): number {
  const r = spawnSync('nx', ['run', `${projeto}:lint`, '--skip-nx-cache', '--output-style=static'], {
    cwd: raiz,
    stdio: 'inherit',
  });
  return r.status ?? 1;
}

let ok = true;
for (const c of casos) {
  const destino = resolve(raiz, c.destino);
  let comFixture: number;
  try {
    copyFileSync(resolve(raiz, 'tools/verificadores/fixtures', c.fixture), destino);
    console.log(`▶ nx lint ${c.projeto} COM a fixture ${c.fixture} (precisa falhar)`);
    comFixture = lint(c.projeto);
  } finally {
    rmSync(destino, { force: true });
  }
  console.log(`▶ nx lint ${c.projeto} SEM a fixture (precisa passar)`);
  const semFixture = lint(c.projeto);
  const provado = comFixture !== 0 && semFixture === 0;
  console.log(
    `[fronteiras] ${c.projeto}: com fixture ${comFixture !== 0 ? 'falhou (esperado)' : 'PASSOU (defeito)'}; ` +
      `sem fixture ${semFixture === 0 ? 'verde' : 'VERMELHO'} → ${provado ? 'prova ok' : 'PROVA FALHOU'}`,
  );
  ok &&= provado;
}
process.exit(ok ? 0 : 1);
