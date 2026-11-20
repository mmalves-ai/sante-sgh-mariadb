import { defineConfig } from 'vitest/config';

// Regras puras dos custos hospitalares (M54): estrutura de custos (classes, ordem e critério do rateio, pendências) e
// estatísticas (consolidação por centro, paciente-dia pelo censo ou estimado, matriz com a prioridade do lançamento
// manual e a referência herdada). Cobertura de 90% (ficha do M54, seção 10: motor de rateio).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-custos',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-custos',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
