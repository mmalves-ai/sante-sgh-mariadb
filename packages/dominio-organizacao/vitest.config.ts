import { defineConfig } from 'vitest/config';

// Regras puras da organização (M10): sentinelas "não informado", hierarquia da estrutura (empresa, hospital,
// unidades; blocos, acomodações e leitos) e a conferência dos dois modelos de leito. Cobertura de 80%
// (ficha do M10, seção 10).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-organizacao',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-organizacao',
      reporter: ['text-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
