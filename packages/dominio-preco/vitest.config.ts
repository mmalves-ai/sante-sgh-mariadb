import { defineConfig } from 'vitest/config';

// Regras puras do motor de preços (M12): vigência, modelo de valor, proposta de reajuste, impacto em mais
// de um convênio, comparação de importação, busca por palavra e convênio que aceita atendimento. Cobertura
// de 90% (ficha do M12, seção 10: motor).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-preco',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-preco',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
