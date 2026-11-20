import { defineConfig } from 'vitest/config';

// Regras puras do acesso (M05): política de senha, inatividade, reautenticação, tentativas e termo.
// Cobertura de 90% (ficha do M05, seção 10).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-acesso',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-acesso',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
