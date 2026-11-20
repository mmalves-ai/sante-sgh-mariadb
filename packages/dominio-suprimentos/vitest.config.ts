import { defineConfig } from 'vitest/config';

// Regras de estoque e compras (M28, ficha seção 10): documento e consolidação (regras 1 e 2), saída (3 e 4), destino e
// origem (6), lote e validade (8), competência fechada (9), cotação (11), conferência da nota fiscal (12), escopo por
// local (13), inventário (14) e ponto de pedido (15). Cobertura de 80% (ficha) — o pacote mira 90%.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-suprimentos',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      // As regras moram em @sgh/contratos/regras-suprimentos (D-REGRAS-28): a cobertura é medida nelas.
      allowExternal: true,
      include: ['**/packages/contratos/src/suprimentos/regras/*.ts'],
      exclude: ['**/*.spec.ts', '**/regras/index.ts'],
      reportsDirectory: '../../coverage/dominio-suprimentos',
      reporter: ['text-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
