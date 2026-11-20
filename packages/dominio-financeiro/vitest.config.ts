import { defineConfig } from 'vitest/config';

// Projeto "dominio-financeiro" (M32; ficha, seção 10): as regras 1 a 19 do financeiro e fiscal, com as parcelas de cada
// conta escritas nos testes (alçada, vencimento, glosa, DRE, fluxo projetado, conciliação por regra). As regras que o
// adaptador do legado também confere moram em @sgh/contratos/regras-financeiro (como D-REGRAS-28): medidas aqui.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-financeiro',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      allowExternal: true,
      include: ['src/**/*.ts', '**/packages/contratos/src/financeiro/regras/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts', '**/regras/index.ts'],
      reportsDirectory: '../../coverage/dominio-financeiro',
      reporter: ['text-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
