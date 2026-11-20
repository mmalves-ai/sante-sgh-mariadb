import { defineConfig } from 'vitest/config';

// Regras puras do repasse médico (M33): regra mais específica, versão de regra, base de cálculo, beneficiário,
// adicionais, cálculo com memória, apuração, RPA, credor do título, estorno por glosa e o comparador do teste dourado.
// Cobertura de 90% (ficha do M33, seção 10: motor).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-repasse',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-repasse',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
