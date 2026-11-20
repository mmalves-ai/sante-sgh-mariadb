// Testes de integração sobre a cópia descartável de dev (M01 em diante). Fora do `pnpm verificar`:
// rodam por `./pnpm testes:integracao`, só com a cópia do projeto no ar e AMBIENTE=dev.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/integracao/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
