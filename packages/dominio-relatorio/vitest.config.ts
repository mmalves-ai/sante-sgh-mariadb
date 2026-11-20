import { defineConfig } from 'vitest/config';

// Indicadores e relatórios (M16): fichas técnicas versionadas e o validador (regra 11), as fórmulas com numerador
// e denominador, a comparação com o ano anterior, as duas réguas da receita, a glosa e a pseudonimização do
// data mart (regra 17). Cobertura de 90% (ficha do M16, seção 10).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-relatorio',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.spec-util.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-relatorio',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
