import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  // As de integração (*.int.spec.ts) rodam pelo vitest.integracao.config.ts, com as travas das cópias.
  test: { include: ['src/**/*.spec.ts'], exclude: ['src/**/*.int.spec.ts'], environment: 'node' },
});
