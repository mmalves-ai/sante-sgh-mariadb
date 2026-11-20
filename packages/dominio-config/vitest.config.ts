import { defineConfig } from 'vitest/config';

// Regras puras do módulo config (M08): declaração do CRUD genérico, duplicidade, lista, exportação,
// resolvedor e vigência dos parâmetros, chaves de liberação e pré-requisitos (POL-3). Cobertura de 90%
// (ficha do M08, seção 10: motor).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-config',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-config',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
