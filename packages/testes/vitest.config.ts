import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  // Os de integração (src/integracao) só rodam por vitest.integracao.config.ts (precisam da cópia).
  test: { include: ['src/**/*.spec.ts'], exclude: ['src/integracao/**'], environment: 'node' },
});
