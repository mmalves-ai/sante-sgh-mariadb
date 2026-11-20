import { defineConfig } from 'vitest/config';

// Projeto "dominio-faturamento": regras puras do faturamento. O gerador TISS 04.03.00 é motor (cobertura ≥ 90%,
// cap-14 §14.2.1); a validação usa o libxml2 em WebAssembly (xmllint-wasm), sem rede.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-faturamento',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      // M30: as regras da conta moram em @sgh/contratos/regras-faturamento (como D-REGRAS-28): medidas aqui.
      allowExternal: true,
      include: ['src/tiss/**/*.ts', 'src/sus/**/*.ts', '**/packages/contratos/src/faturamento/regras/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.spec-util.ts', '**/regras/index.ts', 'src/sus/index.ts'],
      reportsDirectory: '../../coverage/dominio-faturamento',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
