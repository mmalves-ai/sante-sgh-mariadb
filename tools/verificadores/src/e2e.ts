// pnpm e2e -- --grep @Mnn : Playwright + axe-core no Chrome da VM (aceita o "--" repassado pelo pnpm).
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
const r = spawnSync('playwright', ['test', '-c', 'apps/web/playwright.config.ts', ...args], {
  cwd: raiz,
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
