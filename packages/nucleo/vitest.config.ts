import { defineConfig } from 'vitest/config';

// Núcleo (F2.1): testes unitários com banco dublê (*.spec.ts) e de integração contra o MariaDB real
// (*.int.spec.ts, cliente teste_nucleo). SGH_NUCLEO_SEM_BANCO=1 pula só os de integração.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'nucleo',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
