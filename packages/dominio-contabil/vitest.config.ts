import { defineConfig } from 'vitest/config';

// Regras puras da contabilidade (M54): plano de contas, regra de contabilização versionada, derivação dos fatos lidos
// (receita no fechamento, glosa e recurso como ajuste), partidas dobradas, de-para comum com a exportação e o
// reprocessamento idêntico. Cobertura de 90% (ficha do M54, seção 10: motor de contabilização).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-contabil',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-contabil',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
