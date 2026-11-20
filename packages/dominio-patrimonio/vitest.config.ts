import { defineConfig } from 'vitest/config';

// Regras puras do patrimônio (M54, etapa 6): origem do bem (nota ou doação com termo), plaqueta, QR e etiqueta,
// depreciação mensal linear com o coeficiente por turno, movimentos com o aceite de quem recebe e o inventário pelo QR.
// Cobertura de 90% (ficha do M54, seção 10).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-patrimonio',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-patrimonio',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
