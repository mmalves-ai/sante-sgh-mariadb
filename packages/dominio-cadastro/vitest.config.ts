import { defineConfig } from 'vitest/config';

// Regras puras do cadastro (M11): CPF, CNS, termo e chave fonética da busca, escore de duplicidade,
// categoria pelo CBO, deduplicação de solicitante, mascaramento e visibilidade da ficha. Cobertura de 80%
// (ficha do M11, seção 10), com os casos das suítes da sante-api reescritos com dados fictícios.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-cadastro',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-cadastro',
      reporter: ['text-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
