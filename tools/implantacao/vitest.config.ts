import { defineConfig } from 'vitest/config';

// Projeto "implantacao" (M60): regras puras do ensaio da primeira aplicação e os geradores dos anexos.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: { name: 'implantacao', include: ['src/**/*.spec.ts'], environment: 'node', env: { TZ: 'UTC' } },
});
