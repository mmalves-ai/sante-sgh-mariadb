// Vitest de um lote da F2.2/F2.3 (tools/obra/conferir-lote-f22.sh): roda só os specs passados em LOTE_SPECS
// (caminhos relativos a apps/api, separados por vírgula), de unidade e de integração, com a raiz e os caminhos
// da API. Não substitui as suítes do projeto; serve à autoconferência do lote.
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const specs = (process.env['LOTE_SPECS'] ?? '').split(',').filter(Boolean);
const raiz = resolve(import.meta.dirname, '../../', process.env['LOTE_RAIZ'] ?? 'apps/api');

export default defineConfig({
  root: raiz,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'lote-f22',
    include: specs.length ? specs : ['__nenhum_spec__'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    env: { TZ: 'UTC' },
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
