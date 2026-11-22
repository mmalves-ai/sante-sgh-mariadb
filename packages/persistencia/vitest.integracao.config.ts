import { defineConfig } from 'vitest/config';

// Integração da @sgh/persistencia contra o MariaDB, no cliente de teste de SGH_CLIENTE_TESTE (criado e apagado por
// quem roda; nunca cliente_demo). Massa sintética.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'persistencia-integracao',
    include: ['src/**/*.int.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
