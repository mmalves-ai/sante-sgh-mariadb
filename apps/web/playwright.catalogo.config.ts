import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import { ambienteDoNavegador } from './e2e/navegador.js';

const raiz = resolve(import.meta.dirname, '../..');

// Regressão visual do catálogo do @sgh/ui (M07): o build estático (`ui:catalogo-build`) é servido por
// interceptação de rota, sem servidor nem porta; nenhuma requisição sai da máquina.
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'catalogo-visual.spec.ts',
  outputDir: 'test-results/catalogo',
  snapshotPathTemplate: '{testDir}/catalogo-visual/{arg}{ext}',
  reporter: [['list']],
  forbidOnly: true,
  workers: 1,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: {
    channel: 'chrome',
    headless: true,
    trace: 'off',
    viewport: { width: 1100, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: { env: ambienteDoNavegador(raiz) },
  },
});
